import { watch, type FSWatcher } from "node:fs";
import { basename, extname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EventStore } from "../lib/store.ts";

const IGNORE_EXT = new Set([
  ".tmp",
  ".temp",
  ".crdownload",
  ".partial",
  ".download",
  ".opdownload",
  ".part",
]);

export function downloadsDir(): string {
  return process.env.FLIGHT_RECORDER_DOWNLOADS || join(homedir(), "Downloads");
}

export function desktopDir(): string {
  return process.env.FLIGHT_RECORDER_DESKTOP || join(homedir(), "Desktop");
}

export function watchFolder(
  dir: string,
  store: EventStore,
  isPaused: () => boolean,
): FSWatcher {
  const recent = new Map<string, number>();
  return watch(dir, { persistent: true }, (_event, filename) => {
    if (isPaused() || !filename) return;
    const ext = extname(filename).toLowerCase();
    if (IGNORE_EXT.has(ext)) return;
    const name = basename(filename);
    if (name.startsWith("~$") || name.startsWith(".")) return;
    const now = Date.now();
    const last = recent.get(name) ?? 0;
    if (now - last < 4000) return;
    recent.set(name, now);
    for (const [key, ts] of recent) {
      if (now - ts > 60_000) recent.delete(key);
    }
    store.insert({
      kind: "download",
      title: `Received ${name}`,
      detail: { path: join(dir, name), folder: dir },
      severity: "info",
    });
  });
}
