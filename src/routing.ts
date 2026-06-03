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

/** Launch model enum accepted by buildCommand. */
const LAUNCH_MODELS = ["haiku", "sonnet", "opus", "opus-4-8", "gpt-5.5"] as const;
type LaunchModel = (typeof LAUNCH_MODELS)[number];

/** Launch effort enum accepted by buildCommand/resolveEffort. */
const LAUNCH_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultracode"] as const;
type LaunchEffort = (typeof LAUNCH_EFFORTS)[number];

/** Sentinel reported (and passed-through harmlessly) for haiku, whose effort is ignored. */
const HAIKU_EFFORT = "none";

/**
 * FULL table model id -> SHORT launch id. Only launchable models appear here.
 * Non-launchable ids (gpt-5.5-pro, gpt-5.4-mini, claude-opus-4-7, unknown) are
 * intentionally absent so buildCandidates skips them rather than coercing.
 */
const FULL_TO_SHORT: Record<string, LaunchModel> = {
  "claude-opus-4-8": "opus-4-8",
  "claude-sonnet-4-6": "sonnet",
  "claude-haiku-4-5": "haiku",
  "gpt-5.5": "gpt-5.5",
  // Short ids may already appear in a hand-authored table; map them through.
  haiku: "haiku",
  sonnet: "sonnet",
  opus: "opus",
  "opus-4-8": "opus-4-8",
};

export interface RoutingTable {
  performance: Record<string, PairingEntry[]>;
  [key: string]: unknown;
}

interface PairingEntry {
  model: string;
  effort: string;
  rank: number;
  [key: string]: unknown;
}

export type SelectionMode = "auto" | "provider" | "provider_model" | "explicit";

export interface Candidate {
  provider: Provider;
  model: string; // SHORT launch id
  effort: string; // normalized launch effort, or HAIKU_EFFORT sentinel
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
 * - ultracode is opus/opus-4-8 only; any other model clamps to "xhigh".
 * - codex has no max/ultracode; both clamp to "xhigh".
 * - unknown tier (not in the launch enum, not "none") -> null (skip candidate).
 *
 * `model` here is the SHORT launch id.
 */
export function normalizeEffort(
  provider: Provider,
  model: string,
  effort: string
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
  if (!(LAUNCH_EFFORTS as readonly string[]).includes(effort)) {
    return null;
  }

  if (provider === "codex" && effort === "max") {
    return "xhigh";
  }

  return effort;
}

/**
 * Build the ordered candidate list for a launch.
 *
 * explicit (provider+model+effort all present): one candidate from the user's
 * triple; the table is NOT read (works with a null table).
 *
 * auto/provider/provider_model: read performance.<task_category> as the pairings
 * array directly (defensive .pairings unwrap), sort by rank asc, map each model
 * to a launch id, normalize effort, and drop non-launchable / unknown-effort
 * pairings. An empty result sets noCandidates:true.
 */
export function buildCandidates(
  table: RoutingTable | null,
  taskCategory: string,
  overrides: Overrides
): CandidateResult {
  const { provider, model, effort } = overrides;

  // explicit: all three present — single direct attempt, no table read.
  if (provider && model && effort) {
    return {
      mode: "explicit",
      candidates: [{ provider, model, effort }],
    };
  }

  const mode: SelectionMode = provider && model ? "provider_model" : provider ? "provider" : "auto";

  const pairings = readPairings(table, taskCategory);

  const candidates: Candidate[] = [];
  for (const entry of pairings) {
    const mappedProvider = mapModelToProvider(entry.model);
    if (mappedProvider === null) continue; // unknown id — skip, never coerce.

    const shortModel = FULL_TO_SHORT[entry.model];
    if (shortModel === undefined) continue; // not in the launch enum — skip.

    // provider / provider_model filters operate on the mapped provider + short id.
    if (provider && mappedProvider !== provider) continue;
    if (model && shortModel !== model) continue;

    const normEffort = normalizeEffort(mappedProvider, shortModel, entry.effort);
    if (normEffort === null) continue; // unknown effort tier — skip.

    candidates.push({ provider: mappedProvider, model: shortModel, effort: normEffort });
  }

  if (candidates.length === 0) {
    return { mode, candidates, noCandidates: true };
  }
  return { mode, candidates };
}

/** Read performance.<category> as the pairings array, sorted by rank asc. */
function readPairings(table: RoutingTable | null, taskCategory: string): PairingEntry[] {
  if (!table || typeof table !== "object") return [];
  const perf = table.performance;
  if (!perf || typeof perf !== "object") return [];

  let raw = (perf as Record<string, unknown>)[taskCategory];
  // Defensive: tolerate a {pairings:[...]} wrapper even though the contract
  // says the value IS the array directly.
  if (raw && !Array.isArray(raw) && typeof raw === "object" && "pairings" in raw) {
    raw = (raw as { pairings: unknown }).pairings;
  }
  if (!Array.isArray(raw)) return [];

  const entries = raw.filter(
    (e): e is PairingEntry => !!e && typeof e === "object" && typeof (e as PairingEntry).model === "string"
  );
  return [...entries].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
}

// The fixed 10 task categories + fallback_default. Maps directly to the
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
}): string | null {
  const { task_category, provider, model, effort } = p;

  // 1. task_category valid?
  if (!task_category || !(TASK_CATEGORIES as readonly string[]).includes(task_category)) {
    const got = task_category ? String(task_category) : "<none>";
    return `Error: task_category is required and must be one of: math_proof, security_review, debugging, quality_review, architecture, agentic_execution, data_analysis, coding, knowledge_synthesis, mechanical, fallback_default. Got: ${got}.\n${SPLIT_HINT}\n${AUTO_HINT}`;
  }

  // 2. effort present must come with provider AND model (checked before model rule).
  if (effort && !(provider && model)) {
    return `Error: effort requires both provider and model. You passed effort=${effort} without a complete provider+model. Either pass provider+model+effort for a fully explicit launch, or omit all three.\n${AUTO_HINT}`;
  }

  // 3. model present must come with provider.
  if (model && !provider) {
    return `Error: provider is required when model is given. You passed model=${model} without provider. Either also pass provider, or omit both.\n${AUTO_HINT}`;
  }

  // 4. explicit mode only: provider+model must satisfy the existing match rule.
  if (provider && model) {
    if (provider === "claude" && !["haiku", "sonnet", "opus", "opus-4-8"].includes(model)) {
      return `Error: Claude provider only supports haiku, sonnet, opus, or opus-4-8. Got: ${model}`;
    }
    if (provider === "codex" && model !== "gpt-5.5") {
      return `Error: Codex provider only supports gpt-5.5. Got: ${model}`;
    }
  }

  return null;
}
