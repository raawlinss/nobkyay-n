"use strict";

// HLS.js segments can be large
const MAX_PROXY_BODY = 50 * 1024 * 1024; // 50MB for HLS segments

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

loadLocalEnv();

const PORT = Number.parseInt(process.env.PORT || "7860", 10);
const MEDIAMTX_HOST = (process.env.MEDIAMTX_HOST || "127.0.0.1").trim();
const MEDIAMTX_WEBRTC = `${MEDIAMTX_HOST}:8889`;
const MEDIAMTX_HLS = `${MEDIAMTX_HOST}:8888`;
const MEDIAMTX_API = `${MEDIAMTX_HOST}:9997`;
const PUBLIC_HLS_ORIGIN = (process.env.PUBLIC_HLS_ORIGIN || "").trim() || null;
const CHAT_LIMIT = 50;
const PUBLIC_DIR = path.join(__dirname, "public");

let streamKey = (process.env.STREAM_KEY || "NOBK-RAW").trim();
if (!streamKey) {
  streamKey = crypto.randomBytes(32).toString("base64url");
  console.warn("STREAM_KEY was not set. Generated temporary key:", streamKey);
}

const messages = [];
const sseClients = new Set();
const rateLimits = new Map();

/* ─── Utility ─── */
function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "Content-Type",
  });
  res.end(payload);
}

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req, maxBytes) {
  const body = await readBody(req, maxBytes);
  if (!body || body.length === 0) return {};
  return JSON.parse(body.toString("utf8"));
}

function cleanNick(v) {
  return String(v || "").replace(/[^\p{L}\p{N}_\-. ]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
}

function cleanMessage(v) {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, 220);
}

function maskSecret(v) {
  const s = String(v || "");
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

/* ─── Chat ─── */
function addMessage(nick, text) {
  const message = { id: crypto.randomUUID(), at: new Date().toISOString(), nick, text };
  messages.push(message);
  if (messages.length > CHAT_LIMIT) messages.splice(0, messages.length - CHAT_LIMIT);
  broadcastSse("message", message);
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastSse(event, data) {
  for (const res of sseClients) sendSse(res, event, data);
}

function broadcastPresence() {
  broadcastSse("presence", { viewers: sseClients.size });
}

function handleChatStream(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");
  sendSse(res, "history", { messages, limit: CHAT_LIMIT });
  sseClients.add(res);
  broadcastPresence();
  const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 25000);
  req.on("close", () => { clearInterval(keepAlive); sseClients.delete(res); broadcastPresence(); });
}

async function handleChatPost(req, res) {
  if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return; }
  try {
    const ip = getClientIp(req);
    const now = Date.now();
    const last = rateLimits.get(ip) || 0;
    if (now - last < 800) { json(res, 429, { ok: false, error: "slow_down" }); return; }
    rateLimits.set(ip, now);
    const body = await readJson(req, 4096);
    const nick = cleanNick(body.nick);
    const text = cleanMessage(body.text);
    if (nick.length < 2 || text.length < 1) { json(res, 422, { ok: false, error: "invalid_message" }); return; }
    addMessage(nick, text);
    json(res, 201, { ok: true });
  } catch { json(res, 400, { ok: false, error: "bad_request" }); }
}

/* ─── Stream Key Auth ─── */
function handleAuthKey(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "Content-Type",
    });
    res.end();
    return;
  }
  if (req.method !== "POST") { res.writeHead(405); res.end(); return; }

  readJson(req, 4096).then((body) => {
    const key = String(body.key || "").trim();
    if (key === streamKey) {
      json(res, 200, { ok: true });
    } else {
      json(res, 401, { ok: false, error: "invalid_key" });
    }
  }).catch(() => json(res, 400, { ok: false }));
}

/* ─── MediaMTX Auth Webhook ─── */
// MediaMTX calls this to authenticate publish/read actions
function handleMediaMtxAuth(req, res) {
  if (req.method !== "POST") { json(res, 200, { ok: true }); return; }
  
  readJson(req, 4096).then((body) => {
    console.log("MediaMTX Auth Webhook received:", body);
    const action = body.action; // "publish" or "read"
    
    if (action === "publish") {
      // Check stream key from query params or user field
      const user = body.user || "";
      const password = body.password || "";
      const query = body.query || "";
      
      const params = new URLSearchParams(query);
      const key = params.get("key") || params.get("jwt") || user || password;
      
      // Also check if they included the ?key= in the string
      let cleanedKey = key || "";
      if (cleanedKey.startsWith("?key=")) cleanedKey = cleanedKey.replace("?key=", "");
      if (cleanedKey.includes("/")) cleanedKey = cleanedKey.split("/")[0];
      
      // If publisher is localhost, allow it unconditionally to avoid path mismatches in OBS
      if (body.ip === "127.0.0.1" || body.ip === "::1" || cleanedKey === streamKey) {
        console.log("MediaMTX: publish authorized for path:", body.path);
        json(res, 200, { ok: true });
      } else {
        console.log(`MediaMTX: publish REJECTED. Expected '${maskSecret(streamKey)}', got '${maskSecret(cleanedKey)}'`);
        json(res, 401, { ok: false });
      }
    } else {
      // Allow all reads (viewers)
      json(res, 200, { ok: true });
    }
  }).catch((e) => {
    console.error("Auth webhook error:", e);
    json(res, 200, { ok: true });
  });
}

/* ─── MediaMTX Reverse Proxy ─── */
// Proxy WHIP/WHEP/HLS requests to internal MediaMTX ports
function proxyToMediaMtx(req, res, targetHost, targetPath) {
  const bodyChunks = [];
  req.on("data", chunk => bodyChunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(bodyChunks);
    
    // Build proxy headers - forward important ones
    const proxyHeaders = {};
    const forwardHeaders = [
      "content-type", "accept", "authorization",
      "if-match", "if-none-match", "range"
    ];
    for (const h of forwardHeaders) {
      if (req.headers[h]) proxyHeaders[h] = req.headers[h];
    }
    if (body.length > 0) {
      proxyHeaders["content-length"] = body.length;
    }

    const [host, port] = targetHost.split(":");
    const proxyReq = http.request({
      hostname: host,
      port: parseInt(port),
      path: targetPath,
      method: req.method,
      headers: proxyHeaders,
    }, (proxyRes) => {
      console.log(`[PROXY] ${req.method} ${targetPath} -> HTTP ${proxyRes.statusCode}`);
      // Build response headers
      const respHeaders = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "Content-Type, Authorization, If-Match",
        "access-control-expose-headers": "Location, ETag, Link, Content-Type",
      };
      
      // Forward important response headers from MediaMTX
      const copyHeaders = [
        "content-type", "location", "etag", "link",
        "accept-patch", "content-length"
      ];
      for (const h of copyHeaders) {
        if (proxyRes.headers[h]) {
          let val = proxyRes.headers[h];
          // Rewrite Location header to use public URL
          if (h === "location" && typeof val === "string") {
            val = val.replace(`http://${targetHost}`, "");
            console.log(`[PROXY] Location Header: ${val}`);
            
            // Fix: if it's relative, make it absolute using the request host
            if (val.startsWith("/")) {
              const proto = req.headers["x-forwarded-proto"] || "http";
              const hostHeader = req.headers.host || "localhost:7860";
              val = `${proto}://${hostHeader}${val}`;
              console.log(`[PROXY] Rewritten Location Header: ${val}`);
            }
          }
          respHeaders[h] = val;
        }
      }
      
      res.writeHead(proxyRes.statusCode, respHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error(`[PROXY ERROR] ${req.method} ${targetPath}:`, err.message);
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("Media server unavailable");
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
}

/* ─── Stream Status Check ─── */
async function checkStreamStatus() {
  return new Promise((resolve) => {
    const req = http.get(`http://${MEDIAMTX_API}/v3/paths/list`, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const livePath = parsed.items?.find(p => p.name === "live");
          resolve({
            online: livePath?.ready === true,
            readers: livePath?.readers?.length || 0,
            source: livePath?.source?.type || null,
          });
        } catch { resolve({ online: false, readers: 0, source: null }); }
      });
    });
    req.on("error", () => resolve({ online: false, readers: 0, source: null }));
    req.setTimeout(2000, () => { req.destroy(); resolve({ online: false, readers: 0, source: null }); });
  });
}

/* ─── Static Files ─── */
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return;
  }
  const safePath = pathname === "/" ? "/index.html" : pathname;
  let decoded;
  try { decoded = decodeURIComponent(safePath); } catch { res.writeHead(400); res.end(); return; }
  const filePath = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.writeHead(403); res.end(); return;
  }
  try {
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const noStore = [".html", ".css", ".js"].includes(ext);
    res.writeHead(200, {
      "content-type": mimeTypes.get(ext) || "application/octet-stream",
      "cache-control": noStore ? "no-store" : "public, max-age=3600, must-revalidate",
    });
    if (req.method === "HEAD") { res.end(); return; }
    res.end(data);
  } catch { notFound(res); }
}

/* ─── WebSocket for chat presence & stream events ─── */
function setupWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  const rtmpWss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("error", () => {});
  });

  rtmpWss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("error", () => {});
  });

  // Heartbeat
  setInterval(() => {
    for (const clients of [wss.clients, rtmpWss.clients]) {
      clients.forEach(ws => {
        if (!ws.isAlive) { ws.terminate(); return; }
        ws.isAlive = false;
        ws.ping();
      });
    }
  }, 30000);

  // Broadcast stream status periodically
  setInterval(async () => {
    const status = await checkStreamStatus();
    const msg = JSON.stringify({ type: "stream-status", ...status });
    wss.clients.forEach(ws => {
      if (ws.readyState === 1) ws.send(msg);
    });
  }, 3000);

  const net = require("net");
  
  rtmpWss.on("connection", (ws, req) => {
    console.log("RTMP Tunnel connected from OBS");
    let wsToRtmpBytes = 0;
    let rtmpToWsBytes = 0;
    let closed = false;

    const closeTunnel = (reason) => {
      if (closed) return;
      closed = true;
      console.log(`${reason} (WS->RTMP ${wsToRtmpBytes} bytes, RTMP->WS ${rtmpToWsBytes} bytes)`);
      if (!rtmpSocket.destroyed) rtmpSocket.end();
      if (ws.readyState === 1) ws.close();
    };

    const rtmpSocket = net.createConnection({ host: "127.0.0.1", port: 1935 }, () => {
      rtmpSocket.setNoDelay(true);
      console.log("RTMP Tunnel established to MediaMTX");
    });

    rtmpSocket.on("data", (data) => {
      rtmpToWsBytes += data.length;
      if (ws.readyState === 1) ws.send(data);
    });

    ws.on("message", (data) => {
      wsToRtmpBytes += data.length;
      if (!rtmpSocket.destroyed) rtmpSocket.write(data);
    });

    ws.on("close", (code, reason) => {
      const reasonText = reason?.toString?.() || "";
      closeTunnel(`RTMP Tunnel closed by OBS. code=${code}${reasonText ? ` reason=${reasonText}` : ""}`);
    });

    rtmpSocket.on("close", () => {
      closeTunnel("RTMP local connection closed");
    });

    rtmpSocket.on("error", (err) => {
      closeTunnel(`RTMP local error: ${err.message}`);
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else if (pathname === "/rtmp-tunnel") {
      const key = url.searchParams.get("key");
      if (key !== streamKey) {
        console.warn("RTMP Tunnel rejected: Invalid key");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      rtmpWss.handleUpgrade(req, socket, head, (ws) => {
        rtmpWss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });
}

/* ─── HTTP Server ─── */
const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization, If-Match",
      "access-control-expose-headers": "Location, ETag, Link",
    });
    res.end();
    return;
  }

  // ── API routes ──
  if (pathname === "/api/health") { json(res, 200, { ok: true }); return; }
  if (pathname === "/api/auth/stream-key") { handleAuthKey(req, res); return; }
  if (pathname === "/api/chat/stream") { handleChatStream(req, res); return; }
  if (pathname === "/api/chat/messages") { await handleChatPost(req, res); return; }
  if (pathname === "/api/mediamtx/auth") { handleMediaMtxAuth(req, res); return; }
  if (pathname === "/api/config") {
    const status = await checkStreamStatus();
    json(res, 200, {
      chatLimit: CHAT_LIMIT,
      viewerCount: sseClients.size,
      broadcasterOnline: status.online,
      readers: status.readers,
      hlsOrigin: PUBLIC_HLS_ORIGIN,
      playback: { primary: "webrtc", fallback: "hls" },
    });
    return;
  }

  // ── WHIP proxy (OBS publishes here) ──
  if (pathname === "/live/whip" || pathname === "/live/whip/") {
    proxyToMediaMtx(req, res, MEDIAMTX_WEBRTC, pathname + requestUrl.search);
    return;
  }

  // ── WHEP proxy (viewers connect here) ──
  if (pathname === "/live/whep" || pathname === "/live/whep/") {
    proxyToMediaMtx(req, res, MEDIAMTX_WEBRTC, pathname + requestUrl.search);
    return;
  }

  // ── WHIP/WHEP session endpoints (ICE candidates, teardown) ──
  if (pathname.startsWith("/live/whip/") || pathname.startsWith("/live/whep/")) {
    proxyToMediaMtx(req, res, MEDIAMTX_WEBRTC, pathname + requestUrl.search);
    return;
  }

  // ── HLS proxy (all other /live/ paths: .m3u8, .ts, .mp4, .m4s, etc.) ──
  if (pathname.startsWith("/live/") && !pathname.includes("/whip") && !pathname.includes("/whep")) {
    proxyToMediaMtx(req, res, MEDIAMTX_HLS, pathname + requestUrl.search);
    return;
  }

  // ── Static files ──
  await serveStatic(req, res, pathname);
});

setupWebSocket(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NOBKFILM Live listening on 0.0.0.0:${PORT}`);
  console.log(`Stream Key: ${streamKey.slice(0, 6)}...`);
  console.log("OBS WHIP URL: https://<your-domain>/live/whip?key=<stream-key>");
  console.log(`MediaMTX WebRTC: ${MEDIAMTX_WEBRTC}`);
  console.log(`MediaMTX HLS: ${MEDIAMTX_HLS}`);
});

process.on("SIGTERM", () => { server.close(() => process.exit(0)); });
