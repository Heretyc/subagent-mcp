import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";

import * as marker from "./marker.js";
import * as reminder from "./reminder.js";
import {
  cullStaleSlots,
  slotDir,
  ZOMBIE_FORCE_GRACE_MS,
  type CullDeps,
  type ZombieRecord,
} from "../concurrency.js";
import {
  appendUpdateNotice,
  readInstalledPackageInfo,
} from "./update-check.js";

/**
 * Provider-agnostic core of the UserPromptSubmit / SessionStart hook.
 *
 * The MCP tool only ever WRITES the marker. A SEPARATE hook process (one per
 * turn) READS the marker here and decides what to inject. The hook now emits in
 * BOTH marker states, on a per-prompt counter (reminder.ts): every
 * REMINDER_PERIOD-th prompt injects the LONG mode-specific
 * <subagent-mcp> reminder block, every prompt between injects the
 * one-line rule carrier. Marker ON adds the claim machinery: the claim turn
 * (fresh enable or carryover re-claim) emits the FULL directive plus the ON
 * reminder block and re-baselines the counter. (Supersedes LOCKED DECISION 2's
 * same-session rel%5 FULL re-emission — owner directive 2026-06-11: steady
 * state is the leaner tagged reminder, FULL fires on claim turns only.) The
 * marker PERSISTS across sessions/restarts, so the first turn of a new session
 * that inherits an already-ON marker emits a CARRYOVER notice (prepended to
 * FULL) once per project marker, ack-latched in marker state, and re-claims
 * for that session.
 *
 * The entire run is wrapped in try/catch: on ANY error we emit nothing. A hook
 * must never crash or stall the host turn. "Emit" means RETURN the string; the
 * entry shim is what writes it to process.stdout.
 */

/** Long-reminder cadence: every Nth counted prompt is a LONG turn. */
export const REMINDER_PERIOD = 5;

export interface HookPayload {
  cwd?: string;
  session_id?: string;
  transcript_path?: string;
  // Codex routes on this; Claude payloads omit it.
  hook_event_name?: string;
  [key: string]: unknown;
}

export interface ProviderAdapter {
  isSubagent(payload: HookPayload, env: NodeJS.ProcessEnv): boolean;
  currentTurn(transcriptPath: string | undefined): number;
  fullDirectiveFile: string;
  shortOnFile: string;
  shortOffFile: string;
  // Provider-specific CARRYOVER notice, prepended to FULL on the single turn
  // where a marker that was already ON at session start is re-claimed by a new
  // session (see runHook's CARRYOVER branch). Names the provider's own
  // interactive permission tool only.
  carryoverDirectiveFile: string;
  // LONG per-prompt reminder blocks (<subagent-mcp> tag), one
  // per marker state. The OFF variant names the provider's own interactive
  // question tool only (long-horizon upgrade ask); the ON variant is
  // provider-neutral.
  reminderOnFile: string;
  reminderOffFile: string;
}

/**
 * Resolve the repo-root `directives/` dir at runtime. Honors an explicit plugin
 * root (Claude sets CLAUDE_PLUGIN_ROOT; a generic PLUGIN_ROOT is also accepted)
 * so the bundled plugin finds its assets wherever it is installed. Otherwise we
 * walk up from the COMPILED file location: dist/hooks/<x>.js -> ../../directives
 * === <repoRoot>/directives.
 */
export function resolveDirectivesDir(env: NodeJS.ProcessEnv): string {
  const rootEnvName =
    env.CLAUDE_PLUGIN_ROOT !== undefined
      ? "CLAUDE_PLUGIN_ROOT"
      : env.PLUGIN_ROOT !== undefined
        ? "PLUGIN_ROOT"
        : undefined;
  if (rootEnvName) {
    const root = env[rootEnvName] ?? "";
    const directivesDir = join(root, "directives");
    if (!isAbsolute(root) || !existsSync(directivesDir)) {
      throw new Error(
        `${rootEnvName} must be an absolute path with an existing directives directory: ${root}`
      );
    }
    return directivesDir;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  // Compiled location is dist/orchestration/hook-core.js, so ../../directives
  // is the repo root's directives dir; the entry shims live at dist/hooks/<x>.js
  // and import this module, but __dirname here is the hook-core module's own
  // dir. Two levels up from dist/orchestration is the repo root either way.
  return join(here, "..", "..", "directives");
}

/** Read a directive asset by filename. On ANY failure return '' (fail-safe). */
export function readDirective(
  env: NodeJS.ProcessEnv,
  fileName: string
): string {
  const directivesDir = resolveDirectivesDir(env);
  try {
    return readFileSync(join(directivesDir, fileName), "utf8");
  } catch {
    return "";
  }
}

/**
 * Hard cap on how many bytes of a transcript we will read when counting turns.
 * Transcripts grow without bound over a long session, and the hook runs INLINE
 * on every UserPromptSubmit before the prompt is sent — an unbounded
 * readFileSync(...,'utf8') + full split('\n') is O(file size) per turn (O(n^2)
 * over a session) and a multi-hundred-MB (or attacker-supplied) transcript_path
 * could stall the user's turn for seconds or OOM the hook. We therefore read at
 * most the trailing TRANSCRIPT_READ_CAP bytes.
 */
export const TRANSCRIPT_READ_CAP = 16 * 1024 * 1024; // 16 MB

/**
 * Count JSONL lines in a transcript whose parsed object.type === `wantedType`,
 * reading at most the trailing TRANSCRIPT_READ_CAP bytes (the most recent turns
 * are at the end of the file). Fully fail-safe: any error -> 0, which makes the
 * caller emit FULL (a visible directive) rather than silently suppressing.
 *
 * For a tail read we drop the first (likely partial) line of the window so we
 * never mis-parse a line cut in half by the cap boundary. Under-counting by at
 * most one line at the boundary is acceptable for cadence; over a 16 MB window
 * the relative turn count stays stable across consecutive turns.
 */
export function countJsonlType(
  transcriptPath: string | undefined,
  wantedType: string
): number {
  if (!transcriptPath) return 0;
  let fd: number | undefined;
  try {
    const size = statSync(transcriptPath).size;
    let raw: string;
    let droppedPartialHead = false;

    if (size <= TRANSCRIPT_READ_CAP) {
      raw = readFileSync(transcriptPath, "utf8");
    } else {
      // Read only the trailing window via an fd so we never materialize the
      // whole file. The first line of the window is probably truncated.
      const start = size - TRANSCRIPT_READ_CAP;
      const buf = Buffer.allocUnsafe(TRANSCRIPT_READ_CAP);
      fd = openSync(transcriptPath, "r");
      let offset = 0;
      let pos = start;
      while (offset < TRANSCRIPT_READ_CAP) {
        const bytes = readSync(fd, buf, offset, TRANSCRIPT_READ_CAP - offset, pos);
        if (bytes <= 0) break;
        offset += bytes;
        pos += bytes;
      }
      raw = buf.toString("utf8", 0, offset);
      droppedPartialHead = true;
    }

    let count = 0;
    let first = true;
    for (const line of raw.split("\n")) {
      // Drop the first (partial) line only when we read a tail window.
      if (first) {
        first = false;
        if (droppedPartialHead) continue;
      }
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj && obj.type === wantedType) count++;
      } catch {
        // Skip unparseable lines; never throw.
      }
    }
    return count;
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort close; never throw.
      }
    }
  }
}

/**
 * Return the stable key used to compare hook claims. Some hosts omit
 * session_id; transcript_path is per-session, so a short hash keeps the claim
 * sticky without changing classifyClaim's string/undefined contract.
 */
export function sessionKey(payload: HookPayload): string | undefined {
  if (typeof payload.session_id === "string") {
    return payload.session_id;
  }
  if (
    typeof payload.transcript_path === "string" &&
    payload.transcript_path.length > 0
  ) {
    return (
      "tp-" +
      createHash("sha256")
        .update(payload.transcript_path, "utf8")
        .digest("hex")
        .slice(0, 16)
    );
  }
  return undefined;
}

/**
 * Decide whether a marker that is already active is being seen by a FRESH claim
 * or by a CARRYOVER from a prior/other session. Orchestration mode now PERSISTS
 * across process restarts/sessions (under default-ON, absence of an active
 * disable record = ON; OFF is an active session-keyed disable record; the legacy
 * owner_session marker is only used to detect carried-over/legacy ON for the
 * one-time remain-enabled notice), so the first turn of a new session can inherit
 * a marker some earlier session left behind.
 *
 * FRESH: the marker has never been claimed (baseline_turn == null OR
 *   owner_session == null) — i.e. it was just enabled in THIS session via the
 *   tool. Emit the normal turn-0 FULL directive.
 * CARRYOVER: the marker carries a real owner_session that is NOT the stable
 *   current session key — it was ON at session start, carried from a prior/
 *   other session. Prepend the ack-gated CARRYOVER notice to FULL and re-claim.
 * SAME-SESSION: owner_session === current — run the normal counter cadence.
 *
 * Null-safety: a real owner_session string with an UNDEFINED current session key
 * is treated as CARRYOVER (we cannot confirm same-session); both null/undefined
 * is FRESH.
 */
export type ClaimKind = "fresh" | "carryover" | "same";

export function classifyClaim(
  owner_session: string | null,
  baseline_turn: number | null,
  current: string | undefined
): ClaimKind {
  if (baseline_turn == null || owner_session == null) {
    return "fresh";
  }
  // owner_session is a real string here.
  if (current === undefined || owner_session !== current) {
    return "carryover";
  }
  return "same";
}

/**
 * Per-prompt reminder cadence emission: the LONG block (longFile) on every
 * REMINDER_PERIOD-th counted prompt, the one-line rule carrier between. When the
 * counter could NOT persist, emit the LONG block — fail VISIBLE: a host whose
 * temp dir cannot hold the state file would otherwise inject only the compact
 * rule carrier on every prompt and never refresh the LONG block.
 */
function cadenceEmit(
  env: NodeJS.ProcessEnv,
  adapter: ProviderAdapter,
  longFile: string,
  shortFile: string,
  count: number,
  persisted: boolean
): string {
  return !persisted || count % REMINDER_PERIOD === 0
    ? readDirective(env, longFile)
    : readDirective(env, shortFile);
}

/**
 * Claim (or re-claim) an active marker for the current session and emit the
 * claim-turn payload: FULL directive + ON reminder block, with the CARRYOVER
 * notice prepended on the first foreign-owner claim of a marker (ack-latched,
 * so sub-agent/parallel-session marker ping-pong cannot re-fire it). The
 * reminder counter re-baselines to 0 — the claim turn IS a LONG turn, so the
 * next LONG fires exactly REMINDER_PERIOD prompts later. Shared by runHook's
 * claim branch and the Codex SessionStart dispatcher (one copy of the claim
 * semantics, no drift).
 */
export function claimAndEmit(
  cwd: string,
  current: string | undefined,
  turn: number,
  m: marker.MarkerState,
  kind: ClaimKind,
  env: NodeJS.ProcessEnv,
  adapter: ProviderAdapter
): string {
  const firstCarryover = kind === "carryover" && !m.carryover_ack;
  m.baseline_turn = turn;
  m.owner_session = current ?? null;
  if (kind === "carryover") {
    m.provenance = "carried-over";
    m.carryover_ack = true;
  }
  marker.writeMarker(cwd, m);
  reminder.rebase(cwd, current, 0);
  const full =
    readDirective(env, adapter.fullDirectiveFile) +
    readDirective(env, adapter.reminderOnFile);
  return firstCarryover
    ? readDirective(env, adapter.carryoverDirectiveFile) + full
    : full;
}

function hookCullDeps(env: NodeJS.ProcessEnv = process.env): CullDeps {
  return {
    forceGraceMs: () => {
      const raw = env.SUBAGENT_ZOMBIE_FORCE_GRACE_MS;
      if (raw === undefined || raw === "") return ZOMBIE_FORCE_GRACE_MS;
      const parsed = Number.parseInt(raw, 10);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : ZOMBIE_FORCE_GRACE_MS;
    },
  };
}

export function cullHookZombies(deps: CullDeps = hookCullDeps()): ZombieRecord[] {
  try {
    return cullStaleSlots(slotDir(), deps);
  } catch {
    return [];
  }
}

function appendHookUpdateNotice(
  out: string,
  current: string | undefined,
  env: NodeJS.ProcessEnv
): string {
  try {
    return appendUpdateNotice(out, readInstalledPackageInfo().version, current, env);
  } catch {
    return out;
  }
}

/**
 * Core hook logic. Returns the string to inject, or '' to inject nothing.
 *
 * Order:
 *  1. subagent -> '' (a subagent must never be nagged to delegate; the counter
 *     does not advance).
 *  2. marker not active for cwd -> OFF cadence: advance the session's counter
 *     (per-owner; a new session starts its own), LONG OFF-variant reminder when
 *     count % REMINDER_PERIOD === 0, else the one-line rule carrier.
 *  3. marker active: classify the claim from marker state.
 *  4. FRESH / CARRYOVER -> claimAndEmit (FULL + ON reminder; CARRYOVER notice
 *     prepended once per marker; counter re-baselined). The transcript turn is
 *     read ONLY here — claim turns are the only consumer of the baseline, and
 *     the tail read is too expensive for the per-prompt steady state.
 *  5. SAME-SESSION -> ON cadence: LONG ON-variant reminder when
 *     count % REMINDER_PERIOD === 0, else the one-line rule carrier.
 */
export function runHook(
  payload: HookPayload,
  env: NodeJS.ProcessEnv,
  adapter: ProviderAdapter
): string {
  try {
    cullHookZombies();

    if (adapter.isSubagent(payload, env)) {
      return "";
    }

    const cwd = payload.cwd || process.cwd();
    const current = sessionKey(payload);
    const updateNoticeSessionId =
      typeof payload.session_id === "string" ? payload.session_id : undefined;

    if (current) marker.writeCurrentSession(cwd, current);
    if (!marker.isActive(cwd, current)) {
      // OFF: no claim machinery — just the per-prompt reminder cadence.
      const r = reminder.advance(cwd, current);
      return appendHookUpdateNotice(cadenceEmit(
        env,
        adapter,
        adapter.reminderOffFile,
        adapter.shortOffFile,
        r.count,
        r.persisted
      ), updateNoticeSessionId, env);
    }

    const m = marker.readMarker(cwd);
    const kind = classifyClaim(m.owner_session, m.baseline_turn, current);

    if (kind === "fresh" || kind === "carryover") {
      const turn = adapter.currentTurn(payload.transcript_path);
      return appendHookUpdateNotice(
        claimAndEmit(cwd, current, turn, m, kind, env, adapter),
        updateNoticeSessionId,
        env
      );
    }

    // SAME-SESSION: per-prompt reminder cadence, ON variant.
    const r = reminder.advance(cwd, current);
    return appendHookUpdateNotice(cadenceEmit(
      env,
      adapter,
      adapter.reminderOnFile,
      adapter.shortOnFile,
      r.count,
      r.persisted
    ), updateNoticeSessionId, env);
  } catch {
    // Any failure -> inject nothing. Never crash or stall the host turn.
    return "";
  }
}
