import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/lib/db.ts";
import { EventStore } from "../src/lib/store.ts";
import { retentionMs } from "../src/lib/config.ts";
import {
  isIgnored,
  isWatched,
  isBuildProcess,
  displayName,
} from "../src/lib/watchlist.ts";

describe("watchlist", () => {
  it("filters Windows noise by default", () => {
    assert.equal(isIgnored("svchost"), true);
    assert.equal(isWatched("svchost", [], false, 9e9), false);
    assert.equal(isWatched("Cursor", [], false), true);
    assert.equal(isWatched("mystery", [], false, 200 * 1024 * 1024), true);
    assert.equal(isBuildProcess("node.exe"), true);
    assert.equal(displayName("Code.exe"), "Code");
  });
});

describe("retention", () => {
  it("maps 24h / 7d / 30d to milliseconds", () => {
    assert.equal(retentionMs("24h"), 24 * 60 * 60 * 1000);
    assert.equal(retentionMs("7d"), 7 * 24 * 60 * 60 * 1000);
    assert.equal(retentionMs("30d"), 30 * 24 * 60 * 60 * 1000);
  });
});

describe("event store", () => {
  const dir = mkdtempSync(join(tmpdir(), "flight-recorder-"));
  const db = openDb(join(dir, "events.db"));
  const store = new EventStore(db);

  it("inserts and queries with positional parameters", () => {
    const spike = store.insert({
      ts: 1_000,
      kind: "cpu.spike",
      title: "node @ 92% for 12s",
      pid: 42,
      severity: "warn",
      detail: { name: "node" },
    });
    store.insert({
      ts: 2_000,
      kind: "download",
      title: "Received report.pdf",
      detail: { path: "C:\\\\Users\\\\demo\\\\Downloads\\\\report.pdf" },
    });
    store.insert({
      ts: 3_000,
      kind: "app.open",
      title: "Cursor started",
      pid: 7,
    });

    const all = store.query({ limit: 10 });
    assert.equal(all.length, 3);
    assert.equal(all[0].title, "Cursor started");

    const found = store.query({ q: "report.pdf" });
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, "download");

    const kinds = store.query({ kinds: ["cpu.spike"] });
    assert.equal(kinds.length, 1);
    assert.equal(kinds[0].id, spike.id);

    const near = store.nearby(spike.id, 2_000);
    assert.equal(near.length, 3);
  });

  it("escapes LIKE wildcards in search", () => {
    store.insert({ kind: "error.user", title: "100% baked", ts: 4_000 });
    const hits = store.query({ q: "100%" });
    assert.equal(hits.length, 1);
    const underscore = store.query({ q: "report_" });
    assert.equal(underscore.length, 0);
  });

  it("prunes by timestamp and can wipe", () => {
    const deleted = store.prune(2_500);
    assert.ok(deleted >= 2);
    assert.equal(store.query({ from: 0, to: 2_000 }).length, 0);
    store.wipe();
    assert.equal(store.count(), 0);
  });

  it("cleans the temp db directory", () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
