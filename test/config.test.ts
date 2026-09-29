import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairWithCode, rotateCode } from "../src/lib/auth.ts";
import { dataDir, loadConfig, patchConfig, retentionMs } from "../src/lib/config.ts";
import { shiftEventsToNow } from "../src/lib/demo.ts";

function withHome(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fr-cfg-"));
  const prev = process.env.FLIGHT_RECORDER_HOME;
  process.env.FLIGHT_RECORDER_HOME = dir;
  try {
    fn(dir);
  } finally {
    if (prev == null) delete process.env.FLIGHT_RECORDER_HOME;
    else process.env.FLIGHT_RECORDER_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("config home override", () => {
  it("reads and patches config under FLIGHT_RECORDER_HOME", () => {
    withHome((dir) => {
      assert.equal(dataDir(), dir);
      const cfg = loadConfig();
      assert.equal(cfg.retention, "7d");
      const next = patchConfig({ retention: "24h", paused: true });
      assert.equal(next.retention, "24h");
      assert.equal(next.paused, true);
      assert.equal(retentionMs(next.retention), 24 * 60 * 60 * 1000);
    });
  });
});

describe("pairing", () => {
  it("accepts the current code and rejects a wrong one", () => {
    withHome(() => {
      const state = rotateCode();
      assert.equal(pairWithCode("nope", state), null);
      const ok = pairWithCode(state.code, state);
      assert.ok(ok);
      assert.equal(typeof ok.token, "string");
      assert.notEqual(ok.pairing.code, state.code);
    });
  });
});

describe("demo timestamps", () => {
  it("shifts sample events so the newest lands on now", () => {
    const now = 2_000_000;
    const shifted = shiftEventsToNow(
      [
        { ts: 100, title: "old" },
        { ts: 400, title: "new" },
      ],
      now,
    );
    assert.equal(shifted[1].ts, now);
    assert.equal(shifted[0].ts, now - 300);
  });
});
