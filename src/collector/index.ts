import type { AppConfig } from "../lib/types.ts";
import type { EventStore } from "../lib/store.ts";
import {
  displayName,
  isBuildProcess,
  isCrashReporter,
  isWatched,
  normalizeName,
} from "../lib/watchlist.ts";
import { takeSnapshot, type ProcSnap, type Snapshot } from "./snapshot.ts";
import { desktopDir, downloadsDir, watchFolder } from "./downloads.ts";

type Tracked = {
  pid: number;
  name: string;
  cpu: number | null;
  ws: number;
  seen: number;
  highCpuSince: number | null;
  spikeEmitted: boolean;
  memEmitted: boolean;
};

export type Collector = {
  stop: () => void;
};

export function startCollector(
  store: EventStore,
  getConfig: () => AppConfig,
  _onEvent: () => void,
): Collector {
  const watchers: { close: () => void }[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let previous = new Map<number, Tracked>();
  let lastFg = "";
  let lastCrashAt = 0;
  let primed = false;

  const cfg0 = getConfig();
  if (cfg0.watchDownloads) {
    try {
      watchers.push(
        watchFolder(downloadsDir(), store, () => getConfig().paused),
      );
    } catch {
      // folder may not exist
    }
  }
  if (cfg0.watchDesktop) {
    try {
      watchers.push(watchFolder(desktopDir(), store, () => getConfig().paused));
    } catch {
      // folder may not exist
    }
  }

  const tick = async () => {
    const config = getConfig();
    if (config.paused) return;
    let snap: Snapshot;
    try {
      snap = await takeSnapshot();
    } catch {
      return;
    }

    const now = Date.now();
    const next = new Map<number, Tracked>();
    for (const proc of snap.processes) {
      if (!proc.name || proc.pid <= 0) continue;
      const prev = previous.get(proc.pid);
      next.set(proc.pid, {
        pid: proc.pid,
        name: proc.name,
        cpu: proc.cpu,
        ws: proc.ws,
        seen: now,
        highCpuSince: prev?.highCpuSince ?? null,
        spikeEmitted: prev?.spikeEmitted ?? false,
        memEmitted: prev?.memEmitted ?? false,
      });
    }

    const fgName = snap.foreground.name;
    const fgKey = fgName ? `${snap.foreground.pid}:${normalizeName(fgName)}` : "";

    if (!primed) {
      previous = next;
      lastFg = fgKey;
      primed = true;
      return;
    }

    const dtSec = Math.max(config.sampleMs / 1000, 0.5);
    for (const proc of snap.processes) {
      if (!proc.name || proc.pid <= 0) continue;
      const prev = previous.get(proc.pid);
      const tracked = next.get(proc.pid);
      if (!tracked) continue;
      const watched = isWatched(
        proc.name,
        config.extraWatchlist,
        config.includeBackground,
        proc.ws,
      );
      if (watched && !prev) {
        store.insert({
          kind: "app.open",
          title: `${displayName(proc.name)} started`,
          pid: proc.pid,
          detail: { name: proc.name, workingSet: proc.ws },
        });
      }
      if (!watched || !prev) continue;
      emitCpu(store, config, proc, tracked, prev, snap.cpuCount, dtSec, now);
      emitMem(store, config, proc, tracked);
    }

    for (const [pid, prev] of previous) {
      if (next.has(pid)) continue;
      const watched = isWatched(
        prev.name,
        config.extraWatchlist,
        config.includeBackground,
        prev.ws,
      );
      if (!watched) continue;
      store.insert({
        kind: "app.close",
        title: `${displayName(prev.name)} exited`,
        pid,
        detail: { name: prev.name, lastWorkingSet: prev.ws },
      });
    }

    for (const proc of snap.processes) {
      if (!isCrashReporter(proc.name)) continue;
      if (!previous.has(proc.pid) && now - lastCrashAt > 15_000) {
        lastCrashAt = now;
        store.insert({
          kind: "crash",
          title: "Windows Error Reporting started",
          pid: proc.pid,
          severity: "error",
          detail: { name: proc.name },
        });
      }
    }

    if (
      fgName &&
      fgKey !== lastFg &&
      isWatched(fgName, config.extraWatchlist, config.includeBackground)
    ) {
      lastFg = fgKey;
      store.insert({
        kind: "app.focus",
        title: `Focused: ${displayName(fgName)}`,
        pid: snap.foreground.pid,
        detail: { name: fgName },
      });
    }

    previous = next;
  };

  timer = setInterval(() => {
    tick().catch(() => {});
  }, cfg0.sampleMs);
  tick().catch(() => {});

  return {
    stop() {
      if (timer) clearInterval(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
    },
  };
}

function emitCpu(
  store: EventStore,
  config: AppConfig,
  proc: ProcSnap,
  tracked: Tracked,
  prev: Tracked,
  cpuCount: number,
  dtSec: number,
  now: number,
): void {
  if (proc.cpu == null || prev.cpu == null) return;
  const delta = proc.cpu - prev.cpu;
  if (delta < 0) return;
  const pct = (delta / dtSec / Math.max(cpuCount, 1)) * 100;
  const threshold = config.cpuSpikePercent;
  if (pct >= threshold) {
    if (tracked.highCpuSince == null) tracked.highCpuSince = prev.highCpuSince ?? now;
    const held = (now - (tracked.highCpuSince ?? now)) / 1000;
    if (held >= config.cpuSpikeSeconds && !tracked.spikeEmitted) {
      tracked.spikeEmitted = true;
      const kind = isBuildProcess(proc.name) ? "build" : "cpu.spike";
      store.insert({
        kind,
        title: `${displayName(proc.name)} @ ${pct.toFixed(0)}% for ${held.toFixed(0)}s`,
        pid: proc.pid,
        severity: "warn",
        detail: {
          name: proc.name,
          cpuPercent: Math.round(pct),
          seconds: Math.round(held),
          workingSet: proc.ws,
        },
      });
    }
  } else if (pct < threshold * 0.7) {
    tracked.highCpuSince = null;
    tracked.spikeEmitted = false;
  }
}

function emitMem(
  store: EventStore,
  config: AppConfig,
  proc: ProcSnap,
  tracked: Tracked,
): void {
  if (proc.ws < config.memSpikeBytes) {
    tracked.memEmitted = false;
    return;
  }
  if (tracked.memEmitted) return;
  tracked.memEmitted = true;
  const gb = proc.ws / (1024 * 1024 * 1024);
  store.insert({
    kind: "mem.spike",
    title: `${displayName(proc.name)} working set ${gb.toFixed(1)} GB`,
    pid: proc.pid,
    severity: "warn",
    detail: { name: proc.name, workingSet: proc.ws },
  });
}
