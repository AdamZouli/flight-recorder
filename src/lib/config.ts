import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig, Retention } from "./types.ts";

export const DEFAULT_CONFIG: AppConfig = {
  retention: "7d",
  paused: false,
  watchDownloads: true,
  watchDesktop: false,
  extraWatchlist: [],
  includeBackground: false,
  cpuSpikePercent: 80,
  cpuSpikeSeconds: 8,
  memSpikeBytes: 6 * 1024 * 1024 * 1024,
  sampleMs: 2000,
  port: 7842,
  bindLan: true,
};

export type PairingState = {
  token: string;
  code: string;
  codeExpires: number;
};

export function dataDir(): string {
  if (process.env.FLIGHT_RECORDER_HOME) {
    return process.env.FLIGHT_RECORDER_HOME;
  }
  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(base, "flight-recorder");
}

export function ensureDataDir(): string {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return join(ensureDataDir(), "events.db");
}

export function configPath(): string {
  return join(ensureDataDir(), "config.json");
}

export function pairingPath(): string {
  return join(ensureDataDir(), "pairing.json");
}

export function loadConfig(): AppConfig {
  const file = configPath();
  if (!existsSync(file)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AppConfig>;
    return normalizeConfig(raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
}

export function patchConfig(patch: Partial<AppConfig>): AppConfig {
  const next = normalizeConfig({ ...loadConfig(), ...patch });
  saveConfig(next);
  return next;
}

export function retentionMs(retention: Retention): number {
  if (retention === "24h") return 24 * 60 * 60 * 1000;
  if (retention === "30d") return 30 * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function normalizeConfig(raw: Partial<AppConfig>): AppConfig {
  const retention: Retention =
    raw.retention === "24h" || raw.retention === "30d" || raw.retention === "7d"
      ? raw.retention
      : DEFAULT_CONFIG.retention;
  return {
    retention,
    paused: Boolean(raw.paused),
    watchDownloads: raw.watchDownloads !== false,
    watchDesktop: Boolean(raw.watchDesktop),
    extraWatchlist: Array.isArray(raw.extraWatchlist)
      ? raw.extraWatchlist.map(String)
      : [],
    includeBackground: Boolean(raw.includeBackground),
    cpuSpikePercent: num(raw.cpuSpikePercent, DEFAULT_CONFIG.cpuSpikePercent),
    cpuSpikeSeconds: num(raw.cpuSpikeSeconds, DEFAULT_CONFIG.cpuSpikeSeconds),
    memSpikeBytes: num(raw.memSpikeBytes, DEFAULT_CONFIG.memSpikeBytes),
    sampleMs: num(raw.sampleMs, DEFAULT_CONFIG.sampleMs),
    port: num(raw.port, DEFAULT_CONFIG.port),
    bindLan: raw.bindLan !== false,
  };
}

export function applyConfigPatch(current: AppConfig, patch: Partial<AppConfig>): AppConfig {
  const next = { ...current };
  if (patch.retention === "24h" || patch.retention === "7d" || patch.retention === "30d") {
    next.retention = patch.retention;
  }
  if (typeof patch.paused === "boolean") next.paused = patch.paused;
  if (typeof patch.watchDownloads === "boolean") next.watchDownloads = patch.watchDownloads;
  if (typeof patch.watchDesktop === "boolean") next.watchDesktop = patch.watchDesktop;
  if (typeof patch.includeBackground === "boolean") next.includeBackground = patch.includeBackground;
  if (Array.isArray(patch.extraWatchlist)) {
    next.extraWatchlist = patch.extraWatchlist.map(String).slice(0, 40);
  }
  return next;
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
