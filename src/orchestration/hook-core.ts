import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";

import * as marker from "./marker.js";
import * as reminder from "./reminder.js";
import * as handoff from "./handoff.js";
import * as latch from "./latch.js";
import * as metering from "./metering.js";
import { sweepHookState } from "./state-sweep.js";
import * as template from "./template.js";
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
import { isSubOrchestratorEnv } from "../sub-orchestrator.js";

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
export const ANON_CLAIM_TTL_MS = 2 * 60 * 60 * 1000;
const OWNER_CLAIM_CAP = 8;

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
  liftUsage(
    payload: HookPayload,
    env: NodeJS.ProcessEnv,
    transcriptPath: string | undefined
  ): LiftUsageResult | null;
  anonScope: string;
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

export interface LiftUsageResult {
  harness: metering.MeteringHarness;
  model: string;
  source_ref: string;
  usage: Partial<metering.MeteringUsage> | null;
  harnessPercentage?: number | null;
  harnessContextWindow?: number | null;
  longContextHint?: boolean | null;
}

type TagKind =
  | "directive"
  | "reminder"
  | "carryover"
  | "carrier"
  | "sub-orchestrator";

/**
 * Directive asset injected on EVERY turn of a sub-orchestrator session (the
 * child launched with `sub-orchestrator: true`). Fixed name, not adapter-keyed:
 * the body is provider-neutral, so Claude and Codex share the one asset.
 */
export const SUB_ORCHESTRATOR_DIRECTIVE_FILE = "sub-orchestrator-on.md";

interface Emission {
  body: string;
  kind: TagKind;
  isLong: boolean;
}

/**
 * Resolve the repo-root `directives/` dir at runtime. Honors an explicit plugin
 * root (Claude sets CLAUDE_PLUGIN_ROOT; a generic PLUGIN_ROOT is also accepted)
 * so the bundled plugin finds its assets wherever it is installed, but only
 * when that root is under an expected install prefix. Otherwise we walk up from
 * the COMPILED file location: dist/hooks/<x>.js -> ../../directives ===
 * <repoRoot>/directives.
 */
export function resolveDirectivesDir(env: NodeJS.ProcessEnv): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const compiledRoot = resolve(here, "..", "..");
  const rootEnvName =
    env.CLAUDE_PLUGIN_ROOT !== undefined
      ? "CLAUDE_PLUGIN_ROOT"
      : env.PLUGIN_ROOT !== undefined
        ? "PLUGIN_ROOT"
        : undefined;
  if (rootEnvName) {
    const root = env[rootEnvName] ?? "";
    const directivesDir = join(root, "directives");
    if (
      isAbsolute(root) &&
      existsSync(directivesDir) &&
      isTrustedPluginRoot(root, env, compiledRoot)
    ) {
      return directivesDir;
    }
  }
  // Compiled location is dist/orchestration/hook-core.js, so ../../directives
  // is the repo root's directives dir; the entry shims live at dist/hooks/<x>.js
  // and import this module, but __dirname here is the hook-core module's own
  // dir. Two levels up from dist/orchestration is the repo root either way.
  return join(compiledRoot, "directives");
}

function normalizePathKey(pathValue: string): string {
  let p = resolve(pathValue);
  p = p.replace(/\\/g, "/");
  if (process.platform === "win32") {
    p = p.toLowerCase();
  }
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

function isPathUnder(pathValue: string, prefix: string): boolean {
  const child = normalizePathKey(pathValue);
  const parent = normalizePathKey(prefix);
  return child === parent || child.startsWith(parent + "/");
}

function installPrefixes(env: NodeJS.ProcessEnv, compiledRoot: string): string[] {
  const prefixes = [
    compiledRoot,
    env.npm_config_prefix,
    env.PREFIX,
    process.env.npm_config_prefix,
    process.env.PREFIX,
    process.platform === "win32" && env.APPDATA ? join(env.APPDATA, "npm") : undefined,
    process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "npm")
      : undefined,
    join(dirname(process.execPath), ".."),
    join(homedir(), ".claude", "plugins"),
    join(homedir(), ".codex", "plugins", "cache"),
    join(homedir(), ".codex", "plugins"),
  ];
  return [...new Set(prefixes.filter((p): p is string => typeof p === "string" && p.length > 0))];
}

function isTrustedPluginRoot(
  root: string,
  env: NodeJS.ProcessEnv,
  compiledRoot: string
): boolean {
  // Trust assumption: env roots are host-controlled only after they resolve
  // under the package install, npm global prefix, or known plugin cache roots.
  const resolvedRoot = resolve(root);
  return installPrefixes(env, compiledRoot).some((prefix) =>
    isPathUnder(resolvedRoot, prefix)
  );
}

/** Read a directive asset by filename. On ANY failure return '' (fail-safe). */
export function readDirective(
  env: NodeJS.ProcessEnv,
  fileName: string
): string {
  try {
    const directivesDir = resolveDirectivesDir(env);
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
  if (typeof payload.session_id === "string" && payload.session_id.length > 0) {
    return payload.session_id;
  }
  if (
    typeof payload.transcript_path === "string" &&
    payload.transcript_path.length > 0
  ) {
    // Residual caveat: a genuinely moved transcript still re-keys. Prefer the
    // host session_id when present, which remains the precedence above.
    return "tp-" + marker.hashKey(normalizePathKey(payload.transcript_path));
  }
  return undefined;
}

export function ownerKey(payload: HookPayload, cwd: string, adapter: ProviderAdapter): string {
  return sessionKey(payload) ?? marker.anonKey(cwd, adapter.anonScope);
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
  current: string,
  claimed_at: number | null = null,
  now: number = Date.now()
): ClaimKind {
  if (baseline_turn == null || owner_session == null) {
    return "fresh";
  }
  if (owner_session !== current) {
    return "carryover";
  }
  if (!marker.isSessionScopedKey(current)) {
    const age = typeof claimed_at === "number" ? now - claimed_at : Number.NaN;
    if (!Number.isFinite(age) || age < 0 || age > ANON_CLAIM_TTL_MS) {
      return "fresh";
    }
  }
  return "same";
}

export function classifyOwnerClaim(
  m: marker.MarkerState,
  owner: string,
  now: number = Date.now()
): ClaimKind {
  const claim = m.owners?.[owner];
  if (claim) {
    return classifyClaim(owner, claim.baseline_turn, owner, claim.claimed_at, now);
  }
  const hasLiveOwner = m.owners !== undefined && Object.keys(m.owners).length > 0;
  if (hasLiveOwner || typeof m.owner_session === "string") {
    return "carryover";
  }
  return "fresh";
}

function claimOwner(m: marker.MarkerState, owner: string, turn: number, now: number): void {
  const owners = { ...(m.owners ?? {}) };
  owners[owner] = { baseline_turn: turn, claimed_at: now };
  const entries = Object.entries(owners).sort((a, b) => {
    const at = a[1].claimed_at ?? 0;
    const bt = b[1].claimed_at ?? 0;
    return at - bt;
  });
  while (entries.length > OWNER_CLAIM_CAP) {
    const [oldest] = entries.shift() ?? [];
    if (oldest) delete owners[oldest];
  }
  m.owners = owners;
  m.owner_session = owner;
  m.baseline_turn = turn;
  m.claimed_at = now;
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
): Emission {
  const isLong = !persisted || count % REMINDER_PERIOD === 0;
  return {
    body: bodyFromDirective(readDirective(env, isLong ? longFile : shortFile)),
    kind: isLong ? "reminder" : "carrier",
    isLong,
  };
}

function bodyFromDirective(raw: string): string {
  return raw
    .replace(/<subagent-mcp\b[^>]*>/g, "")
    .replace(/<\/subagent-mcp>/g, "")
    .trim();
}

function appendReadHandoffForLong(
  body: string,
  cwd: string,
  current: string,
  isLong: boolean
): string {
  if (!isLong) return body;
  const record = handoff.readHandoff(cwd);
  if (record?.read_by_session !== current) return body;
  const overflowLine = record.overflow_path
    ? `\nOverflow path: ${record.overflow_path}`
    : "";
  return `${body}\n${record.content}${overflowLine}`;
}

function composeInjection(
  emission: Emission,
  effectiveActive: boolean,
  phase: metering.MeteringPhase,
  usedPercentage: number | null
): string | null {
  // Fail-safe: an unreadable/empty directive body injects NOTHING rather than a
  // hollow tag (preserves the pre-template missing-directive contract).
  if (emission.body.trim() === "") return null;
  const tag = template.composeTag({
    state: effectiveActive ? "on" : "off",
    kind: emission.kind,
    phase,
    utilization:
      usedPercentage === null ? "unknown" : `${Math.round(usedPercentage)}%`,
  });
  const footer = template.composeFooter(
    usedPercentage === null ? null : Math.round(100 - usedPercentage)
  );
  return `${tag}\n${emission.body}\n</subagent-mcp>${footer ? `\n${footer}` : ""}`;
}

function composeHookUpdateNotice(
  env: NodeJS.ProcessEnv,
  updateNoticeSessionId: string | undefined,
  emission: Emission,
  effectiveActive: boolean,
  phase: metering.MeteringPhase,
  usedPercentage: number | null
): string {
  const injected = composeInjection(
    emission,
    effectiveActive,
    phase,
    usedPercentage
  );
  if (injected === null) return "";
  return appendHookUpdateNotice(injected, updateNoticeSessionId, env);
}

function readMeteringState(current: string): {
  usedPercentage: number | null;
  phase: metering.MeteringPhase;
} {
  const record = metering.readMetering(current);
  const usedPercentage = record?.used_percentage ?? null;
  return {
    usedPercentage,
    phase: metering.phaseFor(usedPercentage),
  };
}

/**
 * Read the shared user-level context-coaching settings (`contextCoaching`,
 * `handoffWarnThreshold`) for this turn.
 *
 * Fail-safe: any read/parse failure returns null, which makes
 * metering.resolveHandoffWarningPct fall back to its conservative built-in
 * threshold rather than silencing the warning. Resolved ONCE per runHook turn
 * and threaded down, so the injected directive and the persisted `near_limit`
 * flag can never disagree within a turn, and the config file is read once.
 */
export function readHandoffWarningSettings(): metering.HandoffWarningSettings | null {
  return metering.readSharedCoachingSettings();
}

/**
 * Wind-down warning gate. Threshold comes from the shared settings resolved for
 * this turn, so the one knob that sets `near_limit` on the metering record also
 * decides whether the handoff directive is appended to this turn's injection.
 * `contextCoaching: false` resolves to null and suppresses the append entirely.
 */
function shouldWarnHandoff(
  usedPercentage: number | null,
  warningSettings: metering.HandoffWarningSettings | null
): boolean {
  const warningPct = metering.resolveHandoffWarningPct(warningSettings);
  return (
    usedPercentage !== null && warningPct !== null && usedPercentage >= warningPct
  );
}

/**
 * The two latch directive assets whose bodies MUST be verbatim identical.
 *
 * The 15% latch coaching is provider-NEUTRAL by contract: it names the
 * structured-question tool generically rather than one harness's tool, so a
 * Claude session and a Codex session receive the same goal-setting instruction
 * word for word. Two files still ship (packaging and directive lookup stay
 * per-provider via providerDirectiveFile), so the invariant is asserted rather
 * than structurally guaranteed — latchDirectivesIdentical() is the check.
 */
export const LATCH_DIRECTIVE_FILES = ["latch-claude.md", "latch-codex.md"] as const;

/**
 * True when every latch directive asset resolves to the same non-empty body.
 * Fail-safe: an unreadable/empty asset reports false rather than throwing.
 */
export function latchDirectivesIdentical(env: NodeJS.ProcessEnv): boolean {
  const bodies = LATCH_DIRECTIVE_FILES.map((file) =>
    bodyFromDirective(readDirective(env, file))
  );
  const [first] = bodies;
  if (first === undefined || first.trim() === "") return false;
  return bodies.every((body) => body === first);
}

/**
 * Lift this turn's usage, persist the metering record, and report whether
 * metering is undetectable (fail-safe ON) for THIS turn.
 *
 * One-turn lag (accepted by design, see context-metering.md): the transcript
 * only carries the PRIOR assistant turn's usage, so the metering data reflects
 * the last COMPLETED turn, not the in-flight one. Thresholds therefore trip one
 * turn late, which is harmless. Turn <= 1 has no completed turn yet, so it is a
 * grace window: no metering is expected and the session is NOT fail-safed.
 */
function updateMeteringForTurn(
  payload: HookPayload,
  env: NodeJS.ProcessEnv,
  adapter: ProviderAdapter,
  current: string,
  turnIndex: number,
  warningSettings: metering.HandoffWarningSettings | null
): boolean {
  if (turnIndex <= 1) return false;
  const lifted = adapter.liftUsage(payload, env, payload.transcript_path);
  if (lifted === null) return true;
  const prior = metering.readMetering(current);
  const record = metering.buildMeteringRecord({
    session_id: current,
    harness: lifted.harness,
    model: lifted.model,
    source_ref: lifted.source_ref,
    usage: lifted.usage,
    event:
      typeof payload.hook_event_name === "string"
        ? payload.hook_event_name
        : "UserPromptSubmit",
    harnessPercentage: lifted.harnessPercentage,
    harnessContextWindow: lifted.harnessContextWindow,
    longContextHint: lifted.longContextHint,
    priorWindow: prior?.context_window_size ?? null,
    priorWindowSource: prior?.window_source ?? null,
    priorWindowFloor: prior?.window_floor ?? null,
    warningSettings,
  });
  metering.writeMetering(current, record);

  // A valid harness-reported percentage stands on its own. Without one, we fall
  // back to the window: context_window_size is always numeric under the
  // assumed-default ladder, so the null guard remains as a dead-man fallback only
  // (the record is still persisted for observability and same-turn fail-safe agreement).
  const hasHarnessPercentage =
    typeof lifted.harnessPercentage === "number" &&
    Number.isFinite(lifted.harnessPercentage);
  return !hasHarnessPercentage && record.context_window_size === null;
}

function providerDirectiveFile(adapter: ProviderAdapter, prefix: string): string {
  return `${prefix}-${adapter.anonScope}.md`;
}

/**
 * Single source of truth for the effective ON/OFF decision. Shared by runHook,
 * the Codex SessionStart dispatcher, and the orchestration-mode MCP tool so all
 * three agree on the same turn (no drift between the hook tag and the tool).
 *
 * An explicit session disable always wins (2h TTL, user-only). Otherwise the
 * session is ON when the marker is active, the 15% latch has tripped, or
 * metering is undetectable (fail-safe ON). `meteringUndetectableFailSafe` is
 * supplied by the caller because only the caller knows its own turn context: the
 * hook honors the turn-1 grace window (no completed turn yet, so early turns are
 * NOT fail-safed), and the tool derives it from the persisted metering record.
 */
export function computeEffectiveActive(
  cwd: string,
  current: string | undefined,
  now: number,
  meteringUndetectableFailSafe: boolean
): boolean {
  if (current !== undefined && marker.isSessionDisabled(current, now)) {
    return false;
  }
  const latched = current !== undefined && latch.isLatchActive(current, now);
  return marker.isActive(cwd, current) || latched || meteringUndetectableFailSafe;
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
  current: string,
  turn: number,
  m: marker.MarkerState,
  kind: ClaimKind,
  env: NodeJS.ProcessEnv,
  adapter: ProviderAdapter,
  effectiveActive = true,
  phase: metering.MeteringPhase = "normal",
  usedPercentage: number | null = null,
  updateNoticeSessionId?: string,
  fullBodyFile?: string,
  // Optional trailing param: existing callers (the Codex SessionStart
  // dispatcher) keep their signature and resolve the shared settings here.
  warningSettings: metering.HandoffWarningSettings | null = readHandoffWarningSettings()
): string {
  const firstCarryover = kind === "carryover" && !m.carryover_ack;
  const full = fullBodyFile
    ? bodyFromDirective(readDirective(env, fullBodyFile))
    : bodyFromDirective(readDirective(env, adapter.fullDirectiveFile)) +
      "\n" +
      bodyFromDirective(readDirective(env, adapter.reminderOnFile));
  const handoffBody =
    shouldWarnHandoff(usedPercentage, warningSettings)
      ? "\n" +
        bodyFromDirective(readDirective(env, providerDirectiveFile(adapter, "handoff")))
      : "";
  // The CARRYOVER notice must be emitted on the SAME turn that burns
  // carryover_ack (set above), even when a FULL-body override (e.g. the
  // just-tripped latch coaching) also fires this turn. Prepend it ahead of that
  // body rather than dropping it, or the once-per-marker notice is lost.
  const emission: Emission = {
    body: (firstCarryover
      ? bodyFromDirective(readDirective(env, adapter.carryoverDirectiveFile)) +
        "\n" +
        full
      : full) + handoffBody,
    kind: firstCarryover ? "carryover" : "directive",
    isLong: true,
  };
  if (emission.body.trim() === "") return "";
  claimOwner(m, current, turn, Date.now());
  if (kind === "carryover") {
    m.provenance = "carried-over";
    m.carryover_ack = true;
  }
  marker.writeMarker(cwd, m);
  reminder.rebase(cwd, current, 0);
  return composeHookUpdateNotice(
    env,
    updateNoticeSessionId,
    emission,
    effectiveActive,
    phase,
    usedPercentage
  );
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
 *  0. sub-orchestrator (both env markers) -> STATELESS per-turn ON emission and
 *     return; no state of any kind is read or written for that session.
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
    sweepHookState();

    // Sub-orchestrator sessions: STATELESS per-turn ON emission, decided BEFORE
    // the isSubagent bail (a sub-orchestrator IS a subagent by env, so it would
    // otherwise return '' and lose orchestration). Shared by both providers via
    // this one runHook; the adapters' isSubagent stay untouched.
    //
    // This branch NEVER falls through to writeCurrentSession/metering/latch/
    // reminder: a sub-orchestrator usually shares the parent orchestrator's cwd,
    // and any write here would steal the cwd session pointer that
    // orchestration-mode and the handoff tools key on. Nothing is read either,
    // so the emission is identical on every turn.
    if (isSubOrchestratorEnv(env)) {
      return (
        composeInjection(
          {
            body: bodyFromDirective(
              readDirective(env, SUB_ORCHESTRATOR_DIRECTIVE_FILE)
            ),
            kind: "sub-orchestrator",
            isLong: true,
          },
          true,
          "normal",
          null
        ) ?? ""
      );
    }

    if (adapter.isSubagent(payload, env)) {
      return "";
    }

    const cwd = payload.cwd || process.cwd();
    const current = ownerKey(payload, cwd, adapter);
    const updateNoticeSessionId =
      typeof payload.session_id === "string" ? payload.session_id : undefined;

    marker.writeCurrentSession(cwd, current);
    const now = Date.now();
    const turnIndex = adapter.currentTurn(payload.transcript_path);
    // One config read per turn, shared by near_limit and the injection gate.
    const warningSettings = readHandoffWarningSettings();
    const meteringUndetectableFailSafe = updateMeteringForTurn(
      payload,
      env,
      adapter,
      current,
      turnIndex,
      warningSettings
    );
    const meteringState = readMeteringState(current);
    const wasLatched = latch.isLatchActive(current, now);
    if (meteringState.phase !== "normal" || wasLatched) {
      latch.tripLatch(current, now);
    }
    const isLatched = latch.isLatchActive(current, now);
    const justTrippedLatch = !wasLatched && isLatched;
    const effectiveActive = computeEffectiveActive(
      cwd,
      current,
      now,
      meteringUndetectableFailSafe
    );

    if (!effectiveActive) {
      const r = reminder.advance(cwd, current);
      // A session that has already read a handoff re-appends the saved content
      // to EVERY LONG reminder (spec), regardless of ON/OFF cadence.
      const offEmission = cadenceEmit(
        env,
        adapter,
        adapter.reminderOffFile,
        adapter.shortOffFile,
        r.count,
        r.persisted
      );
      return composeHookUpdateNotice(
        env,
        updateNoticeSessionId,
        {
          ...offEmission,
          body: appendReadHandoffForLong(
            offEmission.body,
            cwd,
            current,
            offEmission.isLong
          ),
        },
        effectiveActive,
        meteringState.phase,
        meteringState.usedPercentage
      );
    }

    const m = marker.readMarker(cwd);
    const kind = classifyOwnerClaim(m, current);

    if (kind === "fresh" || kind === "carryover") {
      return claimAndEmit(
        cwd,
        current,
        turnIndex,
        m,
        kind,
        env,
        adapter,
        effectiveActive,
        meteringState.phase,
        meteringState.usedPercentage,
        updateNoticeSessionId,
        meteringState.phase === "plan" && justTrippedLatch
          ? providerDirectiveFile(adapter, "latch")
          : undefined,
        warningSettings
      );
    }

    const r = reminder.advance(cwd, current);
    let emission = cadenceEmit(
      env,
      adapter,
      adapter.reminderOnFile,
      adapter.shortOnFile,
      r.count,
      r.persisted
    );
    emission = {
      ...emission,
      body: appendReadHandoffForLong(
        emission.body,
        cwd,
        current,
        emission.isLong
      ),
    };
    if (meteringState.phase === "plan" && justTrippedLatch) {
      emission = {
        body: bodyFromDirective(
          readDirective(env, providerDirectiveFile(adapter, "latch"))
        ),
        kind: "directive",
        isLong: true,
      };
    }
    if (shouldWarnHandoff(meteringState.usedPercentage, warningSettings)) {
      emission = {
        ...emission,
        body:
          emission.body +
          "\n" +
          bodyFromDirective(
            readDirective(env, providerDirectiveFile(adapter, "handoff"))
          ),
      };
    }
    return composeHookUpdateNotice(
      env,
      updateNoticeSessionId,
      emission,
      effectiveActive,
      meteringState.phase,
      meteringState.usedPercentage
    );
  } catch {
    // Any failure -> inject nothing. Never crash or stall the host turn.
    return "";
  }
}
