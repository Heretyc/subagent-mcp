import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HANDOFF_WARN_THRESHOLD,
  readContextCoachingSettings,
} from "../concurrency.js";
import { atomicWriteJson } from "./atomic-write.js";
import {
  hashKey,
  ORCH_DISABLE_TTL_MS,
  stateDir,
} from "./marker.js";

export const PLAN_LATCH_THRESHOLD_PCT = 15;
/**
 * Goal-context unlock. `handoff-write` unlocks at 20% so the session captures a
 * DEFINABLE AND ACHIEVABLE goal while it still has the context to describe one,
 * rather than at the old 40% wind-down-adjacent point. The literal `20` is the
 * single source of truth for the unlock WORDING too: handoff.ts pins its
 * unavailable string to this constant with a template-literal type, so the
 * number and the user-visible sentence cannot drift apart.
 */
export const HANDOFF_UNLOCK_THRESHOLD_PCT = 20;
const FALLBACK_HANDOFF_WARNING_THRESHOLD_PCT = DEFAULT_HANDOFF_WARN_THRESHOLD;
export const DEFAULT_CONTEXT_WINDOW = 200000;
export const LONG_CONTEXT_WINDOW = 1000000;

export type MeteringHarness = "claude" | "codex";
export type MeteringPhase = "normal" | "plan" | "handoff";
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
  near_limit: boolean;
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
  /**
   * Shared context-coaching settings backing `near_limit`. Injected by the
   * caller (the hook resolves them once per turn) so this module stays a pure,
   * IO-free leaf. Omitted/null falls back to the default warn threshold.
   */
  warningSettings?: HandoffWarningSettings | null;
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
 * Structural view of the shared context-coaching settings
 * (`ContextCoachingSettings` in src/concurrency.ts, read via
 * `readContextCoachingSettings()`). Declared structurally rather than imported
 * so this module stays an IO-free leaf: concurrency.ts performs file reads at
 * import time, and metering.ts is loaded by both the MCP server and every
 * per-turn hook process. hook-core.ts owns the actual config read and injects
 * the result here.
 */
export interface HandoffWarningSettings {
  contextCoaching: boolean;
  handoffWarnThreshold: number;
}

/**
 * Resolve the effective wind-down warning threshold, or `null` when warning is
 * switched off.
 *
 * Configurability is bounded to exactly what the shared settings surface
 * supports today: `contextCoaching` (off => no warning at all) and
 * `handoffWarnThreshold` (the percentage). Range sanitation is NOT repeated
 * here — `clampHandoffWarnThreshold()` in concurrency.ts already defaults
 * malformed user values at read time, so this stays the single consumer of
 * an already-valid number and cannot disagree with it.
 */
export function resolveHandoffWarningPct(
  settings?: HandoffWarningSettings | null,
): number | null {
  if (settings === undefined || settings === null) {
    return FALLBACK_HANDOFF_WARNING_THRESHOLD_PCT;
  }
  if (settings.contextCoaching === false) return null;
  return finiteNumber(settings.handoffWarnThreshold)
    ? settings.handoffWarnThreshold
    : FALLBACK_HANDOFF_WARNING_THRESHOLD_PCT;
}

/**
 * Read the shared context-coaching settings, fail-safe.
 *
 * Any read/parse failure yields null so resolveHandoffWarningPct falls back to
 * the conservative built-in threshold rather than silencing the warning.
 */
export function readSharedCoachingSettings(): HandoffWarningSettings | null {
  try {
    return readContextCoachingSettings();
  } catch {
    return null;
  }
}

/**
 * The effective wind-down warning percentage for this machine's configuration.
 *
 * Zero-argument convenience over resolveHandoffWarningPct(): it always returns
 * a NUMBER, because callers that merely need to know "where is the warn line"
 * (status surfaces, docs, tests) still need a percentage even when
 * `contextCoaching` is false and no warning will actually be emitted. Whether
 * the warning FIRES is a separate question, answered by
 * resolveHandoffWarningPct() returning null.
 */
export function resolveWarnThresholdPct(): number {
  const settings = readSharedCoachingSettings();
  if (settings === null) return FALLBACK_HANDOFF_WARNING_THRESHOLD_PCT;
  return finiteNumber(settings.handoffWarnThreshold)
    ? settings.handoffWarnThreshold
    : FALLBACK_HANDOFF_WARNING_THRESHOLD_PCT;
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
  // Explicit injection wins (the hook resolves settings ONCE per turn and passes
  // them here, so the tag and near_limit agree). An absent field means "resolve
  // for me" — callers outside the hook still get configuration-correct
  // near_limit rather than the bare fallback. An explicit null means "no
  // settings available", which is what the fail-safe fallback is for.
  const warningPct = resolveHandoffWarningPct(
    input.warningSettings === undefined
      ? readSharedCoachingSettings()
      : input.warningSettings,
  );
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
    near_limit:
      used_percentage !== null &&
      warningPct !== null &&
      used_percentage >= warningPct,
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
