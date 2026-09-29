import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, relative, sep } from "node:path";
import { hostname } from "node:os";
import { isLocalAddress, pairWithCode, type PairingState } from "../lib/auth.ts";
import type { AppConfig, EventKind } from "../lib/types.ts";
import { EVENT_KINDS } from "../lib/types.ts";
import { applyConfigPatch, retentionMs } from "../lib/config.ts";
import { AttemptGate, crossSite, hostAllowed, safeEqual } from "../lib/guard.ts";
import type { EventStore } from "../lib/store.ts";
import { Hub } from "./ws.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export type ServerHandles = {
  config: AppConfig;
  pairing: PairingState;
  demo: boolean;
};

export function startServer(opts: {
  webRoot: string;
  store: EventStore;
  handles: ServerHandles;
  saveConfig: (config: AppConfig) => AppConfig;
  rotatePairing: () => PairingState;
}): { server: ReturnType<typeof createServer>; hub: Hub; urls: string[] } {
  const hub = new Hub();
  const { webRoot, store, handles } = opts;
  const pairGate = new AttemptGate();

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      res.statusCode = 500;
      json(res, { error: String(err) });
    });
  });

  server.on("upgrade", (req, socket) => {
    if (!req.url?.startsWith("/ws") || !requestAllowed(req, handles)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!authorized(req, handles, urlOf(req))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    hub.handleUpgrade(req, socket);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = urlOf(req);
    const path = url.pathname;

    if (!requestAllowed(req, handles)) {
      res.statusCode = 403;
      json(res, { error: "This recorder only answers its own pages" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (path === "/api/health") {
      json(res, { ok: true, demo: handles.demo });
      return;
    }

    if (path === "/api/pair" && req.method === "POST") {
      const ip = req.socket.remoteAddress || "unknown";
      if (pairGate.blocked(ip)) {
        res.statusCode = 429;
        json(res, { error: "Too many pairing attempts. Wait and try again." });
        return;
      }
      const body = await readJson(req);
      const paired = pairWithCode(String(body.code ?? ""), handles.pairing);
      if (!paired) {
        pairGate.fail(ip);
        res.statusCode = 403;
        json(res, { error: "Invalid or expired pairing code" });
        return;
      }
      pairGate.clear(ip);
      handles.pairing = paired.pairing;
      json(res, { token: paired.token, host: hostname() });
      return;
    }

    if (path.startsWith("/api/") && !authorized(req, handles, url)) {
      res.statusCode = 401;
      json(res, { error: "Pairing required" });
      return;
    }

    if (path === "/api/meta") {
      json(res, {
        host: hostname(),
        paused: handles.config.paused,
        demo: handles.demo,
        count: store.count(),
        pairing: {
          needed: !isLocalAddress(req.socket.remoteAddress),
          code: isLocalAddress(req.socket.remoteAddress) ? handles.pairing.code : undefined,
          expires: isLocalAddress(req.socket.remoteAddress) ? handles.pairing.codeExpires : undefined,
        },
        urls: lanUrls(handles.config.port, handles.config.bindLan && !handles.demo),
      });
      return;
    }

    if (path === "/api/config" && req.method === "GET") {
      json(res, handles.config);
      return;
    }

    if (path === "/api/config" && req.method === "PUT") {
      const body = await readJson(req);
      handles.config = opts.saveConfig(
        applyConfigPatch(handles.config, body as Partial<AppConfig>),
      );
      json(res, handles.config);
      return;
    }

    if (path === "/api/pause" && req.method === "POST") {
      handles.config = opts.saveConfig({ ...handles.config, paused: true });
      json(res, { paused: true });
      return;
    }

    if (path === "/api/resume" && req.method === "POST") {
      handles.config = opts.saveConfig({ ...handles.config, paused: false });
      json(res, { paused: false });
      return;
    }

    if (path === "/api/wipe" && req.method === "POST") {
      store.wipe();
      hub.send({ type: "wipe" });
      json(res, { ok: true });
      return;
    }

    if (path === "/api/pair/refresh" && req.method === "POST") {
      handles.pairing = opts.rotatePairing();
      json(res, { code: handles.pairing.code, expires: handles.pairing.codeExpires });
      return;
    }

    if (path === "/api/events" && req.method === "GET") {
      const kinds = url.searchParams.getAll("kind").filter((k): k is EventKind =>
        EVENT_KINDS.includes(k as EventKind),
      );
      const events = store.query({
        from: num(url.searchParams.get("from")),
        to: num(url.searchParams.get("to")),
        q: url.searchParams.get("q") ?? undefined,
        kinds: kinds.length ? kinds : undefined,
        limit: num(url.searchParams.get("limit")) ?? 100,
        beforeTs: num(url.searchParams.get("beforeTs")),
        beforeId: url.searchParams.get("beforeId") ?? undefined,
      });
      json(res, { events });
      return;
    }

    if (path === "/api/events" && req.method === "POST") {
      const body = await readJson(req);
      const event = store.insert({
        kind: "error.user",
        title: String(body.title ?? "Marked moment"),
        detail: { note: body.note ?? body.detail ?? null },
        severity: "warn",
      });
      hub.send({ type: "event", event });
      json(res, { event });
      return;
    }

    if (path === "/api/export" && req.method === "GET") {
      const hours = num(url.searchParams.get("hours")) ?? 24;
      const from = Date.now() - hours * 60 * 60 * 1000;
      const events = store.exportSince(from);
      res.setHeader("Content-Disposition", `attachment; filename="flight-recorder-${hours}h.json"`);
      json(res, { exportedAt: new Date().toISOString(), hours, events });
      return;
    }

    const nearby = path.match(/^\/api\/events\/([^/]+)\/nearby$/);
    if (nearby && req.method === "GET") {
      json(res, { events: store.nearby(decodeURIComponent(nearby[1])) });
      return;
    }

    const one = path.match(/^\/api\/events\/([^/]+)$/);
    if (one && req.method === "GET") {
      const event = store.get(decodeURIComponent(one[1]));
      if (!event) {
        res.statusCode = 404;
        json(res, { error: "Not found" });
        return;
      }
      json(res, { event });
      return;
    }

    if (path === "/api/retention/prune" && req.method === "POST") {
      const cut = Date.now() - retentionMs(handles.config.retention);
      json(res, { deleted: store.prune(cut) });
      return;
    }

    await serveStatic(webRoot, path, res);
  }

  const host = handles.demo || !handles.config.bindLan ? "127.0.0.1" : "0.0.0.0";
  server.listen(handles.config.port, host);
  return {
    server,
    hub,
    urls: lanUrls(handles.config.port, host === "0.0.0.0"),
  };
}

function requestAllowed(req: IncomingMessage, handles: ServerHandles): boolean {
  if (!hostAllowed(req.headers.host, handles.demo)) return false;
  if (handles.demo && !isLocalAddress(req.socket.remoteAddress)) return false;
  if (crossSite(req)) return false;
  return true;
}

function authorized(req: IncomingMessage, handles: ServerHandles, url: URL): boolean {
  if (handles.demo && isLocalAddress(req.socket.remoteAddress)) return true;
  if (isLocalAddress(req.socket.remoteAddress)) return true;
  const header = req.headers.authorization;
  const token =
    (typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice(7)
      : null) || url.searchParams.get("token");
  return Boolean(token && safeEqual(token, handles.pairing.token));
}

function urlOf(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
}

function json(res: ServerResponse, body: unknown): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function num(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function serveStatic(webRoot: string, path: string, res: ServerResponse): Promise<void> {
  const rel = path === "/" ? "index.html" : path.replace(/^\//, "");
  const file = normalize(join(webRoot, rel));
  const root = normalize(webRoot + sep);
  if (relative(root, file).startsWith("..") || relative(root, file).includes(`..${sep}`)) {
    res.statusCode = 403;
    json(res, { error: "Forbidden" });
    return;
  }
  const target = existsSync(file) && statSync(file).isFile()
    ? file
    : join(webRoot, "index.html");
  if (!existsSync(target)) {
    res.statusCode = 404;
    json(res, { error: "Not found" });
    return;
  }
  res.setHeader("Content-Type", MIME[extname(target)] ?? "application/octet-stream");
  if (extname(target) === ".html" || extname(target) === ".js" || extname(target) === ".css") {
    res.setHeader("Cache-Control", "no-cache");
  }
  createReadStream(target).pipe(res);
}

export function lanUrls(port: number, includeLan = true): string[] {
  const urls = [`http://127.0.0.1:${port}`];
  if (!includeLan) return urls;
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.push(`http://${net.address}:${port}`);
      }
    }
  }
  return urls;
}
