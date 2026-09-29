import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AttemptGate, crossSite, hostAllowed, hostName, safeEqual } from "../src/lib/guard.ts";
import { applyConfigPatch, DEFAULT_CONFIG } from "../src/lib/config.ts";
import type { IncomingMessage } from "node:http";

describe("guard", () => {
  it("compares secrets without leaking length", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abd"), false);
    assert.equal(safeEqual("abc", "abcd"), false);
  });

  it("locks an address after repeated failures", () => {
    const gate = new AttemptGate(3, 1000);
    assert.equal(gate.blocked("1.1.1.1", 0), false);
    gate.fail("1.1.1.1", 0);
    gate.fail("1.1.1.1", 10);
    gate.fail("1.1.1.1", 20);
    assert.equal(gate.blocked("1.1.1.1", 30), true);
    gate.clear("1.1.1.1");
    assert.equal(gate.blocked("1.1.1.1", 40), false);
  });

  it("allows this machine and refuses other hosts in demo", () => {
    assert.equal(hostName("localhost:7842"), "localhost");
    assert.equal(hostName("[::1]:7842"), "::1");
    assert.equal(hostAllowed("127.0.0.1:7842", true), true);
    assert.equal(hostAllowed("evil.example:7842", true), false);
    assert.equal(hostAllowed("evil.example", false), false);
  });

  it("treats a foreign Origin as cross-site", () => {
    const foreign = {
      headers: { origin: "https://evil.example", host: "127.0.0.1:7842" },
    } as IncomingMessage;
    const local = {
      headers: { origin: "http://127.0.0.1:7842", host: "127.0.0.1:7842" },
    } as IncomingMessage;
    assert.equal(crossSite(foreign), true);
    assert.equal(crossSite(local), false);
  });
});

describe("config patch", () => {
  it("ignores port and bind changes from the client", () => {
    const next = applyConfigPatch(DEFAULT_CONFIG, {
      retention: "24h",
      includeBackground: true,
      port: 1,
      bindLan: false,
    } as Partial<typeof DEFAULT_CONFIG>);
    assert.equal(next.retention, "24h");
    assert.equal(next.includeBackground, true);
    assert.equal(next.port, DEFAULT_CONFIG.port);
    assert.equal(next.bindLan, true);
  });
});
