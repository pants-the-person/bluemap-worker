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

    // 3. Menu bar (native Win98 File / View / Maps / Help)
    const menubar = document.createElement("nav");
    menubar.className = "pp98-menubar";
    menubar.setAttribute("aria-label", "Application menu");

    const menus = [
      { id: "file", label: "<u>F</u>ile" },
      { id: "view", label: "<u>V</u>iew" },
      { id: "maps", label: "<u>M</u>aps" },
      { id: "help", label: "<u>H</u>elp" },
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
        });
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
          const viewer = bm?.mapViewer;
          if (viewer?.data) {
            viewer.data.sunlight = viewer.data.sunlight < 0.5 ? 1 : 0.1;
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
      } else if (menuId === "help") {
        addItem("Controls & Info...", () => openSidebarPage("info", "Info"));
        addSep();
        addItem("About BlueMap 98...", showAboutModal);
      }
    }

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
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && openMenuId) closeMenus();
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

    patchScreenshot();
    attachAdaptivePolling();
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
