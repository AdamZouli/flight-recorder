import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startCollector } from "./collector/index.ts";
import {
  dbPath,
  ensureDataDir,
  loadConfig,
  patchConfig,
  retentionMs,
} from "./lib/config.ts";
import { loadPairing, rotateCode } from "./lib/auth.ts";
import { openDb } from "./lib/db.ts";
import { EventStore } from "./lib/store.ts";
import { startServer } from "./server/http.ts";
import { shiftEventsToNow } from "./lib/demo.ts";
import type { FlightEvent } from "./lib/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(root, "web");
const samplePath = join(root, "data", "sample-events.json");

const args = new Set(process.argv.slice(2));
const demo = args.has("--demo");
const noTray = args.has("--no-tray");
const portArg = process.argv.find((a, i, all) => all[i - 1] === "--port");

if (demo) {
  process.env.FLIGHT_RECORDER_HOME = join(tmpdir(), "flight-recorder-demo");
}

ensureDataDir();
const config = loadConfig();
if (portArg) config.port = Number(portArg) || config.port;
if (demo) {
  config.paused = true;
  config.bindLan = false;
}

const db = openDb(demo ? ":memory:" : dbPath());
const store = new EventStore(db);

if (demo) seedDemo(store);
else {
  store.prune(Date.now() - retentionMs(config.retention));
}

let pairing = loadPairing();
if (Date.now() > pairing.codeExpires) pairing = rotateCode(pairing);

const handles = { config, pairing, demo };
const { hub, urls } = startServer({
  webRoot,
  store,
  handles,
  saveConfig: (next) => {
    handles.config = patchConfig(next);
    return handles.config;
  },
  rotatePairing: () => {
    handles.pairing = rotateCode(handles.pairing);
    return handles.pairing;
  },
});

const wrappedInsert = store.insert.bind(store);
store.insert = ((input) => {
  const event = wrappedInsert(input);
  hub.send({ type: "event", event });
  return event;
}) as typeof store.insert;

let collector = demo
  ? { stop() {} }
  : startCollector(store, () => handles.config, () => {});

setInterval(() => {
  if (demo || handles.config.paused) return;
  store.prune(Date.now() - retentionMs(handles.config.retention));
}, 60 * 60 * 1000);

if (!demo && !noTray && process.platform === "win32") {
  const tray = join(root, "scripts", "tray.ps1");
  spawn(
    "powershell.exe",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", tray, "-Port", String(handles.config.port)],
    { detached: true, stdio: "ignore", windowsHide: true },
  ).unref();
}

console.log(`Flight Recorder ${demo ? "(demo, this PC only)" : ""}`);
console.log(`Data: ${demo ? "in-memory sample" : dbPath()}`);
if (!demo) console.log(`Pairing code: ${handles.pairing.code} (expires in 10 min)`);
console.log("Open:");
for (const url of urls) console.log(`  ${url}`);
console.log(demo
  ? "Demo does not record and is not reachable from other devices."
  : "Other devices need the pairing code. Localhost does not. Ctrl+C to stop.");

function seedDemo(target: EventStore): void {
  if (!existsSync(samplePath)) return;
  const raw = JSON.parse(readFileSync(samplePath, "utf8")) as { events?: FlightEvent[] };
  const shifted = shiftEventsToNow(raw.events ?? []);
  for (const event of shifted) {
    target.insert({
      ts: event.ts,
      kind: event.kind,
      title: event.title,
      detail: event.detail,
      pid: event.pid,
      severity: event.severity,
    });
  }
}

process.on("SIGINT", () => {
  collector.stop();
  process.exit(0);
});
