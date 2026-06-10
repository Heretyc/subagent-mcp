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
 * working directory. Presence of the marker = ON; absence = OFF = zero
 * emission. The marker PERSISTS across sessions/restarts: the server does NOT
 * clear it on startup, so a project explicitly enabled stays ON until disabled
 * with permission, and a project never enabled stays OFF (default OFF = no
 * marker). The hook re-claims a carried-over marker for the new session.
 *
 * FAIL-SAFE: every filesystem operation is wrapped so this module NEVER throws
 * to its caller. Reads that fail return safe defaults. A hook that cannot read
 * the marker must degrade to "OFF / emit nothing", never crash the host turn.
 */

export interface MarkerState {
  owner_session: string | null;
  baseline_turn: number | null;
  provenance: "user-enabled" | "carried-over" | null;
  carryover_ack: boolean;
}

const markerDir = join(tmpdir(), "subagent-mcp");

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

export function cwdHash(cwd: string): string {
  return createHash("sha256")
    .update(normalizeCwd(cwd), "utf8")
    .digest("hex")
    .slice(0, 16);
}

export function markerPath(cwd: string): string {
  return join(markerDir, "orch-" + cwdHash(cwd) + ".flag");
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
  } catch {
    // Fail-safe: never throw to the caller.
  }
}

/**
 * Disable orchestration for cwd by removing the marker.
 *
 * No existsSync() guard: that only opens a TOCTOU window where a concurrent
 * clearForCwd/disable for the same cwd removes the file between the check and
 * the unlink. We just unlink and swallow ENOENT (already-gone is success).
 *
 * KNOWN LIMITATION: the marker is keyed by cwd, NOT by session. Two CLI
 * sessions in the same project share one marker, so their enable/disable
 * interleave and the last writer wins. Per-session isolation would require
 * keying the marker by cwd+session_id; not done here because LOCKED DECISION 1
 * keys the marker by working directory alone. (The hook tracks the owning
 * session via owner_session so a carried-over marker is re-claimed, but the
 * marker file itself is still shared per cwd.)
 */
export function disable(cwd: string): void {
  try {
    unlinkSync(markerPath(cwd));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      // Any non-ENOENT failure is still swallowed (fail-safe); ENOENT means the
      // marker was already gone, which is the desired end state anyway.
    }
  }
}

export function isActive(cwd: string): boolean {
  try {
    return existsSync(markerPath(cwd));
  } catch {
    return false;
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
 * Marker removal alias, identical to disable. RETAINED for callers that clear a
 * marker explicitly (e.g. the tool's enabled:false path). NOTE: the server no
 * longer calls this on startup — orchestration mode now PERSISTS across sessions.
 */
export function clearForCwd(cwd: string): void {
  disable(cwd);
}
