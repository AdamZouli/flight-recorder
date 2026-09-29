import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pairingCode, newToken } from "./id.ts";
import { safeEqual } from "./guard.ts";
import { pairingPath, type PairingState } from "./config.ts";

const CODE_TTL_MS = 10 * 60 * 1000;

export function loadPairing(): PairingState {
  const file = pairingPath();
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as PairingState;
      if (raw.token) return raw;
    } catch {
      // recreate below
    }
  }
  return rotateCode({ token: newToken(), code: "", codeExpires: 0 });
}

export function rotateCode(state?: PairingState): PairingState {
  const next: PairingState = {
    token: state?.token || newToken(),
    code: pairingCode(),
    codeExpires: Date.now() + CODE_TTL_MS,
  };
  writeFileSync(pairingPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function pairWithCode(
  code: string,
  state: PairingState,
): { token: string; pairing: PairingState } | null {
  const expected = state.code.replaceAll(" ", "").toUpperCase();
  const got = code.replaceAll(" ", "").toUpperCase();
  const match = expected.length > 0 && safeEqual(got, expected);
  if (!match || Date.now() > state.codeExpires) return null;
  const pairing = rotateCode(state);
  return { token: pairing.token, pairing };
}

export function isLocalAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1"
  );
}
