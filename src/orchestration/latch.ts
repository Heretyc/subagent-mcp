import {
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./atomic-write.js";
import { hashKey, stateDir } from "./marker.js";

interface LatchRecord {
  latched: true;
  latched_at: number;
  session_id: string;
}

export function latchPath(sessionKey: string): string {
  return join(stateDir, `latch-${hashKey(sessionKey)}.json`);
}

export function isLatchActive(sessionKey: string, now: number): boolean {
  void now;
  try {
    const raw = readFileSync(latchPath(sessionKey), "utf8");
    const parsed = JSON.parse(raw) as Partial<LatchRecord>;
    return (
      parsed.latched === true &&
      typeof parsed.latched_at === "number" &&
      Number.isFinite(parsed.latched_at) &&
      typeof parsed.session_id === "string"
    );
  } catch {
    return false;
  }
}

export function tripLatch(sessionKey: string, now: number): void {
  if (isLatchActive(sessionKey, now)) return;
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    atomicWriteJson(latchPath(sessionKey), {
      latched: true,
      latched_at: now,
      session_id: sessionKey,
    }, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Fail-safe: latch write failures must not crash hook execution.
  }
}

export function clearLatch(sessionKey: string): void {
  try {
    unlinkSync(latchPath(sessionKey));
  } catch {
    // Fail-safe: callers use this for teardown/admin reset only.
  }
}
