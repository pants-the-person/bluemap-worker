/**
 * BlueMap 98 — Native Windows 98 App Chrome & Pants Place 98 Integration
 *
 * - Automatically detects standalone vs iframe mode (`window.self !== window.top`
 *   or `?embed=1`) and hides the outer window titlebar when embedded in Pants Place 98.
 * - Supports all 7 Pants Place 98 color schemes + CRT scanlines via URL params,
 *   View menu, localStorage, or postMessage from the parent desktop window.
 * - Provides working Win98 File / View / Maps / Tools / Help dropdown menus and
 *   a live Win98 status bar bound to `window.bluemap`.
 */
(() => {
  const SCHEMES = [
    { id: "standard", label: "Windows Standard" },
    { id: "brick", label: "Brick" },
    { id: "desert", label: "Desert" },
    { id: "plum", label: "Plum" },
    { id: "rose", label: "Rose" },
    { id: "hotdog", label: "Hot Dog Stand" },
    { id: "highcontrast", label: "High Contrast" },
  ];

  const VALID_SCHEMES = new Set(SCHEMES.map((s) => s.id));
  const CRT_PRESETS = [
    { id: "off", label: "Off" },
    { id: "subtle", label: "Subtle" },
    { id: "trinitron", label: "Trinitron (Default)" },
    { id: "heavy", label: "Heavy Retro" },
  ];
  const VALID_CRT_PRESETS = new Set(CRT_PRESETS.map((p) => p.id));
  const STORAGE_SCHEME_KEY = "pp98-bluemap:scheme";
  const STORAGE_CRT_KEY = "pp98-bluemap:crt";
  const STORAGE_CRT_PRESET_KEY = "pp98-bluemap:crt-preset";
  const STORAGE_FAVORITES_KEY = "pp98-bluemap:favorites";

  // Curated server landmarks shown in the Win98 Favorites menu
  const DEFAULT_FAVORITES = [
    { name: "Overworld Spawn", map: "world", x: 14429, y: 80, z: -18450, distance: 320, rotation: 0, angle: 0.55, state: "perspective" },
    { name: "Nether Spawn", map: "world_the_nether", x: 14429, y: 80, z: -18450, distance: 320, rotation: 0, angle: 0.55, state: "perspective" },
    { name: "The End", map: "world_the_end", x: 14429, y: 80, z: -18450, distance: 320, rotation: 0, angle: 0.55, state: "perspective" },
  ];

  // Crisp 16x16 Windows 98 pixel-art toolbar icons (exact 16x16 grid, crispEdges)
  const WIN98_ICONS = {
    maps: `
      <rect x="1" y="3" width="14" height="10" fill="#000"/>
      <rect x="2" y="4" width="4" height="8" fill="#ffffc0"/>
      <rect x="6" y="4" width="4" height="8" fill="#e8e0a0"/>
      <rect x="10" y="4" width="4" height="8" fill="#ffffc0"/>
      <rect x="2" y="5" width="3" height="3" fill="#00a800"/>
      <rect x="3" y="8" width="2" height="3" fill="#0080c0"/>
      <rect x="6" y="6" width="4" height="4" fill="#008000"/>
      <rect x="7" y="4" width="2" height="2" fill="#0080c0"/>
      <rect x="11" y="5" width="3" height="4" fill="#00a800"/>
      <rect x="10" y="9" width="3" height="3" fill="#0080c0"/>
      <rect x="5" y="4" width="1" height="8" fill="#808040"/>
      <rect x="10" y="4" width="1" height="8" fill="#808040"/>
    `,
    markers: `
      <rect x="6" y="1" width="4" height="1" fill="#000"/>
      <rect x="5" y="2" width="1" height="4" fill="#000"/><rect x="10" y="2" width="1" height="4" fill="#000"/>
      <rect x="6" y="6" width="4" height="1" fill="#000"/>
      <rect x="6" y="2" width="4" height="4" fill="#ff0000"/>
      <rect x="6" y="2" width="2" height="2" fill="#ff8080"/>
      <rect x="7" y="7" width="2" height="5" fill="#808080"/>
      <rect x="7" y="12" width="1" height="3" fill="#000"/>
    `,
    players: `
      <rect x="5" y="2" width="6" height="5" fill="#000"/>
      <rect x="6" y="3" width="4" height="3" fill="#f0c090"/>
      <rect x="6" y="2" width="4" height="1" fill="#603810"/>
      <rect x="3" y="8" width="10" height="6" fill="#000"/>
      <rect x="4" y="9" width="8" height="4" fill="#008080"/>
      <rect x="6" y="9" width="4" height="4" fill="#00a8a8"/>
    `,
    dayNight: `
      <rect x="7" y="1" width="2" height="2" fill="#806000"/>
      <rect x="7" y="13" width="2" height="2" fill="#806000"/>
      <rect x="1" y="7" width="2" height="2" fill="#806000"/>
      <rect x="13" y="7" width="2" height="2" fill="#806000"/>
      <rect x="3" y="3" width="2" height="2" fill="#806000"/>
      <rect x="11" y="3" width="2" height="2" fill="#806000"/>
      <rect x="3" y="11" width="2" height="2" fill="#806000"/>
      <rect x="11" y="11" width="2" height="2" fill="#806000"/>
      <rect x="5" y="4" width="6" height="8" fill="#000"/>
      <rect x="4" y="5" width="8" height="6" fill="#000"/>
      <rect x="5" y="5" width="6" height="6" fill="#ffff00"/>
      <rect x="8" y="5" width="3" height="6" fill="#000080"/>
      <rect x="9" y="6" width="1" height="1" fill="#ffff80"/>
      <rect x="10" y="9" width="1" height="1" fill="#ffff80"/>
    `,
    perspective: `
      <rect x="6" y="1" width="4" height="1" fill="#000"/>
      <rect x="4" y="2" width="2" height="1" fill="#000"/><rect x="10" y="2" width="2" height="1" fill="#000"/>
      <rect x="2" y="3" width="2" height="1" fill="#000"/><rect x="12" y="3" width="2" height="1" fill="#000"/>
      <rect x="1" y="4" width="1" height="7" fill="#000"/><rect x="14" y="4" width="1" height="7" fill="#000"/>
      <rect x="2" y="11" width="2" height="1" fill="#000"/><rect x="12" y="11" width="2" height="1" fill="#000"/>
      <rect x="4" y="12" width="2" height="1" fill="#000"/><rect x="10" y="12" width="2" height="1" fill="#000"/>
      <rect x="6" y="13" width="4" height="1" fill="#000"/>
      <rect x="6" y="2" width="4" height="5" fill="#40c040"/>
      <rect x="4" y="3" width="8" height="3" fill="#40c040"/>
      <rect x="2" y="4" width="12" height="2" fill="#209020"/>
      <rect x="2" y="6" width="6" height="5" fill="#a06838"/>
      <rect x="4" y="11" width="4" height="1" fill="#a06838"/>
      <rect x="8" y="6" width="6" height="5" fill="#704420"/>
      <rect x="8" y="11" width="4" height="1" fill="#704420"/>
      <rect x="7" y="7" width="1" height="6" fill="#000"/>
    `,
    flat: `
      <rect x="1" y="2" width="14" height="12" fill="#000"/>
      <rect x="2" y="3" width="12" height="10" fill="#ffffff"/>
      <rect x="2" y="3" width="4" height="4" fill="#40b040"/>
      <rect x="6" y="3" width="4" height="4" fill="#80d060"/>
      <rect x="10" y="3" width="4" height="4" fill="#4090d0"/>
      <rect x="2" y="7" width="4" height="3" fill="#80d060"/>
      <rect x="6" y="7" width="4" height="3" fill="#d0c070"/>
      <rect x="10" y="7" width="4" height="3" fill="#4090d0"/>
      <rect x="2" y="10" width="4" height="3" fill="#4090d0"/>
      <rect x="6" y="10" width="4" height="3" fill="#40b040"/>
      <rect x="10" y="10" width="4" height="3" fill="#80d060"/>
      <rect x="5" y="3" width="1" height="10" fill="#808080"/>
      <rect x="9" y="3" width="1" height="10" fill="#808080"/>
      <rect x="2" y="6" width="12" height="1" fill="#808080"/>
      <rect x="2" y="9" width="12" height="1" fill="#808080"/>
    `,
    freeFlight: `
      <rect x="12" y="2" width="2" height="2" fill="#000"/>
      <rect x="9" y="3" width="3" height="2" fill="#000"/>
      <rect x="6" y="4" width="3" height="2" fill="#000"/>
      <rect x="2" y="5" width="4" height="2" fill="#000"/>
      <rect x="4" y="7" width="3" height="2" fill="#000"/>
      <rect x="6" y="9" width="2" height="4" fill="#000"/>
      <rect x="8" y="8" width="2" height="4" fill="#000"/>
      <rect x="10" y="5" width="2" height="6" fill="#000"/>
      <rect x="12" y="4" width="1" height="5" fill="#000"/>
      <rect x="4" y="6" width="8" height="1" fill="#ffffff"/>
      <rect x="7" y="5" width="5" height="1" fill="#ffffff"/>
      <rect x="10" y="4" width="2" height="1" fill="#ffffff"/>
      <rect x="7" y="7" width="4" height="2" fill="#c0c0c0"/>
      <rect x="7" y="9" width="2" height="2" fill="#808080"/>
    `,
    resetCamera: `
      <rect x="7" y="1" width="2" height="1" fill="#000"/>
      <rect x="5" y="2" width="6" height="1" fill="#000"/>
      <rect x="3" y="3" width="10" height="1" fill="#000"/>
      <rect x="1" y="4" width="14" height="2" fill="#000"/>
      <rect x="7" y="2" width="2" height="1" fill="#c00000"/>
      <rect x="5" y="3" width="6" height="1" fill="#ff0000"/>
      <rect x="3" y="4" width="10" height="2" fill="#c00000"/>
      <rect x="2" y="6" width="12" height="8" fill="#000"/>
      <rect x="3" y="6" width="10" height="7" fill="#ffffc0"/>
      <rect x="6" y="8" width="4" height="5" fill="#804000"/>
      <rect x="7" y="9" width="2" height="4" fill="#c08020"/>
      <rect x="4" y="7" width="2" height="2" fill="#0080c0"/>
      <rect x="10" y="7" width="2" height="2" fill="#0080c0"/>
    `,
    compass: `
      <rect x="5" y="1" width="6" height="1" fill="#000"/>
      <rect x="3" y="2" width="2" height="1" fill="#000"/><rect x="11" y="2" width="2" height="1" fill="#000"/>
      <rect x="2" y="3" width="1" height="2" fill="#000"/><rect x="13" y="3" width="1" height="2" fill="#000"/>
      <rect x="1" y="5" width="1" height="6" fill="#000"/><rect x="14" y="5" width="1" height="6" fill="#000"/>
      <rect x="2" y="11" width="1" height="2" fill="#000"/><rect x="13" y="11" width="1" height="2" fill="#000"/>
      <rect x="3" y="13" width="2" height="1" fill="#000"/><rect x="11" y="13" width="2" height="1" fill="#000"/>
      <rect x="5" y="14" width="6" height="1" fill="#000"/>
      <rect x="5" y="2" width="6" height="12" fill="#ffffff"/>
      <rect x="3" y="3" width="10" height="10" fill="#ffffff"/>
      <rect x="2" y="5" width="12" height="6" fill="#ffffff"/>
      <rect x="7" y="3" width="2" height="5" fill="#ff0000"/>
      <rect x="6" y="5" width="4" height="3" fill="#ff0000"/>
      <rect x="6" y="8" width="4" height="3" fill="#404040"/>
      <rect x="7" y="8" width="2" height="5" fill="#404040"/>
      <rect x="7" y="7" width="2" height="2" fill="#000"/>
    `,
    zoomIn: `
      <rect x="4" y="1" width="5" height="1" fill="#000"/>
      <rect x="2" y="2" width="2" height="1" fill="#000"/><rect x="9" y="2" width="2" height="1" fill="#000"/>
      <rect x="1" y="3" width="1" height="5" fill="#000"/><rect x="11" y="3" width="1" height="5" fill="#000"/>
      <rect x="2" y="8" width="2" height="1" fill="#000"/><rect x="9" y="8" width="2" height="1" fill="#000"/>
      <rect x="4" y="9" width="5" height="1" fill="#000"/>
      <rect x="4" y="2" width="5" height="7" fill="#c0f0ff"/>
      <rect x="2" y="3" width="9" height="5" fill="#c0f0ff"/>
      <rect x="6" y="3" width="1" height="5" fill="#000"/>
      <rect x="4" y="5" width="5" height="1" fill="#000"/>
      <rect x="10" y="9" width="2" height="2" fill="#000"/>
      <rect x="11" y="10" width="2" height="2" fill="#000"/>
      <rect x="12" y="11" width="2" height="2" fill="#000"/>
      <rect x="13" y="12" width="2" height="2" fill="#000"/>
    `,
    zoomOut: `
      <rect x="4" y="1" width="5" height="1" fill="#000"/>
      <rect x="2" y="2" width="2" height="1" fill="#000"/><rect x="9" y="2" width="2" height="1" fill="#000"/>
      <rect x="1" y="3" width="1" height="5" fill="#000"/><rect x="11" y="3" width="1" height="5" fill="#000"/>
      <rect x="2" y="8" width="2" height="1" fill="#000"/><rect x="9" y="8" width="2" height="1" fill="#000"/>
      <rect x="4" y="9" width="5" height="1" fill="#000"/>
      <rect x="4" y="2" width="5" height="7" fill="#c0f0ff"/>
      <rect x="2" y="3" width="9" height="5" fill="#c0f0ff"/>
      <rect x="4" y="5" width="5" height="1" fill="#000"/>
      <rect x="10" y="9" width="2" height="2" fill="#000"/>
      <rect x="11" y="10" width="2" height="2" fill="#000"/>
      <rect x="12" y="11" width="2" height="2" fill="#000"/>
      <rect x="13" y="12" width="2" height="2" fill="#000"/>
    `,
  };

  let crtFilterInstance = null;
  let activeCrtPreset = "trinitron";

  const GLOBE_ICON_SVG = `<svg class="pp98-titlebar-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="4" y="1" width="8" height="1" fill="#000"/>
    <rect x="2" y="2" width="2" height="1" fill="#000"/><rect x="12" y="2" width="2" height="1" fill="#000"/>
    <rect x="1" y="3" width="1" height="2" fill="#000"/><rect x="14" y="3" width="1" height="2" fill="#000"/>
    <rect x="0" y="5" width="1" height="6" fill="#000"/><rect x="15" y="5" width="1" height="6" fill="#000"/>
    <rect x="1" y="11" width="1" height="2" fill="#000"/><rect x="14" y="11" width="1" height="2" fill="#000"/>
    <rect x="2" y="13" width="2" height="1" fill="#000"/><rect x="12" y="13" width="2" height="1" fill="#000"/>
    <rect x="4" y="14" width="8" height="1" fill="#000"/>
    <rect x="4" y="2" width="8" height="12" fill="#1084d0"/>
    <rect x="2" y="3" width="12" height="10" fill="#1084d0"/>
    <rect x="1" y="5" width="14" height="6" fill="#1084d0"/>
    <rect x="4" y="3" width="4" height="3" fill="#00a800"/>
    <rect x="3" y="5" width="3" height="3" fill="#00a800"/>
    <rect x="9" y="4" width="4" height="2" fill="#00a800"/>
    <rect x="8" y="6" width="5" height="4" fill="#00a800"/>
    <rect x="5" y="10" width="4" height="3" fill="#00a800"/>
    <rect x="5" y="3" width="2" height="1" fill="#80ff80"/>
    <rect x="10" y="6" width="2" height="2" fill="#80ff80"/>
  </svg>`;

  function isEmbedded() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("embed") === "1" || params.get("embed") === "true") return true;
    if (params.get("embed") === "0" || params.get("embed") === "false") return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }

  function applyScheme(scheme, persist = true) {
    const normalized = VALID_SCHEMES.has(scheme) ? scheme : "standard";
    document.documentElement.setAttribute("data-scheme", normalized);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_SCHEME_KEY, normalized);
      } catch {
        // ignore storage errors in restricted iframes
      }
    }
  }

  function getSourceCanvas() {
    const bm = window.bluemap;
    if (bm?.mapViewer?.renderer?.domElement) return bm.mapViewer.renderer.domElement;
    return document.querySelector("#map-container > canvas:not(.pp98-crt-canvas)");
  }

  function ensureCrtFilter() {
    if (crtFilterInstance) return crtFilterInstance;
    const canvas = getSourceCanvas();
    if (!canvas || typeof window.CRTFilterWebGL !== "function") return null;
    const instance = new window.CRTFilterWebGL(canvas);
    if (instance.supported) {
      crtFilterInstance = instance;
      document.documentElement.classList.remove("pp98-crt-fallback");
      return instance;
    }
    // WebGL overlay unavailable — enable CSS fallback
    document.documentElement.classList.add("pp98-crt-fallback");
    return null;
  }

  function syncCrtFilter() {
    const enabled = activeCrtPreset !== "off";
    document.documentElement.setAttribute("data-crt", enabled ? "true" : "false");
    document.documentElement.setAttribute("data-crt-preset", activeCrtPreset);

    const filter = ensureCrtFilter();
    if (filter) {
      if (enabled) {
        filter.setPreset(activeCrtPreset);
        filter.start();
      } else {
        filter.stop();
      }
    } else if (enabled) {
      document.documentElement.classList.add("pp98-crt-fallback");
    }
  }

  function normalizeCrtValue(val) {
    if (val === false || val === "false" || val === "0" || val === "off") return "off";
    if (val === true || val === "true" || val === "1") return "trinitron";
    if (typeof val === "string" && VALID_CRT_PRESETS.has(val.toLowerCase())) {
      return val.toLowerCase();
    }
    return "trinitron";
  }

  function applyCrt(presetOrBool, persist = true) {
    activeCrtPreset = normalizeCrtValue(presetOrBool);
    syncCrtFilter();
    if (persist) {
      try {
        localStorage.setItem(STORAGE_CRT_KEY, activeCrtPreset === "off" ? "false" : "true");
        localStorage.setItem(STORAGE_CRT_PRESET_KEY, activeCrtPreset);
      } catch {
        // ignore
      }
    }
  }

  function getScheme() {
    return document.documentElement.getAttribute("data-scheme") || "standard";
  }

  function getCrtPreset() {
    return activeCrtPreset;
  }

  function initEnvironment() {
    if (isEmbedded()) {
      document.documentElement.classList.add("pp98-embed");
    }

    const params = new URLSearchParams(window.location.search);
    const paramScheme = params.get("scheme");
    const paramCrt = params.get("crt");

    let savedScheme = "standard";
    let savedCrtPreset = "trinitron";
    try {
      savedScheme = localStorage.getItem(STORAGE_SCHEME_KEY) || "standard";
      const storedPreset = localStorage.getItem(STORAGE_CRT_PRESET_KEY);
      const storedFlag = localStorage.getItem(STORAGE_CRT_KEY);
      if (storedPreset && VALID_CRT_PRESETS.has(storedPreset)) {
        savedCrtPreset = storedPreset;
      } else if (storedFlag !== null) {
        savedCrtPreset = storedFlag === "true" ? "trinitron" : "off";
      }
    } catch {
      // ignore
    }

    applyScheme(paramScheme || savedScheme, false);
    applyCrt(paramCrt !== null ? paramCrt : savedCrtPreset, false);

    // Allow Pants Place 98 parent window to sync color scheme & CRT live via postMessage
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "pp98:theme" || data.type === "pp98:scheme" || "scheme" in data || "crt" in data) {
        if (typeof data.scheme === "string") applyScheme(data.scheme, false);
        if (typeof data.crt === "boolean" || typeof data.crt === "string") applyCrt(data.crt, false);
      }
    });
  }

  function showToast(message) {
    const existing = document.querySelector(".pp98-toast");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "pp98-toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function loadUserFavorites() {
    try {
      const raw = localStorage.getItem(STORAGE_FAVORITES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveUserFavorites(list) {
    try {
      localStorage.setItem(STORAGE_FAVORITES_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  }

  async function jumpToFavorite(fav) {
    const bm = window.bluemap;
    if (!bm || !fav) return;
    const currentMapId = bm.mapViewer?.map?.data?.id;
    if (fav.map && fav.map !== currentMapId) {
      try {
        await bm.switchMap(fav.map);
      } catch {
        showToast(`Could not switch to map "${fav.map}"`);
        return;
      }
    }
    const cm = bm.mapViewer?.controlsManager;
    if (!cm) return;
    if (fav.state === "flat") bm.setFlatView?.(0);
    else if (fav.state === "free") bm.setFreeFlight?.(0, fav.y ?? 80);
    else bm.setPerspectiveView?.(0);

    cm.position.set(Number(fav.x) || 0, Number(fav.y) || 0, Number(fav.z) || 0);
    if (Number.isFinite(fav.distance)) cm.distance = fav.distance;
    if (Number.isFinite(fav.rotation)) cm.rotation = fav.rotation;
    if (Number.isFinite(fav.angle)) cm.angle = fav.angle;
    bm.updatePageAddress?.();
    bm.mapViewer?.updateLoadedMapArea?.();
    showToast(`Jumped to ${fav.name}`);
  }

  function showAddFavoriteModal() {
    if (document.querySelector(".pp98-modal-backdrop")) return;
    const bm = window.bluemap;
    const mapId = bm?.mapViewer?.map?.data?.id || "world";
    const mapName = bm?.mapViewer?.map?.data?.name || mapId;
    const cm = bm?.mapViewer?.controlsManager;
    const x = Math.round(cm?.position?.x ?? 0);
    const y = Math.round(cm?.position?.y ?? 64);
    const z = Math.round(cm?.position?.z ?? 0);
    const distance = Math.round(cm?.distance ?? 350);
    const rotation = Number((cm?.rotation ?? 0).toFixed(2));
    const angle = Number((cm?.angle ?? 0.55).toFixed(2));
    const state = bm?.appState?.controls?.state || "perspective";
    const defaultName = `${mapName} (${x}, ${z})`;

    const backdrop = document.createElement("div");
    backdrop.className = "pp98-modal-backdrop";
    backdrop.innerHTML = `
      <div class="pp98-modal" role="dialog" aria-modal="true" aria-label="Add to Favorites">
        <div class="pp98-modal-titlebar">
          <span>Add to Favorites</span>
          <button type="button" class="pp98-winbtn" data-close aria-label="Close">
            <svg viewBox="0 0 9 9"><path d="M1 0h1v1h1v1h1v1h1V2h1V1h1V0h1v1H7v1H6v1H5v1h1v1h1v1h1v1H7V7H6V6H5V5H4v1H3v1H2v1H1V7h1V6h1V5h1V4H3V3H2V2H1V1h0V0z"/></svg>
          </button>
        </div>
        <div class="pp98-modal-body" style="display:block;">
          <label class="pp98-field-label" for="pp98-fav-name">Bookmark Name:</label>
          <input id="pp98-fav-name" type="text" class="pp98-text-field" maxlength="48" />
          <div style="margin-top:8px; color:var(--text-muted);">
            Location: ${mapId} — X: ${x}, Y: ${y}, Z: ${z} (${state})
          </div>
        </div>
        <div class="pp98-modal-footer">
          <button type="button" class="pp98-btn default" data-save>OK</button>
          <button type="button" class="pp98-btn" data-close>Cancel</button>
        </div>
      </div>
    `;

    const input = backdrop.querySelector("#pp98-fav-name");
    input.value = defaultName;

    const close = () => {
      backdrop.remove();
      window.removeEventListener("keydown", onKey);
    };

    const save = () => {
      const name = input.value.trim() || defaultName;
      const list = loadUserFavorites();
      list.push({ name, map: mapId, x, y, z, distance, rotation, angle, state });
      saveUserFavorites(list);
      close();
      showToast(`Saved "${name}" to Favorites`);
    };

    const onKey = (e) => {
      if (e.key === "Escape") close();
      else if (e.key === "Enter") save();
    };
    window.addEventListener("keydown", onKey);

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop || e.target.closest("[data-close]")) close();
      else if (e.target.closest("[data-save]")) save();
    });

    document.body.appendChild(backdrop);
    input.focus();
    input.select();
  }

  function showOrganizeFavoritesModal() {
    if (document.querySelector(".pp98-modal-backdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.className = "pp98-modal-backdrop";

    const render = () => {
      const list = loadUserFavorites();
      const rows = list.length
        ? list
            .map(
              (f, idx) => `
                <div class="pp98-fav-row">
                  <span><strong>${f.name.replace(/[<>&"]/g, "")}</strong> <span style="opacity:0.75">(${f.map}: ${f.x}, ${f.z})</span></span>
                  <button type="button" class="pp98-fav-del" data-del="${idx}">Delete</button>
                </div>
              `,
            )
            .join("")
        : `<div style="padding:10px; color:var(--text-muted); text-align:center;">No custom bookmarks saved yet.</div>`;

      backdrop.innerHTML = `
        <div class="pp98-modal" role="dialog" aria-modal="true" aria-label="Organize Favorites">
          <div class="pp98-modal-titlebar">
            <span>Organize Favorites</span>
            <button type="button" class="pp98-winbtn" data-close aria-label="Close">
              <svg viewBox="0 0 9 9"><path d="M1 0h1v1h1v1h1v1h1V2h1V1h1V0h1v1H7v1H6v1H5v1h1v1h1v1h1v1H7V7H6V6H5V5H4v1H3v1H2v1H1V7h1V6h1V5h1V4H3V3H2V2H1V1h0V0z"/></svg>
            </button>
          </div>
          <div class="pp98-modal-body" style="display:block;">
            <div>Saved bookmarks (stored locally in your browser):</div>
            <div class="pp98-fav-list">${rows}</div>
          </div>
          <div class="pp98-modal-footer">
            <button type="button" class="pp98-btn default" data-close>Close</button>
          </div>
        </div>
      `;
    };

    const close = () => {
      backdrop.remove();
      window.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);

    backdrop.addEventListener("click", (e) => {
      const del = e.target.closest("[data-del]");
      if (del) {
        const idx = Number(del.getAttribute("data-del"));
        const list = loadUserFavorites();
        if (idx >= 0 && idx < list.length) {
          list.splice(idx, 1);
          saveUserFavorites(list);
          render();
        }
        return;
      }
      if (e.target === backdrop || e.target.closest("[data-close]")) close();
    });

    render();
    document.body.appendChild(backdrop);
  }

  function showAboutModal() {
    if (document.querySelector(".pp98-modal-backdrop")) return;
    const bm = window.bluemap;
    const version = bm?.settings?.version || "5.7";
    const mapCount = bm?.maps?.length ?? 0;

    const backdrop = document.createElement("div");
    backdrop.className = "pp98-modal-backdrop";
    backdrop.innerHTML = `
      <div class="pp98-modal" role="dialog" aria-modal="true" aria-label="About BlueMap 98">
        <div class="pp98-modal-titlebar">
          <span>About BlueMap 98</span>
          <button type="button" class="pp98-winbtn" data-close aria-label="Close">
            <svg viewBox="0 0 9 9"><path d="M1 0h1v1h1v1h1v1h1V2h1V1h1V0h1v1H7v1H6v1H5v1h1v1h1v1h1v1H7V7H6V6H5V5H4v1H3v1H2v1H1V7h1V6h1V5h1V4H3V3H2V2H1V1h0V0z"/></svg>
          </button>
        </div>
        <div class="pp98-modal-body">
          <div style="transform: scale(2); transform-origin: top left; width: 28px; height: 28px; flex-shrink: 0;">
            ${GLOBE_ICON_SVG}
          </div>
          <div>
            <strong>BlueMap 98 — Pants Place Edition</strong><br>
            Server: <code>mc.pants.place</code> (ATM10)<br>
            Engine: BlueMap ${version} (${mapCount} maps)<br>
            Storage: MySQL via Cloudflare Hyperdrive<br><br>
            <span style="color: var(--text-muted)">Tip: Left-drag to pan, right-drag to rotate, scroll to zoom, double-click to focus.</span>
          </div>
        </div>
        <div class="pp98-modal-footer">
          <button type="button" class="pp98-btn default" data-close>OK</button>
        </div>
      </div>
    `;

    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop || e.target.closest("[data-close]")) close();
    });
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") {
        close();
        window.removeEventListener("keydown", onKey);
      }
    };
    window.addEventListener("keydown", onKey);

    document.body.appendChild(backdrop);
    backdrop.querySelector(".pp98-btn")?.focus();
  }

  function triggerResize() {
    const bm = window.bluemap;
    if (bm?.mapViewer?.handleContainerResize) {
      bm.mapViewer.handleContainerResize();
    }
    window.dispatchEvent(new Event("resize"));
  }

  function buildChrome() {
    if (document.querySelector(".pp98-menubar")) return;

    // 1. Outer window bevel (standalone mode)
    const frame = document.createElement("div");
    frame.className = "pp98-window-frame";
    document.body.appendChild(frame);

    // 2. Title bar (standalone mode; hidden in iframe embed mode)
    const titlebar = document.createElement("div");
    titlebar.className = "pp98-titlebar";
    titlebar.innerHTML = `
      <div class="pp98-titlebar-left">
        ${GLOBE_ICON_SVG}
        <span class="pp98-titlebar-text">BlueMap 98 — mc.pants.place</span>
      </div>
      <div class="pp98-titlebar-controls">
        <button type="button" class="pp98-winbtn" data-act="minimize" title="Toggle Sidebar">
          <svg viewBox="0 0 9 9"><rect x="1" y="7" width="6" height="2"/></svg>
        </button>
        <button type="button" class="pp98-winbtn" data-act="maximize" title="Toggle Fullscreen">
          <svg viewBox="0 0 9 9"><path fill-rule="evenodd" d="M0 0h9v9H0V0zm1 2v6h7V2H1z"/></svg>
        </button>
        <button type="button" class="pp98-winbtn" data-act="close" title="Return to Pants Place 98">
          <svg viewBox="0 0 9 9"><path d="M1 0h1v1h1v1h1v1h1V2h1V1h1V0h1v1H7v1H6v1H5v1h1v1h1v1h1v1H7V7H6V6H5V5H4v1H3v1H2v1H1V7h1V6h1V5h1V4H3V3H2V2H1V1h0V0z"/></svg>
        </button>
      </div>
    `;
    document.body.appendChild(titlebar);

    function openSidebarPage(id, title, props = {}) {
      const bm = window.bluemap;
      const menu = bm?.appState?.menu;
      if (!menu) return;
      menu.closeAll();
      menu.openPage(id, title, props);
    }

    function takeCrtScreenshot() {
      const bm = window.bluemap;
      if (!bm) return;

      // Capture directly from the WebGL CRT post-processing canvas when active
      const dataUrl = crtFilterInstance?.captureDataURL?.("image/png");
      if (!dataUrl) {
        if (bm.__pp98OrigTakeScreenshot) {
          bm.__pp98OrigTakeScreenshot();
        }
        return;
      }

      const link = document.createElement("a");
      link.download = "bluemap-98-screenshot.png";
      link.href = dataUrl;
      link.click();

      if (bm.appState?.screenshot?.clipboard && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        fetch(dataUrl)
          .then((r) => r.blob())
          .then((blob) => navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]))
          .catch(() => {});
      }
    }

    function patchScreenshot() {
      const bm = window.bluemap;
      if (!bm || bm.__pp98ScreenshotPatched) return;
      bm.__pp98ScreenshotPatched = true;
      bm.__pp98OrigTakeScreenshot = bm.takeScreenshot?.bind(bm);
      bm.takeScreenshot = takeCrtScreenshot;
    }

    titlebar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      const bm = window.bluemap;
      if (act === "minimize") {
        if (bm?.appState?.menu?.isOpen) {
          bm.appState.menu.closeAll();
        } else {
          openSidebarPage("settings", "Settings");
        }
      } else if (act === "maximize") {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          document.documentElement.requestFullscreen?.().catch(() => {});
        }
      } else if (act === "close") {
        window.location.href = "https://pants.place";
      }
    });

    // 3. Menu bar (native Win98 File / View / Maps / Favorites / Help)
    const menubar = document.createElement("nav");
    menubar.className = "pp98-menubar";
    menubar.setAttribute("aria-label", "Application menu");

    const menus = [
      { id: "file", label: "<u>F</u>ile", key: "f" },
      { id: "view", label: "<u>V</u>iew", key: "v" },
      { id: "maps", label: "<u>M</u>aps", key: "m" },
      { id: "favorites", label: "F<u>a</u>vorites", key: "a" },
      { id: "help", label: "<u>H</u>elp", key: "h" },
    ];

    let openMenuId = null;

    function closeMenus() {
      openMenuId = null;
      menubar.querySelectorAll(".pp98-menu-trigger").forEach((b) => b.classList.remove("open"));
      menubar.querySelectorAll(".pp98-dropdown").forEach((d) => d.classList.remove("open"));
    }

    function renderMenuItems(menuId, dropdown) {
      const bm = window.bluemap;
      dropdown.innerHTML = "";

      const addItem = (label, onClick, opts = {}) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pp98-menu-item";
        if (opts.disabled) btn.disabled = true;
        const check = opts.checked ? "✓" : opts.bullet ? "•" : "";
        btn.innerHTML = `
          <span class="pp98-check">${check}</span>
          <span>${label}</span>
          ${opts.shortcut ? `<span class="pp98-shortcut">${opts.shortcut}</span>` : ""}
        `;
        btn.addEventListener("click", () => {
          closeMenus();
          onClick?.();
        });
        dropdown.appendChild(btn);
      };

      const addSep = () => {
        const sep = document.createElement("div");
        sep.className = "pp98-menu-sep";
        dropdown.appendChild(sep);
      };

      const addHeader = (text) => {
        const h = document.createElement("div");
        h.className = "pp98-menu-header";
        h.textContent = text;
        dropdown.appendChild(h);
      };

      if (menuId === "file") {
        // All original BlueMap hamburger menu items consolidated into Win98 File menu
        addItem("Maps...", () => openSidebarPage("maps", "Maps"));
        addItem("Markers...", () => {
          const markerSet = bm?.mapViewer?.markers?.data;
          if (markerSet) openSidebarPage("markers", "Markers", { markerSet });
        });
        addItem("Settings...", () => openSidebarPage("settings", "Settings"));
        addItem("Info...", () => openSidebarPage("info", "Info"));
        addItem("Close Sidebar", () => bm?.appState?.menu?.closeAll?.(), {
          disabled: !bm?.appState?.menu?.isOpen,
        });
        addSep();
        addItem("Take Screenshot (PNG)...", () => {
          patchScreenshot();
          bm?.takeScreenshot?.();
          showToast(activeCrtPreset !== "off" ? "Saved CRT screenshot (PNG)" : "Saved screenshot (PNG)");
        }, { shortcut: "Ctrl+S" });
        addItem("Copy Map Link", async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            showToast("Map link copied to clipboard");
          } catch {
            showToast("Could not access clipboard");
          }
        });
        addItem("Update Map", async () => {
          if (bm?.mapViewer?.map) {
            const root = bm.mapViewer.map.data.mapDataRoot;
            const m = await window.__pp98Manifest?.reload?.(root);
            const count = m ? Object.keys(m.tiles || {}).length : 0;
            await bm.switchMap(bm.mapViewer.map.data.id);
            showToast(`Map updated (${count} changed tiles tracked)`);
          }
        });
        addItem("Reset Camera", () => bm?.resetCamera?.());
        if (!isEmbedded()) {
          addItem("Go Fullscreen", () => {
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            else document.documentElement.requestFullscreen?.().catch(() => {});
          }, { checked: Boolean(document.fullscreenElement) });
        }
        const liveEnabled = Boolean(bm?.settings?.enableLiveData);
        if (liveEnabled) {
          addItem("Refresh Players & Markers", async () => {
            await window.__pp98RefreshLive?.();
            showToast("Checked players & markers");
          });
        }
        if (!isEmbedded()) {
          addSep();
          addItem("Return to Pants Place 98", () => {
            window.location.href = "https://pants.place";
          });
        }
      } else if (menuId === "view") {
        const state = bm?.appState?.controls?.state || "perspective";
        addItem("Perspective (3D)", () => bm?.setPerspectiveView?.(), { bullet: state === "perspective" });
        addItem("Flat (Top-Down)", () => bm?.setFlatView?.(), { bullet: state === "flat" });
        addItem("Free Flight", () => bm?.setFreeFlight?.(), { bullet: state === "free" });
        addSep();
        addItem("Toggle Day / Night", () => {
          const u = bm?.mapViewer?.data?.uniforms?.sunlightStrength;
          if (u) {
            u.value = u.value > 0.6 ? 0.25 : 1;
            bm?.mapViewer?.redraw?.();
          }
        });
        addSep();
        addHeader("Color Scheme");
        const curScheme = getScheme();
        for (const s of SCHEMES) {
          addItem(s.label, () => applyScheme(s.id, true), { bullet: curScheme === s.id });
        }
        addSep();
        addHeader("CRT Monitor (WebGL)");
        const curCrt = getCrtPreset();
        for (const p of CRT_PRESETS) {
          addItem(p.label, () => applyCrt(p.id, true), { bullet: curCrt === p.id });
        }
      } else if (menuId === "maps") {
        const activeId = bm?.mapViewer?.map?.data?.id;
        const maps = bm?.appState?.maps || [];
        if (maps.length === 0) {
          addItem("Loading maps...", null, { disabled: true });
        } else {
          for (const m of maps) {
            addItem(m.name || m.id, () => bm?.switchMap?.(m.id), { bullet: m.id === activeId });
          }
        }
      } else if (menuId === "favorites") {
        addItem("Add Current Location...", showAddFavoriteModal);
        addItem("Organize Favorites...", showOrganizeFavoritesModal);
        addSep();
        addHeader("Server Landmarks");
        for (const fav of DEFAULT_FAVORITES) {
          addItem(fav.name, () => jumpToFavorite(fav), { shortcut: `${fav.x}, ${fav.z}` });
        }
        const userFavs = loadUserFavorites();
        if (userFavs.length > 0) {
          addSep();
          addHeader("My Bookmarks");
          for (const fav of userFavs) {
            addItem(fav.name, () => jumpToFavorite(fav), { shortcut: `${fav.x}, ${fav.z}` });
          }
        }
      } else if (menuId === "help") {
        addItem("Controls & Info...", () => openSidebarPage("info", "Info"));
        addSep();
        addItem("About BlueMap 98...", showAboutModal);
      }
    }

    const menuOpeners = new Map();

    for (const m of menus) {
      const root = document.createElement("div");
      root.className = "pp98-menu-root";

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "pp98-menu-trigger";
      trigger.innerHTML = m.label;

      const dropdown = document.createElement("div");
      dropdown.className = "pp98-dropdown";

      const openThis = () => {
        closeMenus();
        openMenuId = m.id;
        renderMenuItems(m.id, dropdown);
        trigger.classList.add("open");
        dropdown.classList.add("open");
      };
      menuOpeners.set(m.id, openThis);

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (openMenuId === m.id) closeMenus();
        else openThis();
      });

      trigger.addEventListener("mouseenter", () => {
        if (openMenuId && openMenuId !== m.id) openThis();
      });

      root.appendChild(trigger);
      root.appendChild(dropdown);
      menubar.appendChild(root);
    }

    document.addEventListener("click", (e) => {
      if (openMenuId && !menubar.contains(e.target)) closeMenus();
    });

    // Windows 98 keyboard shortcuts & Alt-key menu mnemonics
    document.addEventListener("keydown", (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      const inInput = tag === "input" || tag === "textarea" || e.target?.isContentEditable;

      // Ctrl+S / Cmd+S -> instant CRT screenshot
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        closeMenus();
        patchScreenshot();
        window.bluemap?.takeScreenshot?.();
        showToast(activeCrtPreset !== "off" ? "Saved CRT screenshot (PNG)" : "Saved screenshot (PNG)");
        return;
      }

      if (inInput) return;

      // Alt+F / Alt+V / Alt+M / Alt+A / Alt+H -> Win98 menu mnemonics
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const k = e.key.toLowerCase();
        const target = menus.find((m) => m.key === k);
        if (target) {
          e.preventDefault();
          if (openMenuId === target.id) closeMenus();
          else menuOpeners.get(target.id)?.();
          return;
        }
      }

      // Left / Right arrows cycle across open Win98 menus
      if (openMenuId && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const idx = menus.findIndex((m) => m.id === openMenuId);
        const step = e.key === "ArrowRight" ? 1 : -1;
        const next = menus[(idx + step + menus.length) % menus.length];
        menuOpeners.get(next.id)?.();
        return;
      }

      if (e.key === "Escape") {
        if (openMenuId) {
          closeMenus();
        } else if (window.bluemap?.appState?.menu?.isOpen) {
          window.bluemap.appState.menu.closeAll();
        }
      }
    });

    document.body.appendChild(menubar);

    // 4. Sunken 3D viewport bezel overlay
    const bezel = document.createElement("div");
    bezel.className = "pp98-viewport-bezel";
    document.body.appendChild(bezel);

    // 5. Status bar
    const statusbar = document.createElement("footer");
    statusbar.className = "pp98-statusbar";
    statusbar.innerHTML = `
      <div class="pp98-status-field grow" data-pp98-map>Ready — mc.pants.place</div>
      <div class="pp98-status-field coords" data-pp98-coords>X: 0  Y: 64  Z: 0</div>
      <div class="pp98-status-field mode" data-pp98-mode>Perspective</div>
      <div class="pp98-status-field players" data-pp98-players>
        <span class="pp98-status-dot"></span>
        <span>0 online</span>
      </div>
      <div class="pp98-status-grip" aria-hidden="true"></div>
    `;
    document.body.appendChild(statusbar);

    const mapField = statusbar.querySelector("[data-pp98-map]");
    const coordsField = statusbar.querySelector("[data-pp98-coords]");
    const modeField = statusbar.querySelector("[data-pp98-mode]");
    const playersBox = statusbar.querySelector("[data-pp98-players]");
    const playersDot = playersBox.querySelector(".pp98-status-dot");
    const playersField = playersBox.querySelector("span:last-child");
    const titleText = titlebar.querySelector(".pp98-titlebar-text");

    function isLiveEnabled() {
      return Boolean(window.bluemap?.settings?.enableLiveData);
    }

    const MODE_LABELS = {
      perspective: "3D View",
      flat: "Flat View",
      free: "Free Flight",
    };

    // Adaptive backoff polling for live/players.json & live/markers.json.
    // Permanently disables BlueMap's 1s player poll and 10s marker poll (including
    // any already-in-flight update() promises) so idle tabs poll at 5m and back off
    // smoothly up to once every 6 hours, pausing completely while hidden.
    const EMPTY_BACKOFF_MS = [
      5 * 60 * 1000,      // empty #1: 5m
      15 * 60 * 1000,     // empty #2: 15m
      30 * 60 * 1000,     // empty #3: 30m
      60 * 60 * 1000,     // empty #4: 1h
      3 * 60 * 60 * 1000, // empty #5: 3h
      6 * 60 * 60 * 1000, // empty #6+: 6h (max)
    ];
    const ACTIVE_PLAYER_POLL_MS = 5 * 60 * 1000;   // 5m when players are online
    const MIN_MARKER_POLL_MS = 5 * 60 * 1000;      // 5m minimum for markers.json

    let emptyStreak = 0;
    let currentIntervalMs = ACTIVE_PLAYER_POLL_MS;
    let playerTimer = null;
    let markerTimer = null;
    let nextPlayerAt = 0;
    let nextMarkerAt = 0;

    function formatInterval(ms) {
      if (ms >= 3600000) return `${Math.round(ms / 3600000)}h`;
      if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
      return `${Math.round(ms / 1000)}s`;
    }

    function getPlayerCount() {
      const bm = window.bluemap;
      const playerSet = bm?.mapViewer?.markers?.markerSets?.get?.("bm-players");
      return playerSet?.markers?.size ?? 0;
    }

    function computeNextInterval(count) {
      if (count > 0) {
        emptyStreak = 0;
        return ACTIVE_PLAYER_POLL_MS;
      }
      const idx = Math.min(emptyStreak, EMPTY_BACKOFF_MS.length - 1);
      emptyStreak += 1;
      return EMPTY_BACKOFF_MS[idx];
    }

    function schedulePlayerPoll(delayMs) {
      if (playerTimer) clearTimeout(playerTimer);
      currentIntervalMs = delayMs;
      nextPlayerAt = Date.now() + delayMs;
      playerTimer = setTimeout(() => {
        if (document.hidden) return;
        runPlayerPoll();
      }, delayMs);
    }

    function scheduleMarkerPoll(delayMs) {
      if (markerTimer) clearTimeout(markerTimer);
      const clamped = Math.max(delayMs, MIN_MARKER_POLL_MS);
      nextMarkerAt = Date.now() + clamped;
      markerTimer = setTimeout(() => {
        if (document.hidden) return;
        runMarkerPoll();
      }, clamped);
    }

    async function runPlayerPoll() {
      const bm = window.bluemap;
      const mgr = bm?.playerMarkerManager;
      if (!mgr || mgr.disposed) return;
      try {
        await mgr.update();
      } catch {
        // ignore transient network errors
      }
      const nextDelay = computeNextInterval(getPlayerCount());
      schedulePlayerPoll(nextDelay);
      updateStatus();
    }

    async function runMarkerPoll() {
      const bm = window.bluemap;
      const mgr = bm?.markerFileManager;
      if (!mgr || mgr.disposed) return;
      try {
        await mgr.update();
      } catch {
        // ignore transient network errors
      }
      scheduleMarkerPoll(currentIntervalMs);
    }

    async function refreshLiveNow() {
      emptyStreak = 0;
      await Promise.all([runPlayerPoll(), runMarkerPoll()]);
    }

    window.__pp98RefreshLive = refreshLiveNow;

    function disableBuiltInAutoUpdate(mgr) {
      if (!mgr) return;
      // Walk up prototype chain to neuter MarkerManager.prototype.setAutoUpdateInterval
      // so neither current nor future managers can ever arm 1s / 10s timers.
      let proto = Object.getPrototypeOf(mgr);
      while (proto && proto !== Object.prototype) {
        if (Object.prototype.hasOwnProperty.call(proto, "setAutoUpdateInterval")) {
          if (!proto.__pp98Neutered) {
            proto.setAutoUpdateInterval = function () {
              if (this._updateInterval) {
                clearTimeout(this._updateInterval);
                this._updateInterval = null;
              }
            };
            proto.__pp98Neutered = true;
          }
          break;
        }
        proto = Object.getPrototypeOf(proto);
      }
      if (mgr._updateInterval) {
        clearTimeout(mgr._updateInterval);
        mgr._updateInterval = null;
      }
    }

    async function attachAdaptivePolling() {
      const bm = window.bluemap;
      if (!bm || bm.__pp98AdaptivePolling) return;
      bm.__pp98AdaptivePolling = true;

      // 1. Neuter MarkerManager.prototype.setAutoUpdateInterval globally
      disableBuiltInAutoUpdate(bm.playerMarkerManager);
      disableBuiltInAutoUpdate(bm.markerFileManager);

      // 2. Dispose any existing managers to kill any stray timers
      const hadPlayers = Boolean(bm.playerMarkerManager);
      const hadMarkers = Boolean(bm.markerFileManager);
      bm.playerMarkerManager?.dispose?.();
      bm.markerFileManager?.dispose?.();

      // Feature flag: when enableLiveData is false in settings.json, do not poll live/* at all
      if (!isLiveEnabled()) {
        return;
      }

      // 3. Wrap map-switch initializers so switching dimensions stays on adaptive polling
      const origInitPlayers = bm.initPlayerMarkerManager?.bind(bm);
      if (origInitPlayers) {
        bm.initPlayerMarkerManager = async (...args) => {
          const res = await origInitPlayers(...args);
          disableBuiltInAutoUpdate(bm.playerMarkerManager);
          emptyStreak = 0;
          const nextDelay = computeNextInterval(getPlayerCount());
          schedulePlayerPoll(nextDelay);
          return res;
        };
      }

      const origInitMarkers = bm.initMarkerFileManager?.bind(bm);
      if (origInitMarkers) {
        bm.initMarkerFileManager = async (...args) => {
          const res = await origInitMarkers(...args);
          disableBuiltInAutoUpdate(bm.markerFileManager);
          scheduleMarkerPoll(currentIntervalMs);
          return res;
        };
      }

      // 4. Re-initialize fresh (timer-free) managers for the currently loaded map
      if (hadPlayers && bm.initPlayerMarkerManager) {
        await bm.initPlayerMarkerManager();
      } else {
        schedulePlayerPoll(computeNextInterval(getPlayerCount()));
      }
      if (hadMarkers && bm.initMarkerFileManager) {
        await bm.initMarkerFileManager();
      } else {
        scheduleMarkerPoll(currentIntervalMs);
      }

      // 5. Resume deferred polls only when returning to a hidden tab
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        const now = Date.now();
        if (now >= nextPlayerAt) runPlayerPoll();
        if (now >= nextMarkerAt) runMarkerPoll();
      });
    }

    playersBox.addEventListener("click", async () => {
      if (!isLiveEnabled()) {
        showToast("Live players & markers are disabled");
        return;
      }
      await refreshLiveNow();
      showToast("Checked players & markers");
    });

    function updateStatus() {
      const bm = window.bluemap;
      if (!bm) return;

      const mapName = bm.mapViewer?.map?.data?.name || bm.mapViewer?.map?.data?.id;
      if (mapName) {
        mapField.textContent = `${mapName} — mc.pants.place`;
        if (titleText) titleText.textContent = `BlueMap 98 — ${mapName}`;
      }

      const pos = bm.mapViewer?.controlsManager?.position;
      if (pos) {
        const x = Math.round(pos.x);
        const y = Math.round(pos.y);
        const z = Math.round(pos.z);
        coordsField.textContent = `X: ${x}  Y: ${y}  Z: ${z}`;
      }

      const state = bm.appState?.controls?.state || "perspective";
      modeField.textContent = MODE_LABELS[state] || state;

      if (!isLiveEnabled()) {
        playersDot.classList.add("offline");
        playersField.textContent = "Live: Off";
        playersBox.title = "Live player & marker polling is disabled (static mode)";
      } else {
        playersDot.classList.remove("offline");
        const count = getPlayerCount();
        playersField.textContent = `${count} online`;
        playersBox.title = `${count} online — polling every ${formatInterval(currentIntervalMs)} (click to refresh now)`;
      }
    }

    function setSvgIcon(btn, iconKey) {
      if (!btn) return;
      const svg = btn.querySelector("svg");
      if (!svg || svg.getAttribute("data-pp98-icon") === iconKey) return;
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("shape-rendering", "crispEdges");
      svg.setAttribute("data-pp98-icon", iconKey);
      svg.innerHTML = WIN98_ICONS[iconKey];
    }

    function applyWin98UiPolish() {
      // 1. Replace BlueMap's modern toolbar SVGs with crisp 16x16 Win98 pixel-art icons
      const bar = document.querySelector(".control-bar");
      if (bar) {
        setSvgIcon(bar.querySelector(".day-night-switch"), "dayNight");
        setSvgIcon(bar.querySelector(".compass"), "compass");

        const viewBtns = bar.querySelectorAll(".controls-switch > .svg-button");
        if (viewBtns[0]) setSvgIcon(viewBtns[0], "perspective");
        if (viewBtns[1]) setSvgIcon(viewBtns[1], "flat");
        if (viewBtns[2]) setSvgIcon(viewBtns[2], "freeFlight");

        // Identify remaining direct toolbar buttons by position & title
        const posInput = bar.querySelector(".pos-input");
        const directBtns = Array.from(bar.children).filter(
          (el) =>
            el.classList.contains("svg-button") &&
            !el.classList.contains("menu-button") &&
            !el.classList.contains("day-night-switch") &&
            !el.classList.contains("compass"),
        );

        for (const btn of directBtns) {
          if (posInput && btn.nextElementSibling === posInput) {
            setSvgIcon(btn, "resetCamera");
            continue;
          }
          const t = (btn.getAttribute("title") || "").toLowerCase();
          if (t.includes("reset") || t.includes("camera")) {
            setSvgIcon(btn, "resetCamera");
          } else if (t.includes("marker")) {
            setSvgIcon(btn, "markers");
          } else if (t.includes("player")) {
            setSvgIcon(btn, "players");
          } else {
            setSvgIcon(btn, "maps");
          }
        }
      }

      // 2. Replace Zoom In / Zoom Out icons with 16x16 Win98 magnifying glasses
      const zoomBtns = document.querySelectorAll("#zoom-buttons > .svg-button");
      if (zoomBtns[0]) setSvgIcon(zoomBtns[0], "zoomIn");
      if (zoomBtns[1]) setSvgIcon(zoomBtns[1], "zoomOut");

      // 3. Hide BlueMap's redundant built-in Theme group in File -> Settings...
      document.querySelectorAll(".side-menu .group").forEach((group) => {
        if (group.getAttribute("data-pp98-hidden") === "1") return;
        const labels = Array.from(group.querySelectorAll(".simple-button .label")).map((el) =>
          (el.textContent || "").trim().toLowerCase(),
        );
        const title = (group.querySelector(":scope > .title")?.textContent || "").trim().toLowerCase();
        const isThemeGroup =
          title === "theme" ||
          (labels.includes("light") && labels.includes("dark") && labels.some((l) => l.includes("contrast")));
        if (isThemeGroup) {
          group.setAttribute("data-pp98-hidden", "1");
        }
      });
    }

    function dismissLoadingDialog() {
      const overlay = document.getElementById("pp98-loading");
      if (!overlay || overlay.classList.contains("hidden")) return;
      window.__pp98SetLoadProgress?.(100, "World loaded!");
      setTimeout(() => overlay.classList.add("hidden"), 160);
    }

    function watchLoadingState() {
      const bm = window.bluemap;
      const check = () => {
        const st = bm?.mapViewer?.data?.mapState;
        if (st === "loaded" || st === "errored") {
          dismissLoadingDialog();
          return true;
        }
        return false;
      };
      if (check()) return;
      bm?.events?.addEventListener?.("bluemapMapChanged", dismissLoadingDialog, { once: true });
      const poll = setInterval(() => {
        if (check()) clearInterval(poll);
      }, 150);
      // Failsafe so the loading dialog never blocks the screen permanently
      setTimeout(() => {
        clearInterval(poll);
        dismissLoadingDialog();
      }, 12000);
    }

    let polishQueued = false;
    const schedulePolish = () => {
      if (polishQueued) return;
      polishQueued = true;
      requestAnimationFrame(() => {
        polishQueued = false;
        applyWin98UiPolish();
      });
    };
    const appEl = document.getElementById("app");
    if (appEl && typeof MutationObserver !== "undefined") {
      new MutationObserver(schedulePolish).observe(appEl, { childList: true, subtree: true });
    }

    patchScreenshot();
    attachAdaptivePolling();
    applyWin98UiPolish();
    watchLoadingState();
    updateStatus();
    setInterval(updateStatus, 500);

    // Ensure Three.js WebGL renderer matches the new sunken viewport dimensions
    // and attach the WebGL CRT post-processing overlay onto the map canvas.
    requestAnimationFrame(() => {
      triggerResize();
      syncCrtFilter();
      setTimeout(() => {
        triggerResize();
        syncCrtFilter();
      }, 250);
    });
  }

  initEnvironment();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildChrome);
  } else {
    buildChrome();
  }
})();
