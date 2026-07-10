import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { stateDir } from "./marker.js";

export const LIVENESS_TTL_MS = 120_000;
export const LIVENESS_INTERVAL_MS = 30_000;

export function alivePath(): string {
  return join(stateDir, "alive.flag");
}

export function touchAlive(now: number = Date.now()): void {
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    atomicWriteFile(alivePath(), `${now}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Hooks fail open when liveness cannot be observed.
  }
}

export function serverAlive(now: number = Date.now()): boolean {
  try {
    const s = statSync(alivePath());
    return now - s.mtimeMs <= LIVENESS_TTL_MS;
  } catch {
    return false;
  }
}

export function startLivenessHeartbeat(): NodeJS.Timeout {
  touchAlive();
  const t = setInterval(() => touchAlive(), LIVENESS_INTERVAL_MS);
  t.unref();
  return t;
}
