import { createConnection, type RowDataPacket } from "mysql2/promise";

export interface Env {
  ASSETS: Fetcher;
  HYPERDRIVE: Hyperdrive;
  ENABLE_LIVE_DATA?: string;
}

interface StorageRow extends RowDataPacket {
  data: Uint8Array | Buffer;
  compression_key: string;
}

interface RegionTileRow extends RowDataPacket {
  x: number;
  z: number;
  data: Uint8Array | Buffer;
  compression_key: string;
}

interface RegionIndexRow extends RowDataPacket {
  storage_key: string;
  rx: number;
  rz: number;
}

interface RegionVersionRow extends RowDataPacket {
  storage_key: string;
  rx: number;
  rz: number;
  rver: number;
}

interface ItemVersionRow extends RowDataPacket {
  storage_key: string;
  ver: number;
}

const COMPRESSION_HEADER_MAP: Record<string, string | null> = {
  "bluemap:none": null,
  "bluemap:gzip": "gzip",
  "bluemap:deflate": "deflate",
  "bluemap:zstd": "zstd",
  "bluemap:lz4": "lz4",
};

const META_FILE_KEYS: Record<string, string> = {
  "settings.json": "bluemap:settings",
  "textures.json": "bluemap:textures",
  "live/markers.json": "bluemap:markers",
  "live/players.json": "bluemap:players",
};

const MIME_DEFAULT = "application/octet-stream";
const MIME_TYPES: Record<string, string> = {
  txt: "text/plain",
  css: "text/css",
  csv: "text/csv",
  htm: "text/html",
  html: "text/html",
  js: "text/javascript",
  xml: "text/xml",

  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",

  json: "application/json",

  mp3: "audio/mpeg",
  oga: "audio/ogg",
  wav: "audio/wav",
  weba: "audio/webm",

  mp4: "video/mp4",
  mpeg: "video/mpeg",
  webm: "video/webm",

  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
};

// Aggressive browser + edge caching to minimize Worker invocations and DB reads.
// BlueMap stores a per-client `tileCacheHash` cookie and automatically rotates it
// on browser reload, so long `immutable` browser caching works cleanly with manual refreshes.
const TILE_CLIENT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const TILE_EDGE_TTL = 604800; // 7 days in Cloudflare edge cache
const STATIC_ASSET_CLIENT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_ASSET_EDGE_TTL = 2592000; // 30 days in Cloudflare edge cache (textures.json, assets/*)
const MAP_SETTINGS_CACHE_CONTROL = "public, max-age=86400";
const MAP_SETTINGS_EDGE_TTL = 86400; // 24 hours in Cloudflare edge cache
const MANIFEST_CACHE_CONTROL = "public, max-age=43200"; // 12 hours in browser & edge cache
const MANIFEST_EDGE_TTL = 43200; // 12 hours in Cloudflare edge cache
const EMPTY_TILE_CACHE_CONTROL = "public, max-age=300"; // 5 min browser cache for 204 unrendered tiles
// Live endpoints (players.json, markers.json): 5-minute browser + Cloudflare edge cache
const LIVE_CLIENT_CACHE_CONTROL = "public, max-age=300";
const LIVE_EDGE_TTL = 300; // 5 minutes in Cloudflare edge cache

// Internal metadata headers stored on opaque cached blobs so Cloudflare Cache API
// never re-encodes, strips Content-Encoding, or splits cache variants by Accept-Encoding.
const HDR_CONTENT_TYPE = "X-BlueMap-Content-Type";
const HDR_ENCODING = "X-BlueMap-Encoding";
const HDR_CLIENT_CC = "X-BlueMap-Cache-Control";
const HDR_ETAG = "X-BlueMap-ETag";
const CACHE_KEY_VERSION = "7";

// 8x8 tile super-regions (up to 64 tiles per single Worker request & SQL range query)
const REGION_SIZE = 8;
const REGION_PATH_REGEX = /^region\/(\d+)\/(-?\d+)\/(-?\d+)\.pack$/;

const COMPRESSION_CODE_MAP: Record<string, number> = {
  "bluemap:none": 0,
  "bluemap:gzip": 1,
  "bluemap:deflate": 2,
  "bluemap:zstd": 3,
  "bluemap:lz4": 4,
};

const TILE_PATH_REGEX = /^tiles\/([\d/]+)\/x(-?[\d/]+)z(-?[\d/]+)(?:[./].*)?$/;

function getMimeType(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return MIME_DEFAULT;

  const slash = path.lastIndexOf("/");
  if (slash !== -1 && dot < slash) return MIME_DEFAULT;

  const suffix = path.slice(dot + 1).toLowerCase();
  return MIME_TYPES[suffix] ?? MIME_DEFAULT;
}

function errorResponse(status: number, path: string, message?: string): Response {
  const lines = [`BlueMap worker - ${status}`];
  if (message) lines.push(message);
  lines.push(`Requested Path: ${path}`);
  return new Response(lines.join("\n"), {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function clientAcceptsEncoding(request: Request, encoding: string): boolean {
  const accept = request.headers.get("Accept-Encoding") ?? "";
  return accept
    .split(",")
    .some((part) => part.trim().toLowerCase().split(";")[0] === encoding);
}

async function computeEtag(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest).subarray(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `W/"${hex}"`;
}

function etagMatches(request: Request, etag: string | null): boolean {
  if (!etag) return false;
  const inm = request.headers.get("If-None-Match");
  if (!inm) return false;
  if (inm.trim() === "*") return true;
  const normalizedTarget = etag.replace(/^W\//, "");
  return inm.split(",").some((part) => part.trim().replace(/^W\//, "") === normalizedTarget);
}

function buildClientResponse(
  body: ReadableStream<Uint8Array> | Uint8Array | null,
  contentType: string,
  encoding: string | null,
  cacheControl: string,
  cacheStatus: "HIT" | "MISS" | "BYPASS",
  etag: string | null,
  request: Request,
): Response {
  const isHead = request.method === "HEAD";
  const headers = new Headers({
    "Content-Type": contentType,
    "X-BlueMap-Cache": cacheStatus,
  });

  if (etag) {
    headers.set("ETag", etag);
  }

  if (etagMatches(request, etag)) {
    headers.set("Cache-Control", encoding ? `${cacheControl}, no-transform` : cacheControl);
    if (encoding) headers.set("Vary", "Accept-Encoding");
    // Drain/cancel unused body stream if present
    if (body instanceof ReadableStream) {
      body.cancel().catch(() => {});
    }
    return new Response(null, { status: 304, headers });
  }

  if (encoding) {
    headers.set("Vary", "Accept-Encoding");

    if (clientAcceptsEncoding(request, encoding)) {
      headers.set("Content-Encoding", encoding);
      headers.set("Cache-Control", `${cacheControl}, no-transform`);
      const init: ResponseInit & { encodeBody?: "automatic" | "manual" } = {
        status: 200,
        headers,
        encodeBody: "manual",
      };
      return new Response(isHead ? null : body, init);
    }

    // Fallback for clients that do not advertise gzip (e.g. plain curl without --compressed)
    if (encoding === "gzip" && !isHead && body) {
      headers.set("Cache-Control", cacheControl);
      const stream =
        body instanceof Uint8Array
          ? new Response(body).body!
          : body;
      return new Response(stream.pipeThrough(new DecompressionStream("gzip")), {
        status: 200,
        headers,
      });
    }

    // Unsupported encoding fallback: pass through with encoding header intact
    headers.set("Content-Encoding", encoding);
    headers.set("Cache-Control", `${cacheControl}, no-transform`);
    const init: ResponseInit & { encodeBody?: "automatic" | "manual" } = {
      status: 200,
      headers,
      encodeBody: "manual",
    };
    return new Response(isHead ? null : body, init);
  }

  headers.set("Cache-Control", cacheControl);
  return new Response(isHead ? null : body, { status: 200, headers });
}

function buildCacheEntry(
  bytes: Uint8Array,
  contentType: string,
  encoding: string | null,
  clientCacheControl: string,
  edgeTtlSeconds: number,
  etag: string,
): Response {
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Cache-Control": `public, max-age=${edgeTtlSeconds}, no-transform`,
    [HDR_CONTENT_TYPE]: contentType,
    [HDR_CLIENT_CC]: clientCacheControl,
    [HDR_ETAG]: etag,
  });
  if (encoding) {
    headers.set(HDR_ENCODING, encoding);
  }
  return new Response(bytes, { status: 200, headers });
}

/**
 * Normalizes the edge cache key: strips arbitrary query params while preserving
 * our manifest-driven `?v=<digits>` tile/item version so updated tiles get fresh
 * edge entries without allowing arbitrary query cache-busting.
 */
function makeEdgeCacheKey(url: URL): Request {
  const normalized = new URL(url.pathname, url.origin);
  normalized.searchParams.set("_cv", CACHE_KEY_VERSION);
  const ver = url.searchParams.get("v");
  if (ver && /^\d+$/.test(ver)) {
    normalized.searchParams.set("v", ver);
  }
  return new Request(normalized.toString(), { method: "GET" });
}

function packRegionBinary(rows: RegionTileRow[]): Uint8Array {
  // Format "BM98" v1 (little-endian):
  //   Header (8 bytes): magic "BM98", uint16 version=1, uint16 count=rows.length
  //   Per entry: int32 x, int32 z, uint8 compression, uint8[3] pad, uint32 byteLength, byteLength bytes
  let totalBytes = 8;
  for (const r of rows) {
    totalBytes += 16 + r.data.byteLength;
  }

  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);
  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  out[2] = 0x39; // '9'
  out[3] = 0x38; // '8'
  view.setUint16(4, 1, true);
  view.setUint16(6, rows.length, true);

  let offset = 8;
  for (const r of rows) {
    const bytes = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
    view.setInt32(offset, r.x, true);
    view.setInt32(offset + 4, r.z, true);
    out[offset + 8] = COMPRESSION_CODE_MAP[r.compression_key] ?? 0;
    // bytes offset+9..11 remain 0 padding
    view.setUint32(offset + 12, bytes.byteLength, true);
    out.set(bytes, offset + 16);
    offset += 16 + bytes.byteLength;
  }

  return out;
}

function storageKeyToLod(storageKey: string): string | null {
  if (storageKey === "bluemap:hires") return "0";
  if (storageKey.startsWith("bluemap:lowres/")) {
    return storageKey.slice("bluemap:lowres/".length);
  }
  return null;
}

async function openDb(env: Env) {
  return createConnection({
    host: env.HYPERDRIVE.host,
    user: env.HYPERDRIVE.user,
    password: env.HYPERDRIVE.password,
    database: env.HYPERDRIVE.database,
    port: env.HYPERDRIVE.port,
    // Required for mysql2 inside Cloudflare Workers (no dynamic eval)
    disableEval: true,
  });
}

async function handleMapRequest(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = url;
  const rest = pathname.slice("/maps/".length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx <= 0) {
    return errorResponse(404, pathname);
  }

  const mapId = decodeURIComponent(rest.slice(0, slashIdx));
  const mapPath = decodeURIComponent(rest.slice(slashIdx + 1));
  const isLive = mapPath.startsWith("live/");
  const isHead = request.method === "HEAD";

  // Feature flag: when ENABLE_LIVE_DATA !== "true", short-circuit /live/* without touching Hyperdrive/MySQL.
  if (isLive && env.ENABLE_LIVE_DATA !== "true") {
    const emptyBody =
      mapPath === "live/players.json"
        ? '{"players":[]}'
        : mapPath === "live/markers.json"
          ? "{}"
          : null;
    if (emptyBody === null) {
      return errorResponse(404, pathname);
    }
    return new Response(isHead ? null : emptyBody, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400",
        "X-BlueMap-Live": "disabled",
      },
    });
  }

  const cache = caches.default;
  const cacheKey = makeEdgeCacheKey(url);

  // Serve heavy tiles/textures/settings/assets/live files from Cloudflare edge cache on HIT
  if (cacheKey) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const contentType = cached.headers.get(HDR_CONTENT_TYPE) ?? MIME_DEFAULT;
      const encoding = cached.headers.get(HDR_ENCODING);
      const clientCacheControl =
        cached.headers.get(HDR_CLIENT_CC) ?? TILE_CLIENT_CACHE_CONTROL;
      const etag = cached.headers.get(HDR_ETAG);
      return buildClientResponse(
        cached.body,
        contentType,
        encoding,
        clientCacheControl,
        "HIT",
        etag,
        request,
      );
    }
  }

  // Route 0: Version & region-existence manifest (/maps/<mapId>/manifest.json)
  // Uses a fast Primary Key index-only scan for existing 8x8 regions plus summed
  // version counters from bluemap_tile_version. Cached 12 hours in browser & edge.
  if (mapPath === "manifest.json") {
    let connection;
    try {
      connection = await openDb(env);
    } catch (err) {
      console.error("Failed to connect to database:", err);
      return errorResponse(500, pathname, "Failed to connect to database");
    }

    try {
      const [regionRows] = await connection.query<RegionIndexRow[]>(
        `SELECT s.\`key\` AS storage_key, FLOOR(d.x / ${REGION_SIZE}) AS rx, FLOOR(d.z / ${REGION_SIZE}) AS rz
         FROM bluemap_grid_storage_data d
         INNER JOIN bluemap_map m ON d.map = m.id
         INNER JOIN bluemap_grid_storage s ON d.storage = s.id
         WHERE m.map_id = ?
           AND (s.\`key\` = 'bluemap:hires' OR s.\`key\` LIKE 'bluemap:lowres/%')
         GROUP BY s.\`key\`, FLOOR(d.x / ${REGION_SIZE}), FLOOR(d.z / ${REGION_SIZE})`,
        [mapId],
      );

      const [verRows] = await connection.query<RegionVersionRow[]>(
        `SELECT s.\`key\` AS storage_key, FLOOR(v.x / ${REGION_SIZE}) AS rx, FLOOR(v.z / ${REGION_SIZE}) AS rz, SUM(v.ver) AS rver
         FROM bluemap_tile_version v
         INNER JOIN bluemap_map m ON v.map = m.id
         INNER JOIN bluemap_grid_storage s ON v.storage = s.id
         WHERE m.map_id = ?
         GROUP BY s.\`key\`, FLOOR(v.x / ${REGION_SIZE}), FLOOR(v.z / ${REGION_SIZE})`,
        [mapId],
      );

      const [itemRows] = await connection.query<ItemVersionRow[]>(
        `SELECT s.\`key\` AS storage_key, v.ver
         FROM bluemap_item_version v
         INNER JOIN bluemap_map m ON v.map = m.id
         INNER JOIN bluemap_item_storage s ON v.storage = s.id
         WHERE m.map_id = ?`,
        [mapId],
      );

      const regions: Record<string, number> = {};
      for (const r of regionRows) {
        const lod = storageKeyToLod(r.storage_key);
        if (lod !== null) {
          regions[`${lod}:${Number(r.rx)}:${Number(r.rz)}`] = 0;
        }
      }
      for (const r of verRows) {
        const lod = storageKeyToLod(r.storage_key);
        if (lod !== null) {
          const key = `${lod}:${Number(r.rx)}:${Number(r.rz)}`;
          if (key in regions) {
            regions[key] = Number(r.rver);
          }
        }
      }

      const items: Record<string, number> = {};
      for (const r of itemRows) {
        if (r.storage_key === "bluemap:settings") {
          items["settings.json"] = r.ver;
        } else if (r.storage_key === "bluemap:textures") {
          items["textures.json"] = r.ver;
        } else if (r.storage_key.startsWith("bluemap:asset/")) {
          items[`assets/${r.storage_key.slice("bluemap:asset/".length)}`] = r.ver;
        }
      }

      const payload = JSON.stringify({ regionSize: REGION_SIZE, regions, items });
      const bytes = new TextEncoder().encode(payload);
      const etag = await computeEtag(bytes);

      if (cacheKey && !isHead) {
        ctx.waitUntil(
          cache.put(
            cacheKey,
            buildCacheEntry(
              bytes,
              "application/json",
              null,
              MANIFEST_CACHE_CONTROL,
              MANIFEST_EDGE_TTL,
              etag,
            ),
          ),
        );
      }

      return buildClientResponse(
        bytes,
        "application/json",
        null,
        MANIFEST_CACHE_CONTROL,
        cacheKey ? "MISS" : "BYPASS",
        etag,
        request,
      );
    } catch (err) {
      console.error("Failed to fetch manifest:", err);
      return errorResponse(500, pathname, "Failed to fetch manifest");
    } finally {
      ctx.waitUntil(connection.end());
    }
  }

  // Route 0.5: 8x8 Region Pack (/maps/<mapId>/region/<lod>/<rx>/<rz>.pack)
  // Bundles up to 64 tiles into a single binary payload, single SQL range scan,
  // and single shared Cloudflare edge cache entry.
  if (mapPath.startsWith("region/")) {
    const match = REGION_PATH_REGEX.exec(mapPath);
    if (!match) {
      return errorResponse(404, pathname);
    }

    const lod = Number.parseInt(match[1], 10);
    const rx = Number.parseInt(match[2], 10);
    const rz = Number.parseInt(match[3], 10);
    if (!Number.isFinite(lod) || !Number.isFinite(rx) || !Number.isFinite(rz)) {
      return errorResponse(404, pathname);
    }

    const storage = lod === 0 ? "bluemap:hires" : `bluemap:lowres/${lod}`;
    const minX = rx * REGION_SIZE;
    const maxX = minX + REGION_SIZE - 1;
    const minZ = rz * REGION_SIZE;
    const maxZ = minZ + REGION_SIZE - 1;

    let connection;
    try {
      connection = await openDb(env);
    } catch (err) {
      console.error("Failed to connect to database:", err);
      return errorResponse(500, pathname, "Failed to connect to database");
    }

    try {
      const [rows] = await connection.query<RegionTileRow[]>(
        `SELECT d.x, d.z, d.data, c.\`key\` AS compression_key
         FROM bluemap_grid_storage_data d
         INNER JOIN bluemap_map m ON d.map = m.id
         INNER JOIN bluemap_grid_storage s ON d.storage = s.id
         INNER JOIN bluemap_compression c ON d.compression = c.id
         WHERE m.map_id = ?
           AND s.\`key\` = ?
           AND d.x >= ? AND d.x <= ?
           AND d.z >= ? AND d.z <= ?`,
        [mapId, storage, minX, maxX, minZ, maxZ],
      );

      const packed = packRegionBinary(rows);
      const etag = await computeEtag(packed);

      if (cacheKey && !isHead) {
        ctx.waitUntil(
          cache.put(
            cacheKey,
            buildCacheEntry(
              packed,
              "application/octet-stream",
              null,
              TILE_CLIENT_CACHE_CONTROL,
              TILE_EDGE_TTL,
              etag,
            ),
          ),
        );
      }

      return buildClientResponse(
        packed,
        "application/octet-stream",
        null,
        TILE_CLIENT_CACHE_CONTROL,
        cacheKey ? "MISS" : "BYPASS",
        etag,
        request,
      );
    } catch (err) {
      console.error("Failed to fetch region pack:", err);
      return errorResponse(500, pathname, "Failed to fetch region pack");
    } finally {
      ctx.waitUntil(connection.end());
    }
  }

  // Route 1: Individual map tiles (/maps/<mapId>/tiles/...) — kept for compatibility
  if (mapPath.startsWith("tiles/")) {
    const match = TILE_PATH_REGEX.exec(mapPath);
    if (!match) {
      return errorResponse(404, pathname);
    }

    const lod = Number.parseInt(match[1], 10);
    const tileX = Number.parseInt(match[2].replaceAll("/", ""), 10);
    const tileZ = Number.parseInt(match[3].replaceAll("/", ""), 10);

    if (!Number.isFinite(lod) || !Number.isFinite(tileX) || !Number.isFinite(tileZ)) {
      return errorResponse(404, pathname);
    }

    const storage = lod === 0 ? "bluemap:hires" : `bluemap:lowres/${lod}`;

    let connection;
    try {
      connection = await openDb(env);
    } catch (err) {
      console.error("Failed to connect to database:", err);
      return errorResponse(500, pathname, "Failed to connect to database");
    }

    try {
      // Use connection.query (text protocol with client-side parameter escaping)
      // because Cloudflare Hyperdrive does not support MySQL prepared statements (.execute).
      const [rows] = await connection.query<StorageRow[]>(
        `SELECT d.data, c.\`key\` AS compression_key
         FROM bluemap_grid_storage_data d
         INNER JOIN bluemap_map m ON d.map = m.id
         INNER JOIN bluemap_grid_storage s ON d.storage = s.id
         INNER JOIN bluemap_compression c ON d.compression = c.id
         WHERE m.map_id = ?
           AND s.\`key\` = ?
           AND d.x = ?
           AND d.z = ?
         LIMIT 1`,
        [mapId, storage, tileX, tileZ],
      );

      if (rows.length > 0) {
        const bytes = new Uint8Array(rows[0].data);
        const contentType = lod === 0 ? "application/octet-stream" : "image/png";
        const encoding = COMPRESSION_HEADER_MAP[rows[0].compression_key] ?? null;
        const etag = await computeEtag(bytes);

        if (cacheKey && !isHead) {
          ctx.waitUntil(
            cache.put(
              cacheKey,
              buildCacheEntry(
                bytes,
                contentType,
                encoding,
                TILE_CLIENT_CACHE_CONTROL,
                TILE_EDGE_TTL,
                etag,
              ),
            ),
          );
        }

        return buildClientResponse(
          bytes,
          contentType,
          encoding,
          TILE_CLIENT_CACHE_CONTROL,
          cacheKey ? "MISS" : "BYPASS",
          etag,
          request,
        );
      }

      // BlueMap expects 204 No Content for unrendered/empty tiles.
      // Short browser cache avoids repeated Worker calls while panning over empty areas.
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": EMPTY_TILE_CACHE_CONTROL },
      });
    } catch (err) {
      console.error("Failed to fetch tile data:", err);
      return errorResponse(500, pathname, "Failed to fetch data");
    } finally {
      ctx.waitUntil(connection.end());
    }
  }

  // Route 2: Meta files & map assets (/maps/<mapId>/{settings.json,textures.json,live/*,assets/*})
  let storage: string | null = META_FILE_KEYS[mapPath] ?? null;
  if (storage === null && mapPath.startsWith("assets/")) {
    storage = `bluemap:asset/${mapPath.slice("assets/".length)}`;
  }

  if (storage !== null) {
    let connection;
    try {
      connection = await openDb(env);
    } catch (err) {
      console.error("Failed to connect to database:", err);
      return errorResponse(500, pathname, "Failed to connect to database");
    }

    try {
      const [rows] = await connection.query<StorageRow[]>(
        `SELECT d.data, c.\`key\` AS compression_key
         FROM bluemap_item_storage_data d
         INNER JOIN bluemap_map m ON d.map = m.id
         INNER JOIN bluemap_item_storage s ON d.storage = s.id
         INNER JOIN bluemap_compression c ON d.compression = c.id
         WHERE m.map_id = ?
           AND s.\`key\` = ?
         LIMIT 1`,
        [mapId, storage],
      );

      if (rows.length > 0) {
        const bytes = new Uint8Array(rows[0].data);
        const contentType = getMimeType(mapPath);
        const encoding = COMPRESSION_HEADER_MAP[rows[0].compression_key] ?? null;
        const etag = await computeEtag(bytes);
        const isMapSettings = mapPath === "settings.json";
        const cacheControl = isLive
          ? LIVE_CLIENT_CACHE_CONTROL
          : isMapSettings
            ? MAP_SETTINGS_CACHE_CONTROL
            : STATIC_ASSET_CLIENT_CACHE_CONTROL;
        const edgeTtl = isLive
          ? LIVE_EDGE_TTL
          : isMapSettings
            ? MAP_SETTINGS_EDGE_TTL
            : STATIC_ASSET_EDGE_TTL;

        if (cacheKey && !isHead) {
          ctx.waitUntil(
            cache.put(
              cacheKey,
              buildCacheEntry(bytes, contentType, encoding, cacheControl, edgeTtl, etag),
            ),
          );
        }

        return buildClientResponse(
          bytes,
          contentType,
          encoding,
          cacheControl,
          cacheKey ? "MISS" : "BYPASS",
          etag,
          request,
        );
      }
    } catch (err) {
      console.error("Failed to fetch meta/asset data:", err);
      return errorResponse(500, pathname, "Failed to fetch data");
    } finally {
      ctx.waitUntil(connection.end());
    }
  }

  return errorResponse(404, pathname);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith("/maps/")) {
      return handleMapRequest(request, url, env, ctx);
    }

    return errorResponse(404, url.pathname);
  },
} satisfies ExportedHandler<Env>;
