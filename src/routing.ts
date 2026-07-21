/**
 * Routing-table loader and pure resolver for auto-mode launches.
 *
 * Loads dist/routing-table.json (copied from src/routing-table.json at build by
 * scripts/copy-provider.mjs), then builds an ordered candidate list per the
 * supplied overrides. NO spawning happens here — the attempt loop in index.ts
 * consumes the candidate triples and reuses buildCommand/resolveExe/spawn.
 *
 * Contract: docs/spec/auto-mode/routing-table-contract.md.
 * effort.ts / platform.ts are wrapped, never modified.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Provider } from "./effort.js";
import type { ApiProvider } from "./providers/types.js";
export { slotInsert } from "./providers/slot-router.js";

/** Launch model enum accepted by buildCommand. */
export const LAUNCH_MODELS = ["haiku", "sonnet", "opus", "opus-4-8", "fable", "gpt-5.5", "gpt-5.6"] as const;
type LaunchModel = (typeof LAUNCH_MODELS)[number];

/** Launch effort enum accepted by buildCommand/resolveEffort. */
export const LAUNCH_EFFORTS = ["medium", "high", "xhigh", "max", "ultracode"] as const;
type LaunchEffort = (typeof LAUNCH_EFFORTS)[number];

/** Sentinel reported (and passed-through harmlessly) for haiku, whose effort is ignored. */
export const HAIKU_EFFORT = "none";

/**
 * FULL table model id -> SHORT launch id. Only launchable models appear here.
 * The shipped routing table is expected to contain only these launchable ids.
 * The undefined-map skip in buildCandidates remains a safety net for stale or
 * hand-authored tables, never a primary filtering mechanism.
 * For models with aliases (e.g., opus and opus-4-8 both refer to claude-opus-4-8),
 * map to a Set of valid short ids to check membership during filtering.
 */
const FULL_TO_SHORT: Record<string, LaunchModel | Set<LaunchModel>> = {
  "claude-opus-4-8": new Set(["opus", "opus-4-8"]),
  "claude-sonnet-4-6": "sonnet",
  "claude-haiku-4-5": "haiku",
  "claude-fable-5": "fable",
  "gpt-5.5": "gpt-5.5",
  "gpt-5.6-sol": "gpt-5.6",
  "gpt-5.6": "gpt-5.6",
  // Short ids may already appear in a hand-authored table; map them through.
  haiku: "haiku",
  sonnet: "sonnet",
  opus: "opus",
  "opus-4-8": "opus-4-8",
  fable: "fable",
};

export interface RoutingTable {
  performance?: Record<string, PairingEntry[]>;
  cost_efficiency?: Record<string, PairingEntry[]>;
  [key: string]: unknown;
}

interface PairingEntry {
  model: string;
  effort: string | null;
  rank: number;
  [key: string]: unknown;
}

export type SelectionMode = "auto" | "provider" | "provider_model" | "explicit";

export type RoutingBranch = "cost_efficiency" | "performance";
export const DEFAULT_BRANCH: RoutingBranch = "cost_efficiency";

export interface Candidate {
  provider: Provider;
  model: string; // SHORT launch id
  effort: string; // normalized launch effort, or HAIKU_EFFORT sentinel
  apiProvider?: ApiProvider;
}

export interface CandidateResult {
  mode: SelectionMode;
  candidates: Candidate[];
  /** True when the table-backed category yielded zero launchable candidates. */
  noCandidates?: boolean;
}

export interface Overrides {
  provider?: Provider;
  model?: string;
  effort?: string;
}

/** Resolve dist/routing-table.json relative to this module at runtime. */
function defaultTablePath(): string {
  return fileURLToPath(new URL("./routing-table.json", import.meta.url));
}

/**
 * Load + parse the routing table. Never throws: ENOENT, parse error, or any
 * read failure -> null (handler emits ERR_TABLE_MISSING).
 *
 * Fresh read per launch — NO process-lifetime cache. The file is tiny and
 * launches are infrequent, so a table emitted AFTER server start (the profiler
 * scenario) is picked up on the next launch with no restart
 * (routing-table-contract.md). When `path` is given (tests) it is read directly.
 */
export function loadRoutingTable(path?: string): RoutingTable | null {
  return readTable(path ?? defaultTablePath());
}

function readTable(path: string): RoutingTable | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as RoutingTable;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Map a table model id to its launch provider. Claude ids -> "claude"; any
 * GPT/codex-family id -> "codex"; unrecognised -> null (skip signal; never
 * coerce). Non-launchable codex siblings (gpt-5.5-pro) still map to "codex" so
 * the provider filter is correct; they are dropped later at the launch-enum step.
 */
export function mapModelToProvider(model: string): Provider | null {
  if (
    model === "haiku" ||
    model === "sonnet" ||
    model === "opus" ||
    model === "opus-4-8" ||
    model === "fable" ||
    model.startsWith("claude-")
  ) {
    return "claude";
  }
  if (model === "gpt-5.5" || model.startsWith("gpt-")) {
    return "codex";
  }
  return null;
}

/**
 * Normalize a table effort tier to the launch enum, mirroring src/effort.ts so
 * the resolver never feeds an invalid combo into buildCommand.
 *
 * - haiku -> "none" sentinel (effort ignored by buildCommand; reported as-is).
 * - `none` on effort-capable models is invalid routing data -> null (skip candidate).
 * - ultracode is opus/opus-4-8 only; any other model clamps to "xhigh".
 * - codex has no max/ultracode; both clamp to "xhigh".
 * - unknown tier (not in the launch enum) -> null (skip candidate).
 *
 * `model` here is the SHORT launch id.
 */
export function normalizeEffort(
  provider: Provider,
  model: string,
  effort: string | null
): string | null {
  // haiku ignores effort entirely; report the sentinel.
  if (provider === "claude" && model === "haiku") {
    return HAIKU_EFFORT;
  }

  const isOpus48 = provider === "claude" && (model === "opus" || model === "opus-4-8");

  if (effort === "ultracode") {
    return isOpus48 ? "ultracode" : "xhigh";
  }

  // Unknown tiers (not a launch-enum value, not handled above) -> skip.
  if (typeof effort !== "string" || !(LAUNCH_EFFORTS as readonly string[]).includes(effort)) {
    return null;
  }

  if (provider === "codex" && effort === "max") {
    return "xhigh";
  }

  if (provider === "api") {
    return effort;
  }

  return effort;
}

/**
 * Build the ordered candidate list for a launch.
 *
 * explicit (provider+model+effort all present): one candidate from the user's
 * triple; the table is NOT read (works with a null table).
 *
 * auto/provider/provider_model: read <branch>.<task_category> as the pairings
 * array directly, sort by rank asc, map each model to a launch id, normalize
 * effort, and drop non-launchable / unknown-effort pairings. An empty result
 * sets noCandidates:true.
 */
export function buildCandidates(
  table: RoutingTable | null,
  taskCategory: string,
  overrides: Overrides,
  branch: RoutingBranch = DEFAULT_BRANCH
): CandidateResult {
  const { provider, model, effort } = overrides;

  // explicit: all three present — single direct attempt, no table read. The
  // effort is normalized exactly like table rows (haiku -> "none", codex
  // max -> xhigh, non-opus ultracode -> xhigh) so the candidate list is
  // always validator-legal for the advanced-ruleset payload (io-contract.md).
  if (provider && model && effort) {
    return {
      mode: "explicit",
      candidates: [
        { provider, model, effort: normalizeEffort(provider, model, effort) ?? effort },
      ],
    };
  }

  const mode: SelectionMode = provider && model ? "provider_model" : provider ? "provider" : "auto";

  const pairings = readPairings(table, taskCategory, branch);

  const candidates: Candidate[] = [];
  for (const entry of pairings) {
    const mappedProvider = mapModelToProvider(entry.model);
    if (mappedProvider === null) continue; // unknown id — skip, never coerce.

    const shortModelOrSet = FULL_TO_SHORT[entry.model];
    if (shortModelOrSet === undefined) continue; // not in the launch enum — skip.

    // Unwrap shortModel: handle both string and Set of aliases.
    // For the returned candidate, use the canonical short id (opus-4-8 not opus).
    // For matching user's model filter: check membership in the Set.
    let shortModel: LaunchModel;
    if (shortModelOrSet instanceof Set) {
      // Canonical form: "opus-4-8" for Opus models (prefer versioned).
      shortModel = shortModelOrSet.has("opus-4-8") ? "opus-4-8" : Array.from(shortModelOrSet)[0];
    } else {
      shortModel = shortModelOrSet as LaunchModel;
    }

    // provider / provider_model filters operate on the mapped provider + short id.
    if (provider && mappedProvider !== provider) continue;
    if (model) {
      // Check membership: if shortModelOrSet is a Set, check if model is in it.
      const modelMatches = shortModelOrSet instanceof Set
        ? shortModelOrSet.has(model as LaunchModel)
        : shortModel === model;
      if (!modelMatches) continue;
    }

    const normEffort = normalizeEffort(mappedProvider, shortModel, entry.effort);
    if (normEffort === null) continue; // unknown effort tier — skip.

    candidates.push({ provider: mappedProvider, model: shortModel, effort: normEffort });
  }

  if (candidates.length === 0) {
    return { mode, candidates, noCandidates: true };
  }
  return { mode, candidates };
}

/** Read <branch>.<category> as the pairings array, sorted by rank asc. */
function readPairings(table: RoutingTable | null, taskCategory: string, branch: RoutingBranch = DEFAULT_BRANCH): PairingEntry[] {
  if (!table || typeof table !== "object") return [];
  const perf = table[branch];
  if (!perf || typeof perf !== "object") return [];

  const raw = (perf as Record<string, unknown>)[taskCategory];
  if (!Array.isArray(raw)) return [];

  const entries = raw.filter(
    (e): e is PairingEntry => !!e && typeof e === "object" && typeof (e as PairingEntry).model === "string"
  );
  return [...entries].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
}

// The fixed 14 task categories + fallback_default. Maps directly to the
// routing-table category keys (param-contract.md). Immutable taxonomy.
export const TASK_CATEGORIES = [
  "math_proof",
  "security_review",
  "debugging",
  "quality_review",
  "architecture",
  "agentic_execution",
  "data_analysis",
  "coding",
  "knowledge_synthesis",
  "mechanical",
  "prompt_engineering",
  "vulnerability_research",
  "molecular_biology",
  "ml_accelerator_design",
  "fallback_default",
] as const;

// Shared error hint blocks (resolution-matrix.md). Appended verbatim.
export const AUTO_HINT =
  "Tip: omit provider/model/effort entirely and the server auto-selects the best provider/model/effort for this task_category, with automatic silent fallback.";
export const SPLIT_HINT =
  "If unsure which category fits, do NOT pass one big amorphous task: break the work into smaller atomic steps that each map to a single task_category, and launch one agent per step.";

/**
 * Pure param-presence validator for launch_agent (resolution-matrix.md).
 *
 * Returns the exact error string for the first failing rule, or null when the
 * presence combination is valid. Order MUST match resolution-matrix.md
 * "Validation order": category, then effort-needs-both, then model-needs-provider,
 * then the explicit provider↔model match rule. Exported (and side-effect-free:
 * this module never spawns or opens a transport) so the matrix and the verbatim
 * error text (incl. AUTO_HINT/SPLIT_HINT placement) are CI-asserted directly
 * against the production logic (Rule 9), not a re-implementation.
 */
export function validatePresence(p: {
  task_category?: string;
  provider?: string;
  model?: string;
  effort?: string;
  deadlock?: boolean;
}): string | null {
  const { task_category, provider, model, effort, deadlock } = p;

  // 1. task_category valid?
  if (!task_category || !(TASK_CATEGORIES as readonly string[]).includes(task_category)) {
    const got = task_category ? String(task_category) : "<none>";
    return `Error: task_category is required and must be one of: ${TASK_CATEGORIES.join(", ")}. Got: ${got}.\n${SPLIT_HINT}\n${AUTO_HINT}`;
  }

  // 2. deadlock cannot be combined with provider/model/effort.
  if (deadlock === true && (provider || model || effort)) {
    return `Error: deadlock cannot be combined with provider, model, or effort. From the 3rd attempt for the same atomic task, deadlock outranks capability overrides: drop provider/model/effort and retry.\n${AUTO_HINT}`;
  }

  // 3. effort present must come with provider AND model (checked before model rule).
  if (effort && !(provider && model)) {
    return `Error: effort requires both provider and model. You passed effort=${effort} without a complete provider+model. Either pass provider+model+effort for a fully explicit launch, or omit all three.\n${AUTO_HINT}`;
  }

  // 4. model present must come with provider.
  if (model && !provider) {
    return `Error: provider is required when model is given. You passed model=${model} without provider. Either also pass provider, or omit both.\n${AUTO_HINT}`;
  }

  // fallback_default is valid only for fully explicit launches.
  if (task_category === "fallback_default" && !(provider && model && effort)) {
    return `Error: fallback_default is a split hint sentinel, not a launchable routing-table category.\n${SPLIT_HINT}\n${AUTO_HINT}`;
  }

  // Override providers are launchable CLI providers only: "claude" or "codex".
  // "api" is INTERNAL auto-slot routing (slotInsert) — populated with
  // apiProvider metadata after candidate construction, never selectable as an
  // explicit/manual override. Reject a stale or enum-bypassed "api" (or any
  // other value) here, the shared validation boundary that runs before
  // buildCandidates, so it can never form a candidate, launch, or fail over.
  if (provider && provider !== "claude" && provider !== "codex") {
    return `Error: provider override must be claude or codex. Got: ${provider}. The api provider is internal auto-slot routing only and cannot be selected explicitly.\n${AUTO_HINT}`;
  }

  // provider+model must satisfy the existing match rule.
  if (provider && model) {
    if (provider === "claude" && !["haiku", "sonnet", "opus", "opus-4-8", "fable"].includes(model)) {
      return `Error: Claude provider only supports haiku, sonnet, opus, opus-4-8, or fable. Got: ${model}`;
    }
    if (provider === "codex" && !["gpt-5.5", "gpt-5.6"].includes(model)) {
      return `Error: Codex provider only supports gpt-5.5 or gpt-5.6. Got: ${model}`;
    }
  }

  return null;
}
