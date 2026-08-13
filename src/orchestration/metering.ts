import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteJson } from "./atomic-write.js";
import {
  hashKey,
  ORCH_DISABLE_TTL_MS,
  stateDir,
} from "./marker.js";

export const PLAN_LATCH_THRESHOLD_PCT = 15;
/**
 * Goal-context unlock. `handoff-write` unlocks at 20% so the session captures a
 * DEFINABLE AND ACHIEVABLE goal while it still has the context to describe one.
 * The literal `20` is the
 * single source of truth for the unlock WORDING too: handoff.ts pins its
 * unavailable string to this constant with a template-literal type, so the
 * number and the user-visible sentence cannot drift apart.
 */
export const HANDOFF_UNLOCK_THRESHOLD_PCT = 20;
export const DEFAULT_CONTEXT_WINDOW = 200000;
export const LONG_CONTEXT_WINDOW = 1000000;

/**
 * Host auto-compaction line. Codex 0.147.0 compacts at this utilization and
 * setup reconciles Claude Code's auto-compact percentage to the same number, so
 * both harnesses exhaust context at one shared point. Fixed in code, never a
 * user knob.
 */
export const CODEX_AUTOCOMPACT_PCT = 90;
/**
 * Mandatory fresh-handoff-write line. A session that reaches this utilization
 * with no eligible prepared handoff record must write one, 10 points before the
 * host compacts, so a durable resume record exists before context is dropped.
 * Not user configurable: derived from CODEX_AUTOCOMPACT_PCT so the two move
 * together.
 */
export const HANDOFF_REQUIRED_THRESHOLD_PCT = CODEX_AUTOCOMPACT_PCT - 10;
/**
 * Minimum previous->current utilization drop (in points) that reads as host
 * auto-compaction rather than a normal turn-to-turn decrease.
 */
export const COMPACTION_DROP_THRESHOLD_PCT = 10;
/**
 * Freshness horizon for compaction detection. The current sample must be this
 * recent, and the adjacent previous sample no older than this before it, or the
 * pair is stale and cannot be trusted to describe one compaction event.
 */
export const COMPACTION_SAMPLE_MAX_AGE_MS = 30 * 60 * 1000;

export type MeteringHarness = "claude" | "codex";
export type MeteringPhase = "normal" | "plan" | "handoff";
/**
 * Whether a usage sample is the harness's CURRENT (per-turn, non-cumulative)
 * figure or a CUMULATIVE session total. Cumulative samples (e.g. the Codex
 * total_token_usage fallback) can decrease for reasons unrelated to compaction,
 * so they are ineligible for compaction detection.
 */
export type MeteringSampleKind = "current" | "cumulative";
export type WindowSource =
  | "harness"
  | "mapping"
  | "hint"
  | "ratchet"
  | "prior"
  | "family-default"
  | "contradiction"
  | "assumed-default"
  | "assumed-default+floor"
  | null;

export interface MeteringUsage {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
}

export interface MeteringRecord {
  session_id: string;
  harness: MeteringHarness;
  model: string;
  source_ref: string;
  context_window_size: number | null;
  window_source?: WindowSource;
  window_floor?: number | null;
  usage: MeteringUsage;
  used_tokens: number | null;
  used_percentage: number | null;
  /**
   * Monotonic per-session sample counter. Each persisted sample is exactly one
   * greater than the prior one, so compaction detection can require adjacency
   * and reject out-of-order or gapped samples.
   */
  sample_seq: number;
  /** Whether this sample is a current per-turn figure or a cumulative total. */
  sample_kind: MeteringSampleKind;
  /**
   * Provider-derived generation fingerprint proving a post-compaction
   * generation. The pre-compaction sample may omit it; `null` means no eligible
   * proof this turn, and a string is the fingerprint.
   */
  compaction_generation?: string | null;
  event: string;
  updated_at: number;
}

export interface BuildMeteringRecordInput {
  session_id: string;
  harness: MeteringHarness;
  model: string;
  source_ref: string;
  usage?: Partial<MeteringUsage> | null;
  event: string;
  harnessPercentage?: number | null;
  harnessContextWindow?: number | null;
  longContextHint?: boolean | null;
  priorWindow?: number | null;
  priorWindowSource?: WindowSource;
  priorWindowFloor?: number | null;
  /** The prior persisted sample's sequence number, to derive this sample's. */
  priorSampleSeq?: number | null;
  /** Current vs cumulative usage; defaults to "current" when omitted. */
  sampleKind?: MeteringSampleKind | null;
  /** Provider-derived generation fingerprint proof; defaults to null. */
  compactionGeneration?: string | null;
}

export interface UsedPercentageInput {
  context_window_size: number | null;
  used_tokens: number | null;
  harnessPercentage?: number | null;
}

interface ContextWindowEntry {
  default: number;
  long: number | null;
}

interface ContextWindowTable {
  schema_version: 1;
  family_defaults?: {
    claude?: ContextWindowEntry;
  };
  claude: Record<string, ContextWindowEntry>;
  codex: Record<string, ContextWindowEntry>;
}

export interface WindowResolution {
  window: number | null;
  source: WindowSource;
  window_floor: number | null;
  contradiction: boolean;
}

const EMPTY_USAGE: MeteringUsage = {
  input: 0,
  output: 0,
  cache_creation: 0,
  cache_read: 0,
};

let cachedWindowTable: ContextWindowTable | null | undefined;
let contextWindowsPathOverride: string | null = null;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isContextWindowEntry(value: unknown): value is ContextWindowEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ContextWindowEntry>;
  return (
    isPositiveInteger(record.default) &&
    (record.long === null ||
      (isPositiveInteger(record.long) && record.long > record.default))
  );
}

function isContextWindowMap(value: unknown): value is Record<string, ContextWindowEntry> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(isContextWindowEntry);
}

function isContextWindowTable(value: unknown): value is ContextWindowTable {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ContextWindowTable>;
  const familyDefaults = record.family_defaults;
  const claudeFamilyDefault =
    !familyDefaults ||
    (typeof familyDefaults === "object" &&
      familyDefaults !== null &&
      !Array.isArray(familyDefaults) &&
      (familyDefaults as ContextWindowTable["family_defaults"])?.claude !== undefined &&
      isContextWindowEntry((familyDefaults as ContextWindowTable["family_defaults"])?.claude));
  return (
    record.schema_version === 1 &&
    claudeFamilyDefault &&
    isContextWindowMap(record.claude) &&
    isContextWindowMap(record.codex)
  );
}

function contextWindowsPath(): string {
  return (
    contextWindowsPathOverride ??
    fileURLToPath(new URL("../context-windows.json", import.meta.url))
  );
}

export function setContextWindowsPathForTest(path: string | null): void {
  contextWindowsPathOverride = path;
  cachedWindowTable = undefined;
}

function loadContextWindowTable(): ContextWindowTable | null {
  if (cachedWindowTable !== undefined) return cachedWindowTable;
  try {
    const parsed = JSON.parse(readFileSync(contextWindowsPath(), "utf8").replace(/^\uFEFF/, "")) as unknown;
    cachedWindowTable = isContextWindowTable(parsed) ? parsed : null;
  } catch {
    cachedWindowTable = null;
  }
  return cachedWindowTable;
}

export function normalizeModelId(modelId: string | null | undefined): {
  base: string;
  idMarker: boolean;
} | null {
  if (typeof modelId !== "string") return null;
  let base = modelId.trim().toLowerCase();
  if (!base) return null;
  let idMarker = /\[1m\]/i.test(base) || /-1m\b/i.test(base);
  base = base.replace(/\[[^\]]+\]/g, "");
  base = base.replace(/-1m\b/g, "");
  const dated = base.replace(/-(20\d{6})$/, "");
  base = dated;
  if (!base) return null;
  return { base, idMarker };
}

function normalizeUsage(usage: Partial<MeteringUsage> | null | undefined): {
  usage: MeteringUsage;
  used_tokens: number | null;
  prompt_side_tokens: number | null;
} {
  if (usage === null || usage === undefined) {
    return { usage: { ...EMPTY_USAGE }, used_tokens: null, prompt_side_tokens: null };
  }
  const normalized: MeteringUsage = {
    input: finiteNumber(usage.input) ? usage.input : 0,
    output: finiteNumber(usage.output) ? usage.output : 0,
    cache_creation: finiteNumber(usage.cache_creation) ? usage.cache_creation : 0,
    cache_read: finiteNumber(usage.cache_read) ? usage.cache_read : 0,
  };
  return {
    usage: normalized,
    used_tokens:
      normalized.input +
      normalized.output +
      normalized.cache_creation +
      normalized.cache_read,
    prompt_side_tokens:
      normalized.input + normalized.cache_creation + normalized.cache_read,
  };
}

function usablePriorFloor(
  priorWindow: number | null | undefined,
  priorSource: WindowSource | undefined,
  priorWindowFloor: number | null | undefined,
): number | null {
  // The monotonic floor tracks the highest OBSERVED prompt-side token count,
  // never the resolved window size. window_source gating lives in how
  // priorWindowFloor is produced: hint-only turns record their observed tokens
  // (not the 1M hint window), so a hint window never becomes sticky, while a
  // ratcheted/prior turn carries the real observed floor forward.
  void priorWindow;
  void priorSource;
  return finiteNumber(priorWindowFloor) ? priorWindowFloor : null;
}

function maybeApplyLong(
  candidate: number,
  source: WindowSource,
  long: number | null,
  enabled: boolean,
): { candidate: number; source: WindowSource } {
  if (enabled && long !== null && candidate < long) {
    return { candidate: long, source: "hint" };
  }
  return { candidate, source };
}

function assumedDefaultResolution(window_floor: number | null): WindowResolution {
  if (window_floor !== null && window_floor > DEFAULT_CONTEXT_WINDOW) {
    return {
      window: window_floor,
      source: "assumed-default+floor",
      window_floor,
      contradiction: false,
    };
  }
  return {
    window: DEFAULT_CONTEXT_WINDOW,
    source: "assumed-default",
    window_floor,
    contradiction: false,
  };
}

export function resolveContextWindowDetailed(input: {
  harness: string;
  modelId: string | null | undefined;
  longContextHint?: boolean | null;
  promptSideTokens?: number | null;
  priorWindow?: number | null;
  priorWindowSource?: WindowSource;
  priorWindowFloor?: number | null;
  harnessContextWindow?: number | null;
}): WindowResolution {
  const promptSideTokens = finiteNumber(input.promptSideTokens)
    ? input.promptSideTokens
    : null;
  const priorFloor = usablePriorFloor(
    input.priorWindow,
    input.priorWindowSource,
    input.priorWindowFloor,
  );
  const observedFloor = Math.max(promptSideTokens ?? 0, priorFloor ?? 0);
  const window_floor = observedFloor > 0 ? observedFloor : null;
  if (
    finiteNumber(input.harnessContextWindow) &&
    input.harnessContextWindow > 0
  ) {
    return {
      window: input.harnessContextWindow,
      source: "harness",
      window_floor,
      contradiction: false,
    };
  }
  const normalized = normalizeModelId(input.modelId);
  if (normalized === null) {
    return assumedDefaultResolution(window_floor);
  }
  const table = loadContextWindowTable();
  if (table === null) {
    return assumedDefaultResolution(window_floor);
  }

  if (input.harness === "claude") {
    if (!/^claude-/i.test(normalized.base)) {
      return assumedDefaultResolution(window_floor);
    }
    const entry = table.claude[normalized.base] ?? table.family_defaults?.claude ?? null;
    if (entry === null) {
      return assumedDefaultResolution(window_floor);
    }
    const mapped = Object.prototype.hasOwnProperty.call(table.claude, normalized.base);
    let candidate = entry.default;
    let source: WindowSource = mapped ? "mapping" : "family-default";
    const hinted = normalized.idMarker || input.longContextHint === true;
    ({ candidate, source } = maybeApplyLong(candidate, source, entry.long, hinted));
    if (promptSideTokens !== null && promptSideTokens > candidate) {
      if (entry.long !== null && promptSideTokens <= entry.long) {
        candidate = entry.long;
        source = "ratchet";
      } else {
        return { window: entry.long ?? entry.default, source: "contradiction", window_floor, contradiction: true };
      }
    }
    if (priorFloor !== null && priorFloor > candidate) {
      if (entry.long !== null && priorFloor <= entry.long) {
        candidate = entry.long;
        source = "prior";
      } else {
        return { window: entry.long ?? entry.default, source: "contradiction", window_floor, contradiction: true };
      }
    }
    return { window: candidate, source, window_floor, contradiction: false };
  }

  if (input.harness === "codex") {
    const entry = table.codex[normalized.base] ?? null;
    if (entry === null) {
      return assumedDefaultResolution(window_floor);
    }
    let candidate = entry.default;
    let source: WindowSource = "mapping";
    ({ candidate, source } = maybeApplyLong(candidate, source, entry.long, normalized.idMarker));
    if (promptSideTokens !== null && promptSideTokens > candidate) {
      if (entry.long !== null && promptSideTokens <= entry.long) {
        candidate = entry.long;
        source = "ratchet";
      } else {
        return { window: entry.long ?? entry.default, source: "contradiction", window_floor, contradiction: true };
      }
    }
    if (priorFloor !== null && priorFloor > candidate) {
      if (entry.long !== null && priorFloor <= entry.long) {
        candidate = entry.long;
        source = "prior";
      } else {
        return { window: entry.long ?? entry.default, source: "contradiction", window_floor, contradiction: true };
      }
    }
    return { window: candidate, source, window_floor, contradiction: false };
  }

  return assumedDefaultResolution(window_floor);
}

export function resolveContextWindow(
  harness: string,
  modelId: string | null | undefined,
): number | null {
  return resolveContextWindowDetailed({ harness, modelId }).window;
}

export function meteringPath(sessionKey: string, stateDirOverride = stateDir): string {
  return join(stateDirOverride, "ctx-" + hashKey(sessionKey) + ".json");
}

export function computeUsedPercentage(record: UsedPercentageInput): number | null {
  if (finiteNumber(record.harnessPercentage)) {
    return Math.min(100, Math.max(0, record.harnessPercentage));
  }
  if (record.used_tokens === null || record.context_window_size === null) {
    return null;
  }
  return Math.min(100, (record.used_tokens / record.context_window_size) * 100);
}

/**
 * The minimal, structural view of a metering sample the compaction detector
 * reads. `MeteringRecord` satisfies it, but declaring it separately keeps
 * `detectCompaction` a pure function that unit tests can exercise with plain
 * object literals for every rejection path.
 */
export interface CompactionSample {
  session_id: string;
  harness: MeteringHarness;
  model: string;
  source_ref: string;
  context_window_size: number | null;
  used_percentage: number | null;
  sample_seq: number;
  sample_kind: MeteringSampleKind;
  compaction_generation?: string | null;
  updated_at: number;
}

/**
 * Why a previous/current sample pair is NOT auto-compaction. Every value is a
 * distinct, unit-testable rejection path; `null` reason with `detected: true`
 * is the sole accept.
 */
export type CompactionRejectionReason =
  | "no-previous"
  | "session-mismatch"
  | "harness-mismatch"
  | "model-change"
  | "source-mismatch"
  | "context-window-change"
  | "cumulative-sample"
  | "no-generation-proof"
  | "same-generation"
  | "non-monotonic-sequence"
  | "non-adjacent-sequence"
  | "non-monotonic-timestamp"
  | "stale-sample"
  | "unknown-percentage"
  | "previous-below-threshold"
  | "insufficient-drop";

export interface CompactionDetection {
  detected: boolean;
  reason: CompactionRejectionReason | null;
  drop_pct: number | null;
}

export interface DetectCompactionOptions {
  now?: number;
  maxSampleAgeMs?: number;
}

/**
 * Pure, single-path auto-compaction detector: ONE adjacent previous/current
 * sample comparison. Auto-compaction is a >= COMPACTION_DROP_THRESHOLD_PCT drop
 * in utilization between two otherwise-continuous samples with a fresh
 * provider-derived generation fingerprint on the current sample. The
 * pre-compaction sample naturally has no fingerprint; a repeated fingerprint is
 * rejected after the detected sample is persisted. Missing/null current proof
 * and an unchanged fingerprint never trigger.
 * Every mismatch, stale/out-of-order/unknown/cumulative sample, or missing/
 * unchanged proof is rejected with a specific reason so the caller rebaselines
 * instead of firing. No native compaction hook informs this; it is derived
 * solely from the two samples.
 */
export function detectCompaction(
  previous: CompactionSample | null | undefined,
  current: CompactionSample,
  options: DetectCompactionOptions = {},
): CompactionDetection {
  const reject = (reason: CompactionRejectionReason): CompactionDetection => ({
    detected: false,
    reason,
    drop_pct: null,
  });
  if (!previous) return reject("no-previous");
  if (current.session_id !== previous.session_id) return reject("session-mismatch");
  if (current.harness !== previous.harness) return reject("harness-mismatch");
  const curModel = normalizeModelId(current.model)?.base ?? null;
  const prevModel = normalizeModelId(previous.model)?.base ?? null;
  if (curModel === null || prevModel === null || curModel !== prevModel) {
    return reject("model-change");
  }
  if (current.source_ref !== previous.source_ref) return reject("source-mismatch");
  if (current.context_window_size !== previous.context_window_size) {
    return reject("context-window-change");
  }
  if (current.sample_kind !== "current" || previous.sample_kind !== "current") {
    return reject("cumulative-sample");
  }
  // Proof appears on the first post-compaction sample. Once persisted, replay
  // presents the same fingerprint on both sides and is rejected exactly once.
  if (typeof current.compaction_generation !== "string") {
    return reject("no-generation-proof");
  }
  if (
    typeof previous.compaction_generation === "string" &&
    current.compaction_generation === previous.compaction_generation
  ) {
    return reject("same-generation");
  }
  if (!finiteNumber(current.sample_seq) || !finiteNumber(previous.sample_seq)) {
    return reject("non-monotonic-sequence");
  }
  if (current.sample_seq <= previous.sample_seq) return reject("non-monotonic-sequence");
  if (current.sample_seq !== previous.sample_seq + 1) return reject("non-adjacent-sequence");
  if (
    !finiteNumber(current.updated_at) ||
    !finiteNumber(previous.updated_at) ||
    current.updated_at < previous.updated_at
  ) {
    return reject("non-monotonic-timestamp");
  }
  const now = finiteNumber(options.now) ? options.now : Date.now();
  const maxAge = finiteNumber(options.maxSampleAgeMs)
    ? options.maxSampleAgeMs
    : COMPACTION_SAMPLE_MAX_AGE_MS;
  if (now - current.updated_at > maxAge) return reject("stale-sample");
  if (current.updated_at - previous.updated_at > maxAge) return reject("stale-sample");
  if (!finiteNumber(current.used_percentage) || !finiteNumber(previous.used_percentage)) {
    return reject("unknown-percentage");
  }
  if (previous.used_percentage < HANDOFF_REQUIRED_THRESHOLD_PCT) {
    return reject("previous-below-threshold");
  }
  const drop = previous.used_percentage - current.used_percentage;
  if (drop < COMPACTION_DROP_THRESHOLD_PCT) {
    return { detected: false, reason: "insufficient-drop", drop_pct: drop };
  }
  return { detected: true, reason: null, drop_pct: drop };
}

export function phaseFor(usedPercentage: number | null): MeteringPhase {
  return usedPercentage === null
    ? "normal"
    : usedPercentage >= HANDOFF_UNLOCK_THRESHOLD_PCT
      ? "handoff"
      : usedPercentage >= PLAN_LATCH_THRESHOLD_PCT
        ? "plan"
        : "normal";
}

export function buildMeteringRecord(input: BuildMeteringRecordInput): MeteringRecord {
  const normalized = normalizeUsage(input.usage);
  const resolution = resolveContextWindowDetailed({
    harness: input.harness,
    modelId: input.model,
    longContextHint: input.longContextHint,
    promptSideTokens: normalized.prompt_side_tokens,
    priorWindow: input.priorWindow,
    priorWindowSource: input.priorWindowSource,
    priorWindowFloor: input.priorWindowFloor,
    harnessContextWindow: input.harnessContextWindow,
  });
  const used_percentage = computeUsedPercentage({
    context_window_size: resolution.window,
    used_tokens: normalized.used_tokens,
    harnessPercentage: input.harnessPercentage,
  });
  const priorSeq = finiteNumber(input.priorSampleSeq) ? input.priorSampleSeq : null;
  return {
    session_id: input.session_id,
    harness: input.harness,
    model: input.model,
    source_ref: input.source_ref,
    context_window_size: resolution.window,
    window_source: resolution.source,
    window_floor: resolution.window_floor,
    usage: normalized.usage,
    used_tokens: normalized.used_tokens,
    used_percentage,
    sample_seq: priorSeq === null ? 0 : priorSeq + 1,
    sample_kind: input.sampleKind === "cumulative" ? "cumulative" : "current",
    compaction_generation: input.compactionGeneration ?? null,
    event: input.event,
    updated_at: Date.now(),
  };
}

function isMeteringRecord(value: unknown): value is MeteringRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<MeteringRecord>;
  return typeof record.updated_at === "number";
}

export function readMetering(
  sessionKey: string,
  stateDirOverride = stateDir,
): MeteringRecord | null {
  try {
    const path = meteringPath(sessionKey, stateDirOverride);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isMeteringRecord(parsed)) return null;
    if (Date.now() - parsed.updated_at > ORCH_DISABLE_TTL_MS) {
      unlinkSync(path);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeMetering(
  sessionKey: string,
  record: MeteringRecord,
  stateDirOverride = stateDir,
): boolean {
  try {
    mkdirSync(stateDirOverride, { recursive: true, mode: 0o700 });
    atomicWriteJson(meteringPath(sessionKey, stateDirOverride), record, {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  } catch {
    return false;
  }
}
