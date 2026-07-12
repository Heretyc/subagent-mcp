import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { atomicWriteJson } from "./atomic-write.js";

/**
 * Shared per-project marker module — the SINGLE source of truth for whether
 * orchestration mode is active for a given working directory. Imported by BOTH
 * the MCP tool (src/index.ts) and the hook entrypoints (src/hooks/*.ts).
 *
 * The marker is a per-project temp file keyed by a hash of the normalized
 * working directory. Orchestration is default OFF per session (hook-covered
 * hosts only); ON requires an explicit enable record, an active 15% latch, or a
 * metering-undetectable fail-safe. OFF is never represented by a disable record
 * alone anymore; disable records now serve as a post-enable/post-latch opt-out
 * (2h TTL), same mechanism, inverted role. Anonymous owner keys are unchanged:
 * always fail-safe ON, never enable/disable-able (this is the desktop/no-hook
 * carve-out, out of scope for this redesign).
 *
 * FAIL-SAFE: every filesystem operation is wrapped so this module NEVER throws
 * to its caller. Reads that fail return safe defaults. A hook that cannot read
 * disable state must degrade to ON, never crash the host turn.
 */

export interface MarkerState {
  owner_session: string | null;
  baseline_turn: number | null;
  claimed_at?: number | null;
  owners?: Record<string, OwnerClaim>;
  provenance: "user-enabled" | "carried-over" | null;
  carryover_ack: boolean;
}

export interface OwnerClaim {
  baseline_turn: number;
  claimed_at: number | null;
}

const markerDir = join(tmpdir(), "subagent-mcp");
export const ORCH_DISABLE_TTL_MS = 2 * 60 * 60 * 1000; // 2h GC backstop ONLY (independent of model-mode WINDOW_MS)
export const ANON_PREFIX = "anon-";

/**
 * Shared per-project state dir for ALL hook state files (marker + reminder
 * counter). Exported so sibling state modules key off the SAME location — a
 * future move edits one constant, not N copies.
 */
export const stateDir = markerDir;

/**
 * Canonicalize a working directory so two spellings of the same path hash
 * identically. Strip a leading Windows \\?\ extended-length prefix FIRST (on
 * the raw input) — resolve() canonicalizes that prefix away, so stripping after
 * resolve is dead code and an extended-length cwd would otherwise hash
 * differently from its plain form. Then resolve() to an absolute path; use
 * forward slashes; lowercase on win32 (the FS is case-insensitive there); drop
 * a trailing slash.
 */
export function normalizeCwd(cwd: string): string {
  let raw = cwd;
  if (raw.startsWith("\\\\?\\")) {
    raw = raw.slice(4);
  }
  let p = resolve(raw);
  p = p.replace(/\\/g, "/");
  if (process.platform === "win32") {
    p = p.toLowerCase();
  }
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

export function hashKey(key: string): string {
  return createHash("sha256")
    .update(key, "utf8")
    .digest("hex")
    .slice(0, 16);
}

export function cwdHash(cwd: string): string {
  return hashKey(normalizeCwd(cwd));
}

export function anonKey(cwd: string, scope: string): string {
  return `${ANON_PREFIX}${scope}-${cwdHash(cwd)}`;
}

export function isSessionScopedKey(key: string): boolean {
  return !key.startsWith(ANON_PREFIX);
}

export function markerPath(cwd: string): string {
  return join(markerDir, "orch-" + cwdHash(cwd) + ".flag");
}

export function disablePath(sessionKey: string): string {
  return join(stateDir, `orch-disable-${hashKey(sessionKey)}.json`);
}

export function enablePath(sessionKey: string): string {
  return join(stateDir, `orch-enable-${hashKey(sessionKey)}.json`);
}

function cwdDisablePath(cwd: string): string {
  return join(stateDir, `orch-disable-${cwdHash(cwd)}.json`);
}

export function sessionPointerPath(cwd: string): string {
  return join(stateDir, `orch-session-${cwdHash(cwd)}.json`);
}

export function serverSessionPointerPath(cwd: string, serverKey: string | number = process.ppid): string {
  return join(stateDir, `orch-session-${cwdHash(cwd)}-${hashKey(String(serverKey))}.json`);
}

/**
 * Enable orchestration for cwd. ALWAYS overwrites — re-enabling re-baselines by
 * clearing owner_session/baseline_turn back to null so the next hook turn
 * re-claims and re-baselines.
 */
export function enable(cwd: string): void {
  try {
    // Restrictive POSIX perms: the marker dir/file live in the shared,
    // world-readable /tmp on Linux/macOS and persist a session_id. mode 0o700/
    // 0o600 keeps them owner-only so other local users cannot read the
    // session_id or enumerate which projects have orchestration enabled. mode is
    // ignored on Windows (harmless; tmpdir is already per-user there).
    mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    const state: MarkerState = {
      owner_session: null,
      baseline_turn: null,
      claimed_at: null,
      owners: {},
      provenance: "user-enabled",
      carryover_ack: false,
    };
    atomicWriteJson(markerPath(cwd), state, { encoding: "utf8", mode: 0o600 });
    try {
      unlinkSync(cwdDisablePath(cwd));
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
        // Fail-safe: enable still succeeds if stale disable cleanup fails.
      }
    }
  } catch {
    // Fail-safe: never throw to the caller.
  }
}

export function writeDisable(sessionKey: string): void {
  if (!isSessionScopedKey(sessionKey)) return;
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    atomicWriteJson(disablePath(sessionKey), { disabled_at: Date.now() }, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Fail-safe: never throw to the caller.
  }
}

export function removeDisable(sessionKey: string): void {
  try {
    unlinkSync(disablePath(sessionKey));
  } catch {
    // Fail-safe: never throw to the caller.
  }
}

export function writeEnable(sessionKey: string): void {
  if (!isSessionScopedKey(sessionKey)) return;
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    atomicWriteJson(enablePath(sessionKey), { enabled_at: Date.now() }, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Fail-safe: never throw to the caller.
  }
}

export function removeEnable(sessionKey: string): void {
  try {
    unlinkSync(enablePath(sessionKey));
  } catch {
    // Fail-safe: never throw to the caller.
  }
}

export function writeCurrentSession(
  cwd: string,
  sessionKey: string,
  serverKey: string | number = process.ppid
): void {
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    atomicWriteJson(serverSessionPointerPath(cwd, serverKey), { session_key: sessionKey }, {
      encoding: "utf8",
      mode: 0o600,
    });
    // Back-compat only: older consumers may still read the cwd-keyed pointer.
    // New disable/query paths must read the server-scoped pointer instead.
    atomicWriteJson(sessionPointerPath(cwd), { session_key: sessionKey }, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Fail-safe: never throw to the caller.
  }
}

export function readCurrentSession(cwd: string, serverKey: string | number = process.ppid): string | undefined {
  try {
    const raw = readFileSync(serverSessionPointerPath(cwd, serverKey), "utf8");
    const parsed = JSON.parse(raw) as { session_key?: unknown };
    if (typeof parsed.session_key === "string") return parsed.session_key;
  } catch {
    // Fall through to legacy cwd pointer below.
  }
  try {
    const raw = readFileSync(sessionPointerPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as { session_key?: unknown };
    return typeof parsed.session_key === "string" ? parsed.session_key : undefined;
  } catch {
    return undefined;
  }
}

function isDisableActive(path: string, now: number): boolean {
  if (!existsSync(path)) {
    return false;
  }
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as { disabled_at?: unknown };
  if (typeof parsed.disabled_at !== "number") {
    return false;
  }
  if (now - parsed.disabled_at <= ORCH_DISABLE_TTL_MS) {
    return true;
  }
  // Lazy GC side-effect: the disable has expired, so remove it.
  unlinkSync(path);
  return false;
}

function isEnableActive(path: string, now: number): boolean {
  if (!existsSync(path)) {
    return false;
  }
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as { enabled_at?: unknown };
  if (typeof parsed.enabled_at !== "number") {
    return false;
  }
  if (now - parsed.enabled_at <= ORCH_DISABLE_TTL_MS) {
    return true;
  }
  // Lazy GC side-effect: the enable has expired, so remove it.
  unlinkSync(path);
  return false;
}

export function isSessionDisabled(sessionKey: string, now: number = Date.now()): boolean {
  try {
    if (!isSessionScopedKey(sessionKey)) return false;
    return isDisableActive(disablePath(sessionKey), now);
  } catch {
    return false;
  }
}

export function isActive(cwd: string, sessionKey?: string): boolean {
  try {
    if (sessionKey === undefined || !isSessionScopedKey(sessionKey)) return true;
    const now = Date.now();
    if (isDisableActive(disablePath(sessionKey), now)) return false;
    return isEnableActive(enablePath(sessionKey), now);
  } catch {
    return true;
  }
}

function readOwners(parsed: Partial<MarkerState>): Record<string, OwnerClaim> {
  const owners: Record<string, OwnerClaim> = {};
  if (parsed.owners && typeof parsed.owners === "object") {
    for (const [owner, claim] of Object.entries(parsed.owners)) {
      if (!owner || !claim || typeof claim !== "object") continue;
      const baseline = (claim as Partial<OwnerClaim>).baseline_turn;
      const claimed = (claim as Partial<OwnerClaim>).claimed_at;
      if (typeof baseline !== "number" || !Number.isFinite(baseline)) continue;
      owners[owner] = {
        baseline_turn: baseline,
        claimed_at: typeof claimed === "number" && Number.isFinite(claimed) ? claimed : null,
      };
    }
  }
  if (
    Object.keys(owners).length === 0 &&
    typeof parsed.owner_session === "string" &&
    typeof parsed.baseline_turn === "number" &&
    Number.isFinite(parsed.baseline_turn)
  ) {
    const claimed = parsed.claimed_at;
    owners[parsed.owner_session] = {
      baseline_turn: parsed.baseline_turn,
      claimed_at: typeof claimed === "number" && Number.isFinite(claimed) ? claimed : null,
    };
  }
  return owners;
}

export function readMarker(cwd: string): MarkerState {
  try {
    const raw = readFileSync(markerPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as Partial<MarkerState>;
    const provenance =
      parsed.provenance === "user-enabled" || parsed.provenance === "carried-over"
        ? parsed.provenance
        : null;
    return {
      owner_session:
        typeof parsed.owner_session === "string" ? parsed.owner_session : null,
      baseline_turn:
        typeof parsed.baseline_turn === "number" ? parsed.baseline_turn : null,
      claimed_at:
        typeof parsed.claimed_at === "number" && Number.isFinite(parsed.claimed_at)
          ? parsed.claimed_at
          : null,
      owners: readOwners(parsed),
      provenance,
      carryover_ack:
        typeof parsed.carryover_ack === "boolean" ? parsed.carryover_ack : false,
    };
  } catch {
    // Missing/corrupt marker -> safe default (unclaimed, no baseline/ack).
    return {
      owner_session: null,
      baseline_turn: null,
      claimed_at: null,
      owners: {},
      provenance: null,
      carryover_ack: false,
    };
  }
}

export function writeMarker(cwd: string, obj: MarkerState): void {
  try {
    // Owner-only perms (see enable()): the marker persists owner_session.
    mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    atomicWriteJson(markerPath(cwd), obj, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Fail-safe.
  }
}
