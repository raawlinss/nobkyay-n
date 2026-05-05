"use strict";

/* ─── State ─── */
const S = {
  role: null,
  ws: null,
  pc: null,
  hls: null,
  mode: "hls",
  nick: localStorage.getItem("nobk_nick") || "",
  liveAt: null,
  streamKey: null,
  isLive: false,
  retryTimer: null,
  hlsOrigin: null,   // populated from /api/config
};

/* ─── DOM ─── */
const $ = id => document.getElementById(id);
const els = {};

const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ]
};

/* ─── Boot ─── */
document.addEventListener("DOMContentLoaded", () => {
  els.appShell = $("appShell");
  els.viewerVideo = $("viewerVideo");
  els.emptyState = $("emptyState");
  els.emptySubtext = $("emptySubtext");
  els.livePill = $("livePill");
  els.modePill = $("modePill");
  els.qualityPill = $("qualityPill");
  els.status = $("connectionStatus");
  els.muteBtn = $("muteButton");
  els.fsBtn = $("fullscreenButton");
  els.viewerCount = $("viewerCount");
  els.liveTimer = $("liveTimer");
  els.nickGate = $("nickGate");
  els.nickForm = $("nickForm");
  els.nickInput = $("nickInput");
  els.skGate = $("streamKeyGate");
  els.skForm = $("streamKeyForm");
  els.skInput = $("streamKeyInput");
  els.skError = $("keyError");
  els.adminOverlay = $("adminOverlay");
  els.twitchChat = $("twitchChatFrame");
  els.cinemaBtn = $("cinemaButton");
  els.panelDragHandle = $("panelDragHandle");
  els.minimizeBtn = $("minimizePanelBtn");
  els.sourcePanel = $("sourcePanel");
  els.modeToggle = $("modeToggle");

  // Twitch chat embed
  if (els.twitchChat) {
    const hostname = location.hostname;
    const parents = [hostname];
    if (hostname.endsWith('.hf.space')) parents.push('huggingface.co');
    if (hostname.endsWith('.onrender.com')) parents.push('onrender.com');
    const parentParams = parents.map(p => `parent=${p}`).join('&');
    els.twitchChat.src = `https://www.twitch.tv/embed/nobk/chat?${parentParams}&darkpopout`;
  }

  bindUI();
  detectRole();
  connectChat();
  startTimer();
  connectWebSocket();
  pollStreamStatus();
});

function detectRole() {
  const hash = location.hash;
  if (hash === "#nobk-raw" || hash === "#broadcaster" || hash === "#admin") {
    showStreamKeyGate();
  } else {
    showNickGate();
  }
}

/* ─── Nick Gate ─── */
function showNickGate() {
  if (S.nick) { els.nickGate.classList.add("is-hidden"); return; }
  els.nickGate.classList.remove("is-hidden");
  setTimeout(() => els.nickInput.focus(), 80);
}

/* ─── Stream Key Gate ─── */
function showStreamKeyGate() {
  els.nickGate.classList.add("is-hidden");
  els.skGate.removeAttribute("hidden");
  setTimeout(() => els.skInput.focus(), 80);
}

/* ─── Bind UI ─── */
function bindUI() {
  els.nickForm.addEventListener("submit", e => {
    e.preventDefault();
    const nick = cleanNick(els.nickInput.value);
    if (nick.length < 2) { els.nickInput.focus(); return; }
    if (nick === "NOBK-RAW") { showStreamKeyGate(); return; }
    S.nick = nick;
    localStorage.setItem("nobk_nick", nick);
    els.nickGate.classList.add("is-hidden");
  });

  els.skForm.addEventListener("submit", async e => {
    e.preventDefault();
    const key = els.skInput.value.trim();
    if (!key) return;
    try {
      const r = await fetch("/api/auth/stream-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const d = await r.json();
      if (d.ok) {
        S.streamKey = key;
        S.role = "admin";
        els.skGate.setAttribute("hidden", "");
        els.skError.setAttribute("hidden", "");
        els.nickGate.classList.add("is-hidden");
        showAdminPanel();
      } else {
        els.skError.removeAttribute("hidden");
        els.skInput.value = "";
        els.skInput.focus();
      }
    } catch { els.skError.removeAttribute("hidden"); }
  });

  // Mute toggle
  els.muteBtn.addEventListener("click", () => {
    const v = els.viewerVideo;
    v.muted = !v.muted;
    els.muteBtn.textContent = v.muted ? "🔇" : "🔊";
  });

  // Fullscreen
  els.fsBtn.addEventListener("click", () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    $("playerShell").requestFullscreen?.();
  });

  // Cinema mode
  els.cinemaBtn?.addEventListener("click", () => {
    els.appShell.classList.toggle("cinema-mode");
  });

  // Mode toggle removed

  // Panel Dragging
  let isDraggingPanel = false, startX, startY, initialLeft, initialTop;
  els.panelDragHandle?.addEventListener("mousedown", e => {
    if (e.target.tagName === "BUTTON") return;
    isDraggingPanel = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = els.adminOverlay.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    els.adminOverlay.style.left = initialLeft + "px";
    els.adminOverlay.style.top = initialTop + "px";
    els.adminOverlay.style.bottom = "auto";
    els.adminOverlay.style.right = "auto";
  });
  window.addEventListener("mousemove", e => {
    if (!isDraggingPanel) return;
    els.adminOverlay.style.left = (initialLeft + e.clientX - startX) + "px";
    els.adminOverlay.style.top = (initialTop + e.clientY - startY) + "px";
  });
  window.addEventListener("mouseup", () => { isDraggingPanel = false; });

  // Minimize
  els.minimizeBtn?.addEventListener("click", () => {
    els.sourcePanel.classList.toggle("minimized");
    if (els.minimizeBtn) {
      els.minimizeBtn.textContent = els.sourcePanel.classList.contains("minimized") ? "□" : "_";
    }
  });
}

/* ─── Admin Panel ─── */
function showAdminPanel() {
  els.adminOverlay.removeAttribute("hidden");
  const baseUrl = `${location.protocol}//${location.host}`;
  const whipField = $("whipUrlField");
  const keyField = $("streamKeyField");
  if (whipField) whipField.value = `${baseUrl}/live/whip`;
  if (keyField) keyField.value = S.streamKey;

  $("copyWhipUrl")?.addEventListener("click", () => {
    navigator.clipboard.writeText(`${baseUrl}/live/whip`).then(() => {
      $("copyWhipUrl").textContent = "✅";
      setTimeout(() => $("copyWhipUrl").textContent = "📋", 1500);
    });
  });
  $("copyStreamKey")?.addEventListener("click", () => {
    navigator.clipboard.writeText(S.streamKey).then(() => {
      $("copyStreamKey").textContent = "✅";
      setTimeout(() => $("copyStreamKey").textContent = "📋", 1500);
    });
  });
  $("toggleKeyVisibility")?.addEventListener("click", () => {
    if (keyField.type === "password") {
      keyField.type = "text";
      $("toggleKeyVisibility").textContent = "🙈";
    } else {
      keyField.type = "password";
      $("toggleKeyVisibility").textContent = "👁️";
    }
  });
}

/* ─── Playback Controller ─── */
function startPlayback() {
  connectHLS();
}

function stopPlayback() {
  // Stop HLS
  if (S.hls) { S.hls.destroy(); S.hls = null; }
  els.viewerVideo.srcObject = null;
  els.viewerVideo.src = "";
  if (S.retryTimer) { clearTimeout(S.retryTimer); S.retryTimer = null; }
}

/* ─── HLS Viewer ─── */
function connectHLS() {
  if (S.hls) { S.hls.destroy(); S.hls = null; }
  setStatus("HLS yükleniyor...");

  // Use external origin (Cloudflare tunnel) if set, otherwise use same server
  const hlsBase = S.hlsOrigin ? S.hlsOrigin : "";
  const hlsUrl = `${hlsBase}/live/index.m3u8`;

  if (typeof Hls !== "undefined" && Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 10,
      maxMaxBufferLength: 30,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 6,
      liveDurationInfinity: true,
      xhrSetup: (xhr) => {
        xhr.timeout = 10000;
      },
    });
    S.hls = hls;

    hls.loadSource(hlsUrl);
    hls.attachMedia(els.viewerVideo);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      els.viewerVideo.play().catch(() => {});
      markLive();
      setStatus("📺 HLS Aktif");
    });

    hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
      const level = data.details;
      if (level && level.totalduration) {
        const latency = Math.round(level.totalduration);
        if (els.qualityPill) {
          const lvl = hls.levels?.[hls.currentLevel];
          if (lvl) {
            els.qualityPill.textContent = `${lvl.width}x${lvl.height} ~${latency}s`;
          }
        }
      }
    });

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        console.warn("HLS fatal error:", data.type, data.details);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setStatus("HLS: ağ hatası, yeniden deneniyor...");
          hls.destroy(); S.hls = null;
          scheduleReconnect();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          hls.destroy(); S.hls = null;
          setStatus("HLS hatası");
          scheduleReconnect();
        }
      }
    });

  } else if (els.viewerVideo.canPlayType("application/vnd.apple.mpegurl")) {
    // Safari native HLS
    els.viewerVideo.src = hlsUrl;
    els.viewerVideo.addEventListener("loadedmetadata", () => {
      els.viewerVideo.play().catch(() => {});
      markLive();
      setStatus("📺 HLS Aktif (Native)");
    });
  } else {
    setStatus("HLS desteklenmiyor.");
  }
}

/* ─── Reconnect Logic ─── */
function scheduleReconnect() {
  if (S.retryTimer) return;
  S.retryTimer = setTimeout(() => {
    S.retryTimer = null;
    if (S.isLive) startPlayback();
  }, 4000);
}

async function updateQualityInfo() {
  // HLS updates quality inside the LEVEL_LOADED event
}

/* ─── Stream Status Polling ─── */
async function pollStreamStatus() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    const d = await r.json();
    const wasLive = S.isLive;
    S.isLive = d.broadcasterOnline;

    // Store external HLS origin (Cloudflare tunnel URL) if provided
    if (d.hlsOrigin && d.hlsOrigin !== S.hlsOrigin) {
      S.hlsOrigin = d.hlsOrigin;
      console.log("[HLS] Origin set to:", S.hlsOrigin);
    }

    if (S.isLive && !wasLive) {
      startPlayback();
    } else if (!S.isLive && wasLive) {
      markOffline();
    } else if (!S.isLive) {
      setStatus("Yayın bekleniyor");
    }

    // Update admin panel
    const adminStatus = $("adminStreamStatus");
    const adminViewers = $("adminViewerCount");
    if (adminStatus) {
      adminStatus.textContent = S.isLive ? "● Canlı" : "● Çevrimdışı";
      adminStatus.className = "admin-value " + (S.isLive ? "status-live" : "status-offline");
    }
    if (adminViewers) adminViewers.textContent = d.readers || d.viewerCount || 0;
  } catch {}
  setTimeout(pollStreamStatus, 4000);
}

/* ─── WebSocket for live updates ─── */
function connectWebSocket() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  S.ws = ws;

  ws.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "stream-status") {
        const wasLive = S.isLive;
        S.isLive = msg.online;
        if (msg.online && !wasLive) startPlayback();
        else if (!msg.online && wasLive) markOffline();
        if (els.viewerCount) els.viewerCount.textContent = msg.readers || 0;
      }
    } catch {}
  };

  ws.onclose = () => setTimeout(connectWebSocket, 5000);
  ws.onerror = () => {};
}

/* ─── UI helpers ─── */
function markLive() {
  els.emptyState.classList.add("is-hidden");
  els.livePill.classList.add("is-live");
  if (!S.liveAt) S.liveAt = Date.now();
  S.isLive = true;
}

function markOffline() {
  stopPlayback();
  els.emptyState.classList.remove("is-hidden");
  els.livePill.classList.remove("is-live");
  if (els.qualityPill) els.qualityPill.textContent = "Bağlanıyor...";
  S.liveAt = null;
  S.isLive = false;
  setStatus("Yayın bekleniyor");
}

function setStatus(t) { if (els.status) els.status.textContent = t; }

function startTimer() {
  setInterval(() => {
    if (!S.liveAt) { if (els.liveTimer) els.liveTimer.textContent = "00:00"; return; }
    const sec = Math.floor((Date.now() - S.liveAt) / 1000);
    const h = Math.floor(sec / 3600);
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    if (els.liveTimer) els.liveTimer.textContent = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }, 1000);
}

function cleanNick(v) {
  return String(v || "").replace(/[^\p{L}\p{N}_\-. ]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
}

/* ─── Chat (SSE) ─── */
function connectChat() {
  const src = new EventSource("/api/chat/stream");
  src.addEventListener("presence", e => {
    const d = JSON.parse(e.data);
    if (els.viewerCount) els.viewerCount.textContent = d.viewers || 0;
  });
  src.onerror = () => {};
}
