import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./atomic-write.js";
import {
  hashKey,
  ORCH_DISABLE_TTL_MS,
  stateDir,
} from "./marker.js";

export const PLAN_LATCH_THRESHOLD_PCT = 15;
export const HANDOFF_UNLOCK_THRESHOLD_PCT = 50;
export const DEFAULT_CONTEXT_WINDOW = 200000;
export const LONG_CONTEXT_WINDOW = 1000000;

export const CODEX_KNOWN_MODEL_IDS = [
  "gpt-5",
  "gpt-5-codex",
  "gpt-5.5",
  "o3",
  "o3-mini",
  "o4-mini",
] as const;

export const CODEX_CONTEXT_WINDOW_BY_MODEL_ID: Record<
  (typeof CODEX_KNOWN_MODEL_IDS)[number],
  number
> = {
  "gpt-5": DEFAULT_CONTEXT_WINDOW,
  "gpt-5-codex": DEFAULT_CONTEXT_WINDOW,
  "gpt-5.5": DEFAULT_CONTEXT_WINDOW,
  o3: DEFAULT_CONTEXT_WINDOW,
  "o3-mini": DEFAULT_CONTEXT_WINDOW,
  "o4-mini": DEFAULT_CONTEXT_WINDOW,
};

export const CLAUDE_CONTEXT_WINDOW_BY_KIND = {
  default: DEFAULT_CONTEXT_WINDOW,
  long: LONG_CONTEXT_WINDOW,
} as const;

export type MeteringHarness = "claude" | "codex";
export type MeteringPhase = "normal" | "plan" | "handoff";

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
}

export interface UsedPercentageInput {
  context_window_size: number | null;
  used_tokens: number | null;
  harnessPercentage?: number | null;
}

const EMPTY_USAGE: MeteringUsage = {
  input: 0,
  output: 0,
  cache_creation: 0,
  cache_read: 0,
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeUsage(usage: Partial<MeteringUsage> | null | undefined): {
  usage: MeteringUsage;
  used_tokens: number | null;
} {
  if (usage === null || usage === undefined) {
    return { usage: { ...EMPTY_USAGE }, used_tokens: null };
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
  };
}

export function resolveContextWindow(
  harness: string,
  modelId: string | null | undefined,
): number | null {
  if (!modelId) return null;
  if (harness === "claude") {
    if (!/^claude-/i.test(modelId)) return null;
    if (/\[1m\]/i.test(modelId)) return LONG_CONTEXT_WINDOW;
    return DEFAULT_CONTEXT_WINDOW;
  }
  if (harness === "codex") {
    if (!CODEX_KNOWN_MODEL_IDS.includes(modelId as (typeof CODEX_KNOWN_MODEL_IDS)[number])) {
      return null;
    }
    if (/-1m\b|\[1m\]/i.test(modelId)) return LONG_CONTEXT_WINDOW;
    return CODEX_CONTEXT_WINDOW_BY_MODEL_ID[modelId as (typeof CODEX_KNOWN_MODEL_IDS)[number]];
  }
  return null;
}

export function meteringPath(sessionKey: string, stateDirOverride = stateDir): string {
  return join(stateDirOverride, "ctx-" + hashKey(sessionKey) + ".json");
}

export function computeUsedPercentage(record: UsedPercentageInput): number | null {
  if (finiteNumber(record.harnessPercentage)) {
    // Clamp to [0,100] like the computed path: a harness could report a
    // transiently out-of-range percentage, and phase/footer math assumes 0-100.
    return Math.min(100, Math.max(0, record.harnessPercentage));
  }
  if (record.used_tokens === null || record.context_window_size === null) {
    return null;
  }
  return Math.min(100, (record.used_tokens / record.context_window_size) * 100);
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
  const context_window_size = resolveContextWindow(input.harness, input.model);
  const normalized = normalizeUsage(input.usage);
  const used_percentage = computeUsedPercentage({
    context_window_size,
    used_tokens: normalized.used_tokens,
    harnessPercentage: input.harnessPercentage,
  });
  return {
    session_id: input.session_id,
    harness: input.harness,
    model: input.model,
    source_ref: input.source_ref,
    context_window_size,
    usage: normalized.usage,
    used_tokens: normalized.used_tokens,
    used_percentage,
    near_limit:
      used_percentage !== null &&
      used_percentage >= HANDOFF_UNLOCK_THRESHOLD_PCT,
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
