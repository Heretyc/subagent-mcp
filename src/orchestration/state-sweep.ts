import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { LATCH_REV } from "./latch.js";
import { stateDir } from "./marker.js";
import { STATUSLINE_TTL_MS } from "./statusline-state.js";

export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function staleByRecordOrMtime(path: string, now: number): boolean {
  const parsed = readJson(path);
  const updated =
    parsed && typeof parsed === "object"
      ? (parsed as { updated_at?: unknown }).updated_at
      : null;
  if (finiteNumber(updated)) return now - updated > STATUSLINE_TTL_MS;
  try {
    return now - statSync(path).mtimeMs > STATUSLINE_TTL_MS;
  } catch {
    return false;
  }
}

function obsoleteLatch(path: string): boolean {
  const parsed = readJson(path);
  if (!parsed || typeof parsed !== "object") return true;
  const rev = (parsed as { rev?: unknown }).rev;
  return !Number.isInteger(rev) || (rev as number) < LATCH_REV;
}

function deleteBestEffort(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort sweep. Hooks must never fail host turns.
  }
}

export function sweepHookState(
  stateDirOverride = stateDir,
  now = Date.now(),
): void {
  try {
    const stamp = join(stateDirOverride, "sweep.stamp");
    if (existsSync(stamp)) {
      try {
        if (now - statSync(stamp).mtimeMs < SWEEP_INTERVAL_MS) return;
      } catch {
        // If the stamp cannot be read, try a sweep and rewrite it.
      }
    }
    for (const name of readdirSync(stateDirOverride)) {
      const path = join(stateDirOverride, name);
      if (/^latch-[0-9a-f]{16}\.json$/i.test(name)) {
        if (obsoleteLatch(path)) deleteBestEffort(path);
      } else if (/^(ctx|sl)-[0-9a-f]{16}\.json$/i.test(name)) {
        if (staleByRecordOrMtime(path, now)) deleteBestEffort(path);
      } else if (/^sl-cwd-[0-9a-f]{16}\.json$/i.test(name)) {
        if (staleByRecordOrMtime(path, now)) deleteBestEffort(path);
      }
    }
    writeFileSync(stamp, String(now), { encoding: "utf8", mode: 0o600 });
  } catch {
    // Best-effort only.
  }
}
