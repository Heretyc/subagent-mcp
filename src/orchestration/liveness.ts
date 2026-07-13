import { mkdirSync, readFileSync, statSync } from "node:fs";
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
    atomicWriteFile(alivePath(), `${now}\npid=${process.pid}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Hooks fail open when liveness cannot be observed.
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function serverAlive(now: number = Date.now()): boolean {
  try {
    const s = statSync(alivePath());
    if (now - s.mtimeMs > LIVENESS_TTL_MS) return false;
    const raw = readFileSync(alivePath(), "utf8");
    const pid = raw
      .split(/\r?\n/)
      .map((line) => /^pid=(\d+)$/.exec(line)?.[1])
      .find((value): value is string => value !== undefined);
    if (!pid) return false;
    return pidAlive(Number(pid));
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
