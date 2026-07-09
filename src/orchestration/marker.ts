import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Shared per-project marker module — the SINGLE source of truth for whether
 * orchestration mode is active for a given working directory. Imported by BOTH
 * the MCP tool (src/index.ts) and the hook entrypoints (src/hooks/*.ts).
 *
 * The marker is a per-project temp file keyed by a hash of the normalized
 * working directory. Orchestration is default ON; marker presence is retained
 * only as legacy state for callers that still write/read it. OFF is represented
 * by a session-keyed disable record, falling back to cwd-keyed disable state
 * when no session key is available.
 *
 * FAIL-SAFE: every filesystem operation is wrapped so this module NEVER throws
 * to its caller. Reads that fail return safe defaults. A hook that cannot read
 * disable state must degrade to ON, never crash the host turn.
 */

export interface MarkerState {
  owner_session: string | null;
  baseline_turn: number | null;
  provenance: "user-enabled" | "carried-over" | null;
  carryover_ack: boolean;
}

const markerDir = join(tmpdir(), "subagent-mcp");
export const ORCH_DISABLE_TTL_MS = 2 * 60 * 60 * 1000; // 2h GC backstop ONLY (independent of model-mode WINDOW_MS)

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

function hashKey(key: string): string {
  return createHash("sha256")
    .update(key, "utf8")
    .digest("hex")
    .slice(0, 16);
}

export function cwdHash(cwd: string): string {
  return hashKey(normalizeCwd(cwd));
}

export function markerPath(cwd: string): string {
  return join(markerDir, "orch-" + cwdHash(cwd) + ".flag");
}

export function disablePath(sessionKey: string): string {
  return join(stateDir, `orch-disable-${hashKey(sessionKey)}.json`);
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
      provenance: "user-enabled",
      carryover_ack: false,
    };
    writeFileSync(markerPath(cwd), JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
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

/**
 * Disable orchestration for cwd using cwd-keyed shared fallback state. The
 * hook's session-keyed path uses writeDisable(sessionKey) instead.
 */
export function disable(cwd: string): void {
  try {
    mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    writeFileSync(cwdDisablePath(cwd), JSON.stringify({ disabled_at: Date.now() }), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Fail-safe: never throw to the caller.
  }
}

export function writeDisable(sessionKey: string): void {
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(disablePath(sessionKey), JSON.stringify({ disabled_at: Date.now() }), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Fail-safe: never throw to the caller.
  }
}

export function writeDisableCwd(cwd: string): void {
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(cwdDisablePath(cwd), JSON.stringify({ disabled_at: Date.now() }), {
      encoding: "utf8",
      mode: 0o600,
    });
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
    writeFileSync(serverSessionPointerPath(cwd, serverKey), JSON.stringify({ session_key: sessionKey }), {
      encoding: "utf8",
      mode: 0o600,
    });
    // Back-compat only: older consumers may still read the cwd-keyed pointer.
    // New disable/query paths must read the server-scoped pointer instead.
    writeFileSync(sessionPointerPath(cwd), JSON.stringify({ session_key: sessionKey }), {
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

export function isActive(cwd: string, sessionKey?: string): boolean {
  try {
    const path = sessionKey === undefined ? cwdDisablePath(cwd) : disablePath(sessionKey);
    return !isDisableActive(path, Date.now());
  } catch {
    return true;
  }
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
      provenance,
      carryover_ack:
        typeof parsed.carryover_ack === "boolean" ? parsed.carryover_ack : false,
    };
  } catch {
    // Missing/corrupt marker -> safe default (unclaimed, no baseline/ack).
    return {
      owner_session: null,
      baseline_turn: null,
      provenance: null,
      carryover_ack: false,
    };
  }
}

export function writeMarker(cwd: string, obj: MarkerState): void {
  try {
    // Owner-only perms (see enable()): the marker persists owner_session.
    mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    writeFileSync(markerPath(cwd), JSON.stringify(obj), { encoding: "utf8", mode: 0o600 });
  } catch {
    // Fail-safe.
  }
}

/**
 * Cwd-keyed disable alias, identical to disable. RETAINED for callers that
 * clear legacy marker state explicitly (e.g. the tool's enabled:false path).
 */
export function clearForCwd(cwd: string): void {
  disable(cwd);
}
