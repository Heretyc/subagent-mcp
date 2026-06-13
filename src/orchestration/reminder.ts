import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cwdHash, stateDir } from "./marker.js";

/**
 * Per-project reminder-counter module — state for the per-prompt reminder
 * cadence the hook injects in BOTH marker states (orchestration ON and OFF).
 * Follows the marker pattern (same temp dir, same fail-safe contract): a small
 * JSON file keyed by the cwd hash. Counts are PER OWNER (session key, or
 * "null" when the host supplies none) so two interleaved sessions in one
 * project each keep their own cadence instead of resetting each other —
 * every REMINDER_PERIOD-th counted prompt of a session emits the LONG
 * <ORCHESTRATION-INVARIANT> block; the prompts between emit the one-line rule
 * carrier.
 *
 * KNOWN LIMITATION: key-less sessions all share the "null" owner, so their
 * counts run together (cadence position leaks between them). Documented
 * degradation, never a crash.
 *
 * FAIL-SAFE: never throws. Unreadable/corrupt state -> fresh zero state.
 * advance() reports whether the state persisted so the caller can fail
 * VISIBLE (emit the LONG block) rather than silently suppressing it forever
 * on a host with an unwritable temp dir.
 */

export interface ReminderState {
  counts: Record<string, number>;
}

/** Bound the per-owner map so a busy multi-session cwd cannot grow it without
 * limit; evicting ALL entries on overflow is crude but rare and self-heals. */
const OWNER_CAP = 8;

function ownerKey(current: string | undefined): string {
  return current ?? "null";
}

export function reminderPath(cwd: string): string {
  return join(stateDir, "remind-" + cwdHash(cwd) + ".json");
}

export function readReminder(cwd: string): ReminderState {
  try {
    const raw = readFileSync(reminderPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as Partial<ReminderState>;
    const counts: Record<string, number> = {};
    if (parsed.counts && typeof parsed.counts === "object") {
      for (const [owner, count] of Object.entries(parsed.counts)) {
        if (typeof count === "number" && Number.isFinite(count)) {
          counts[owner] = count;
        }
      }
    }
    return { counts };
  } catch {
    // Missing/corrupt state -> safe default (no owners counted yet).
    return { counts: {} };
  }
}

/** Persist the state. Returns true on success, false on any write failure. */
export function writeReminder(cwd: string, obj: ReminderState): boolean {
  try {
    // Owner-only perms (see marker.enable()): the state persists session keys.
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(reminderPath(cwd), JSON.stringify(obj), {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  } catch {
    // Fail-safe: report the failure; never throw.
    return false;
  }
}

/**
 * Count one user prompt for the current session and persist. Returns the
 * session's advanced count plus whether the state persisted (persisted=false
 * lets the caller fail visible instead of never reaching the LONG cadence).
 */
export function advance(
  cwd: string,
  current: string | undefined
): { count: number; persisted: boolean } {
  const owner = ownerKey(current);
  const state = readReminder(cwd);
  if (!(owner in state.counts) && Object.keys(state.counts).length >= OWNER_CAP) {
    state.counts = {};
  }
  const count = (state.counts[owner] ?? 0) + 1;
  state.counts[owner] = count;
  const persisted = writeReminder(cwd, state);
  return { count, persisted };
}

/**
 * Re-baseline the current session's count (claim turns set 0: the claim turn
 * IS a LONG turn, so the next LONG fires exactly REMINDER_PERIOD prompts on).
 */
export function rebase(cwd: string, current: string | undefined, count: number): void {
  const state = readReminder(cwd);
  state.counts[ownerKey(current)] = count;
  writeReminder(cwd, state);
}
