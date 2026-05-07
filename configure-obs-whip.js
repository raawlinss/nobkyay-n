"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_RENDER_URL = "https://nobkyayin.onrender.com";
const DEFAULT_STREAM_KEY = "NOBK-RAW";
const DEFAULT_STREAM_PATH = "live";

loadLocalEnv();

const renderBase = normalizeBase(process.argv[2] || process.env.RENDER_URL || DEFAULT_RENDER_URL);
const streamKey = String(process.argv[3] || process.env.STREAM_KEY || DEFAULT_STREAM_KEY).trim();
const whipUrl = `${renderBase}/${DEFAULT_STREAM_PATH}/whip`;

try {
  const profileDir = resolveObsProfileDir();
  const servicePath = path.join(profileDir, "service.json");
  const basicIniPath = path.join(profileDir, "basic.ini");

  backupIfExists(servicePath);
  backupIfExists(basicIniPath);

  const serviceConfig = {
    type: "whip_custom",
    settings: {
      server: whipUrl,
      bearer_token: streamKey,
    },
  };

  fs.writeFileSync(servicePath, `${JSON.stringify(serviceConfig)}\n`, "utf8");

  if (fs.existsSync(basicIniPath)) {
    const updatedIni = upsertIniValue(
      fs.readFileSync(basicIniPath, "utf8"),
      "Output",
      "LowLatencyEnable",
      "true"
    );
    fs.writeFileSync(basicIniPath, updatedIni, "utf8");
  }

  console.log("OBS profili hazir.");
  console.log(`Profil klasoru : ${profileDir}`);
  console.log(`WHIP sunucu    : ${whipUrl}`);
  console.log(`Bearer Token   : ${maskSecret(streamKey)}`);
  console.log("Not: OBS aciksa kapatip yeniden acin.");
} catch (error) {
  console.error("OBS WHIP ayari basarisiz:", error.message);
  process.exitCode = 1;
}

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

function normalizeBase(value) {
  let base = String(value || DEFAULT_RENDER_URL).trim();
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base.replace(/\/+$/, "");
}

function resolveObsProfileDir() {
  const explicit = (process.env.OBS_PROFILE_DIR || "").trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`OBS_PROFILE_DIR bulunamadi: ${explicit}`);
    return explicit;
  }

  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const profilesRoot = path.join(appData, "obs-studio", "basic", "profiles");
  if (!fs.existsSync(profilesRoot)) throw new Error(`OBS profil klasoru bulunamadi: ${profilesRoot}`);

  const profiles = fs.readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(profilesRoot, entry.name);
      const stat = fs.statSync(fullPath);
      return { name: entry.name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (profiles.length === 0) throw new Error("OBS icinde kullanilabilir profil yok.");
  return profiles[0].fullPath;
}

function backupIfExists(filePath) {
  if (!fs.existsSync(filePath)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.bak-${stamp}`;
  fs.copyFileSync(filePath, backupPath);
}

function upsertIniValue(text, section, key, value) {
  const lines = text.split(/\r?\n/);
  const sectionHeader = `[${section}]`;
  let sectionStart = -1;
  let sectionEnd = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === sectionHeader) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) {
    const prefix = text.endsWith("\n") || text.length === 0 ? "" : "\n";
    return `${text}${prefix}${sectionHeader}\n${key}=${value}\n`;
  }

  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^\s*\[.*\]\s*$/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    if (lines[i].startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      return `${lines.join("\n")}\n`;
    }
  }

  lines.splice(sectionEnd, 0, `${key}=${value}`);
  return `${lines.join("\n")}\n`;
}

function maskSecret(value) {
  const s = String(value || "");
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}
