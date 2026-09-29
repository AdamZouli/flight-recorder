import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { networkInterfaces } from "node:os";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export class AttemptGate {
  hits = new Map<string, number[]>();
  maxFails: number;
  windowMs: number;

  constructor(maxFails = 8, windowMs = 10 * 60 * 1000) {
    this.maxFails = maxFails;
    this.windowMs = windowMs;
  }

  blocked(key: string, now = Date.now()): boolean {
    return this.prune(key, now).length >= this.maxFails;
  }

  fail(key: string, now = Date.now()): void {
    const recent = this.prune(key, now);
    recent.push(now);
    this.hits.set(key, recent);
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  private prune(key: string, now: number): number[] {
    const recent = (this.hits.get(key) ?? []).filter((ts) => now - ts < this.windowMs);
    this.hits.set(key, recent);
    return recent;
  }
}

export function hostName(header: string | undefined): string {
  if (!header) return "";
  const trimmed = header.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? "" : trimmed.slice(1, end);
  }
  return trimmed.replace(/:\d+$/, "");
}

export function lanHosts(): string[] {
  const hosts: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) hosts.push(net.address.toLowerCase());
      if (net.family === "IPv6" && !net.internal) hosts.push(net.address.toLowerCase());
    }
  }
  return hosts;
}

export function hostAllowed(header: string | undefined, demo: boolean): boolean {
  const host = hostName(header);
  if (!host) return false;
  if (LOCAL_HOSTS.has(host)) return true;
  if (demo) return false;
  return lanHosts().includes(host);
}

export function crossSite(req: IncomingMessage): boolean {
  const site = headerValue(req.headers["sec-fetch-site"]);
  if (site === "cross-site" || site === "same-site") return true;
  const origin = headerValue(req.headers.origin);
  if (!origin) return false;
  try {
    const name = new URL(origin).hostname.toLowerCase();
    return name !== hostName(headerValue(req.headers.host));
  } catch {
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
