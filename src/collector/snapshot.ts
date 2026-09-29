import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_SCRIPT = join(here, "..", "..", "scripts", "snapshot.ps1");

export type ProcSnap = {
  pid: number;
  name: string;
  ws: number;
  cpu: number | null;
};

export type Snapshot = {
  cpuCount: number;
  foreground: { pid: number; name: string | null };
  processes: ProcSnap[];
};

export async function takeSnapshot(): Promise<Snapshot> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SNAPSHOT_SCRIPT],
    { windowsHide: true, encoding: "utf8", timeout: 15000, maxBuffer: 20 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as Snapshot;
  const processes = Array.isArray(parsed.processes)
    ? parsed.processes
    : parsed.processes
      ? [parsed.processes]
      : [];
  return {
    cpuCount: Number(parsed.cpuCount) || 1,
    foreground: {
      pid: Number(parsed.foreground?.pid) || 0,
      name: parsed.foreground?.name ?? null,
    },
    processes: processes.map((p) => ({
      pid: Number(p.pid),
      name: String(p.name ?? ""),
      ws: Number(p.ws) || 0,
      cpu: p.cpu == null ? null : Number(p.cpu),
    })),
  };
}
