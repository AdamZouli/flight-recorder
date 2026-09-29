import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const home = mkdtempSync(join(tmpdir(), "fr-http-"));
process.env.FLIGHT_RECORDER_HOME = home;

const { openDb } = await import("../src/lib/db.ts");
const { EventStore } = await import("../src/lib/store.ts");
const { DEFAULT_CONFIG } = await import("../src/lib/config.ts");
const { startServer } = await import("../src/server/http.ts");
const { rotateCode } = await import("../src/lib/auth.ts");

const db: DatabaseSync = openDb(":memory:");
const store = new EventStore(db);
store.insert({ kind: "app.open", title: "Cursor started", ts: Date.now() });

const handles = {
  config: { ...DEFAULT_CONFIG, port: 0, bindLan: true },
  pairing: rotateCode(),
  demo: false,
};
const demoHandles = {
  config: { ...DEFAULT_CONFIG, port: 0, bindLan: true },
  pairing: rotateCode(),
  demo: true,
};

const live = startServer({
  webRoot: join(import.meta.dirname, "..", "web"),
  store,
  handles,
  saveConfig: (next) => {
    handles.config = next;
    return next;
  },
  rotatePairing: () => handles.pairing,
});
const demo = startServer({
  webRoot: join(import.meta.dirname, "..", "web"),
  store,
  handles: demoHandles,
  saveConfig: (next) => next,
  rotatePairing: () => demoHandles.pairing,
});

await Promise.all([listening(live.server), listening(demo.server)]);

const base = `http://127.0.0.1:${portOf(live.server)}`;

describe("local server boundary", () => {
  it("serves localhost without a token and hides the code from a forged host", async () => {
    const events = await fetch(`${base}/api/events`);
    assert.equal(events.status, 200);
    const meta = await fetch(`${base}/api/meta`);
    const body = await meta.json();
    assert.equal(typeof body.pairing.code, "string");

    const forged = await rawGet("/api/events", { Host: "evil.example" });
    assert.equal(forged.status, 403);
  });

  it("refuses a cross-site browser request", async () => {
    const res = await fetch(`${base}/api/events`, {
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });

  it("rate-limits pairing guesses and ignores a port change", async () => {
    for (let i = 0; i < 8; i += 1) {
      const res = await fetch(`${base}/api/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "NOPE" }),
      });
      assert.equal(res.status, 403);
    }
    const locked = await fetch(`${base}/api/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: handles.pairing.code }),
    });
    assert.equal(locked.status, 429);

    const saved = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port: 1, retention: "30d", includeBackground: true }),
    });
    const config = await saved.json();
    assert.equal(config.port, 0);
    assert.equal(config.retention, "30d");
    assert.equal(config.includeBackground, true);
  });

  it("binds demo mode to loopback even if LAN binding was requested", () => {
    const address = demo.server.address();
    assert.equal(typeof address, "object");
    assert.ok(address && "address" in address);
    assert.equal(address.address, "127.0.0.1");
  });
});

after(() => {
  live.server.close();
  demo.server.close();
  db.close();
  rmSync(home, { recursive: true, force: true });
});

function listening(server: Server): Promise<void> {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve) => server.once("listening", () => resolve()));
}

function portOf(server: Server): number {
  const address = server.address();
  if (address && typeof address === "object") return address.port;
  throw new Error("server has no port");
}

function rawGet(path: string, headers: Record<string, string>): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port: portOf(live.server), path, headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode || 0 }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
