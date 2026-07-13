import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { pathToFileURL } from "node:url";

import {
  claimAndEmit,
  classifyOwnerClaim,
  computeEffectiveActive,
  countJsonlType,
  cullHookZombies,
  ownerKey,
  runHook,
  TRANSCRIPT_READ_CAP,
  type HookPayload,
  type ProviderAdapter,
} from "../orchestration/hook-core.js";
import * as marker from "../orchestration/marker.js";
import {
  type MeteringHarness,
  type MeteringUsage,
} from "../orchestration/metering.js";
import { isParentProcessMarkerFirstLine } from "../launch-prompt.js";

/**
 * Codex CLI hook entry. Branches on payload.hook_event_name:
 *   - 'SessionStart'     -> if active and not a subagent, emit FULL + the ON
 *                           reminder block (covers the turn-0 directive before
 *                           the first UserPromptSubmit).
 *   - 'UserPromptSubmit' -> the normal per-prompt reminder cadence (runHook).
 *
 * Compiles to dist/hooks/orchestration-codex.js and is invoked as:
 *   node "<PLUGIN_ROOT>/dist/hooks/orchestration-codex.js"
 */

// Codex 0.131+ source-string variants that mark a SUBAGENT session.
const SUBAGENT_SOURCE_STRINGS = new Set([
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
]);

export interface LiftedUsage {
  harness: MeteringHarness;
  model: string;
  source_ref: string;
  usage: MeteringUsage;
  harnessPercentage?: number | null;
  longContextHint?: boolean | null;
}

type CodexAdapter = ProviderAdapter & {
  liftUsage(
    payload: HookPayload,
    env: NodeJS.ProcessEnv,
    transcriptPath: string | undefined
  ): LiftedUsage | null;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function tailJsonlLines(transcriptPath: string | undefined): string[] {
  if (!transcriptPath) return [];
  let fd: number | undefined;
  try {
    const size = statSync(transcriptPath).size;
    let raw: string;
    let droppedPartialHead = false;

    if (size <= TRANSCRIPT_READ_CAP) {
      raw = readFileSync(transcriptPath, "utf8");
    } else {
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

    const lines = raw.split("\n");
    if (droppedPartialHead) {
      lines.shift();
    }
    return lines.map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
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

function nestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const child = (value as Record<string, unknown>)[key];
  return child && typeof child === "object"
    ? (child as Record<string, unknown>)
    : null;
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const child = (value as Record<string, unknown>)[key];
  return typeof child === "string" ? child : null;
}

function isTokenCountLine(obj: Record<string, unknown>): boolean {
  if (obj.type === "token_count") return true;
  const payload = nestedRecord(obj, "payload");
  return payload?.type === "token_count";
}

function tokenInfo(obj: Record<string, unknown>): Record<string, unknown> | null {
  const direct = nestedRecord(obj, "info");
  if (direct) return direct;
  return nestedRecord(nestedRecord(obj, "payload"), "info");
}

function modelFromTurnContext(obj: Record<string, unknown>): string | null {
  if (obj.type !== "turn_context") return null;
  return stringField(obj, "model") ?? stringField(nestedRecord(obj, "payload"), "model");
}

function liftCodexUsageFromRollout(transcriptPath: string | undefined): LiftedUsage | null {
  let latestTokenInfo: Record<string, unknown> | null = null;
  let latestModel: string | null = null;

  const lines = tailJsonlLines(transcriptPath);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]) as unknown;
      if (!obj || typeof obj !== "object") continue;
      const record = obj as Record<string, unknown>;
      if (!latestTokenInfo && isTokenCountLine(record)) {
        latestTokenInfo = tokenInfo(record);
      }
      if (!latestModel) {
        latestModel = modelFromTurnContext(record);
      }
      if (latestTokenInfo && latestModel) break;
    } catch {
      // Skip unparseable lines; never throw.
    }
  }

  const total = nestedRecord(latestTokenInfo, "total_token_usage");
  if (!total || !latestModel || !transcriptPath) return null;

  const input = total.input_tokens;
  const output = total.output_tokens;
  const cacheRead = total.cached_input_tokens;
  if (!finiteNumber(input) || !finiteNumber(output) || !finiteNumber(cacheRead)) {
    return null;
  }
  const nonCachedInput = Math.max(0, input - cacheRead);

  const modelContextWindow = latestTokenInfo?.model_context_window;
  const totalTokens = total.total_tokens;
  const harnessPercentage =
    finiteNumber(modelContextWindow) &&
    modelContextWindow > 0 &&
    finiteNumber(totalTokens)
      ? (totalTokens / modelContextWindow) * 100
      : null;

  // Always return the lift even when neither a harness percentage nor a static
  // window is available (unknown codex model). hook-core is the sole writer and
  // persists a null-window "unknown + fail-safe" metering record — matching the
  // Claude adapter, which likewise never suppresses the record on unresolved
  // windows. Suppressing here would leave unknown codex models with NO record.
  return {
    harness: "codex",
    model: latestModel,
    source_ref: transcriptPath,
    usage: {
      input: nonCachedInput,
      output,
      cache_creation: 0,
      cache_read: cacheRead,
    },
    harnessPercentage,
  };
}

export const codexAdapter: CodexAdapter = {
  isSubagent(payload: HookPayload, env: NodeJS.ProcessEnv): boolean {
    // subagent-mcp-spawned children inherit this guard and must not claim/nag.
    if (env.SUBAGENT_MCP_SUBAGENT === "1") {
      return true;
    }
    const source = (payload as { source?: unknown }).source;

    // 0.131+: source is an object whose keys name the subagent kind.
    if (source && typeof source === "object") {
      if (Object.prototype.hasOwnProperty.call(source, "subagent")) {
        return true;
      }
    }

    // Older: source is a string enum.
    if (typeof source === "string" && SUBAGENT_SOURCE_STRINGS.has(source)) {
      return true;
    }

    return isParentProcessMarkerFirstLine(payload.prompt);
  },

  // Count JSONL lines whose parsed object.type === 'turn_context'. Delegates to
  // the bounded counter (reads at most the trailing window so a huge/
  // attacker-supplied transcript can't stall the inline host turn). Unreadable
  // -> 0 (fail-safe: the claim baseline stamps at 0; cadence is counter-driven
  // and unaffected). Read on claim turns only.
  currentTurn(transcriptPath: string | undefined): number {
    return countJsonlType(transcriptPath, "turn_context");
  },

  liftUsage(
    _payload: HookPayload,
    _env: NodeJS.ProcessEnv,
    transcriptPath: string | undefined
  ): LiftedUsage | null {
    // Provider-specific lift ONLY. hook-core is the sole writer of the metering
    // record (matching the Claude adapter contract); the adapter must not also
    // self-write, or the same turn would persist the record twice.
    return liftCodexUsageFromRollout(transcriptPath);
  },

  anonScope: "codex",
  fullDirectiveFile: "orchestration-codex.md",
  shortOnFile: "short-on.md",
  shortOffFile: "short-off.md",
  carryoverDirectiveFile: "carryover-codex.md",
  reminderOnFile: "reminder-on.md",
  reminderOffFile: "reminder-off-codex.md",
};

/**
 * Codex dispatcher. SessionStart fires once before the first prompt; it covers
 * the turn-0 directive (UserPromptSubmit cadence then handles turns 1+).
 *
 * Because the marker now PERSISTS across sessions, SessionStart must classify
 * the claim like runHook does: an inherited marker owned by a prior/other
 * session is a CARRYOVER (emit the CARRYOVER notice prepended to FULL and
 * re-claim); a freshly-enabled marker is FRESH (emit FULL and claim). Either
 * way the marker is re-claimed/baselined so the following UserPromptSubmit turns
 * run SAME-SESSION cadence and the notice fires exactly once.
 *
 * Returns the string to inject, or '' for nothing. Fully fail-safe.
 */
export function runCodexHook(
  payload: HookPayload,
  env: NodeJS.ProcessEnv,
  adapter: ProviderAdapter = codexAdapter
): string {
  try {
    if (payload.hook_event_name === "SessionStart") {
      cullHookZombies();
      if (adapter.isSubagent(payload, env)) {
        return "";
      }
      const cwd = payload.cwd || process.cwd();
      const current = ownerKey(payload, cwd, adapter);
      marker.writeCurrentSession(cwd, current);
      // Gate on the SAME effective-active computation runHook uses (disable /
      // enable / latch / metering fail-safe), not the bare marker. SessionStart
      // is turn 0 (grace window), so no metering fail-safe applies yet; passing
      // false keeps a never-pre-enabled real session eligible for its turn-0
      // directive via the latch/enable paths just like the UserPromptSubmit
      // cadence would.
      if (!computeEffectiveActive(cwd, current, Date.now(), false)) {
        return "";
      }

      const turn = adapter.currentTurn(payload.transcript_path);
      const m = marker.readMarker(cwd);
      const kind = classifyOwnerClaim(m, current);

      // Claim/re-claim + emit via the SHARED claim path (one copy of the
      // semantics — FULL + ON reminder, ack-latched CARRYOVER prepend, counter
      // re-baseline). SessionStart claims even on SAME-SESSION (resume) so
      // turn 0 is always covered.
      return claimAndEmit(cwd, current, turn, m, kind, env, adapter);
    }
    // UserPromptSubmit (and any other event) -> normal cadence.
    return runHook(payload, env, adapter);
  } catch {
    return "";
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

async function main(): Promise<void> {
  let payload: HookPayload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) {
      payload = JSON.parse(raw) as HookPayload;
    }
  } catch {
    // Bad/empty stdin -> empty payload; degrades to '' safely.
  }
  let out = "";
  try {
    out = runCodexHook(payload, process.env, codexAdapter);
  } catch {
    out = "";
  }
  if (out) {
    process.stdout.write(out);
  }
  process.exit(0);
}

// Only run the shim when invoked directly, not when a test imports the adapter.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  void main();
}
