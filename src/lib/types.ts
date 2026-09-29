export type EventKind =
  | "app.open"
  | "app.close"
  | "app.focus"
  | "download"
  | "build"
  | "cpu.spike"
  | "mem.spike"
  | "crash"
  | "error.user";

export type Severity = "info" | "warn" | "error";

export type FlightEvent = {
  id: string;
  ts: number;
  kind: EventKind;
  title: string;
  detail: Record<string, unknown> | null;
  pid: number | null;
  severity: Severity;
};

export type Retention = "24h" | "7d" | "30d";

export type AppConfig = {
  retention: Retention;
  paused: boolean;
  watchDownloads: boolean;
  watchDesktop: boolean;
  extraWatchlist: string[];
  includeBackground: boolean;
  cpuSpikePercent: number;
  cpuSpikeSeconds: number;
  memSpikeBytes: number;
  sampleMs: number;
  port: number;
  bindLan: boolean;
};

export type QueryEvents = {
  from?: number;
  to?: number;
  q?: string;
  kinds?: EventKind[];
  limit?: number;
  beforeTs?: number;
  beforeId?: string;
};

export const EVENT_KINDS: EventKind[] = [
  "app.open",
  "app.close",
  "app.focus",
  "download",
  "build",
  "cpu.spike",
  "mem.spike",
  "crash",
  "error.user",
];
