import { createConnection, type RowDataPacket } from "mysql2/promise";

export interface Env {
  ASSETS: Fetcher;
  HYPERDRIVE: Hyperdrive;
}

interface StorageRow extends RowDataPacket {
  data: Uint8Array | Buffer;
  compression_key: string;
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

function buildBlobResponse(
  row: StorageRow,
  contentType: string,
  cacheControl: string,
  isHead: boolean,
): Response {
  const encoding = COMPRESSION_HEADER_MAP[row.compression_key] ?? null;
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": encoding ? `${cacheControl}, no-transform` : cacheControl,
  });

  if (encoding) {
    headers.set("Content-Encoding", encoding);
  }

  // Copy/wrap as Uint8Array; pass encodeBody: "manual" when pre-compressed so
  // the Workers runtime does not double-compress already-encoded BlueMap blobs.
  const body = isHead ? null : new Uint8Array(row.data);
  const init: ResponseInit & { encodeBody?: "automatic" | "manual" } = {
    status: 200,
    headers,
    ...(encoding ? { encodeBody: "manual" } : {}),
  };

  return new Response(body, init);
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
  pathname: string,
  isHead: boolean,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const rest = pathname.slice("/maps/".length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx <= 0) {
    return errorResponse(404, pathname);
  }

  const mapId = decodeURIComponent(rest.slice(0, slashIdx));
  const mapPath = decodeURIComponent(rest.slice(slashIdx + 1));

  // Route 1: Map tiles (/maps/<mapId>/tiles/...)
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
        const contentType = lod === 0 ? "application/octet-stream" : "image/png";
        return buildBlobResponse(rows[0], contentType, "public, max-age=86400", isHead);
      }

      // BlueMap expects 204 No Content for unrendered/empty tiles
      return new Response(null, { status: 204 });
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
        const cacheControl = mapPath.startsWith("live/")
          ? "public, max-age=1"
          : "public, max-age=86400";
        return buildBlobResponse(rows[0], getMimeType(mapPath), cacheControl, isHead);
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
    const { pathname } = url;

    if (pathname.startsWith("/maps/")) {
      return handleMapRequest(pathname, request.method === "HEAD", env, ctx);
    }

    return errorResponse(404, pathname);
  },
} satisfies ExportedHandler<Env>;
