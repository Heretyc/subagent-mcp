import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  claimAndEmit,
  appendHookZombieReport,
  classifyClaim,
  countJsonlType,
  cullHookZombies,
  runHook,
  sessionKey,
  type HookPayload,
  type ProviderAdapter,
} from "../orchestration/hook-core.js";
import * as marker from "../orchestration/marker.js";

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

const PARENT_PROCESS_MARKER = "this is a request from a parent process";

export const codexAdapter: ProviderAdapter = {
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

    // Fallback: a parent-process handoff is detectable from the prompt's first
    // non-empty line (our own subagent contract starts with this sentinel).
    const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
    const head = prompt.slice(0, 200);
    for (const line of head.split("\n")) {
      const trimmed = line.trim().toLowerCase();
      if (!trimmed) continue;
      return trimmed.includes(PARENT_PROCESS_MARKER);
    }
    return false;
  },

  // Count JSONL lines whose parsed object.type === 'turn_context'. Delegates to
  // the bounded counter (reads at most the trailing window so a huge/
  // attacker-supplied transcript can't stall the inline host turn). Unreadable
  // -> 0 (fail-safe: the claim baseline stamps at 0; cadence is counter-driven
  // and unaffected). Read on claim turns only.
  currentTurn(transcriptPath: string | undefined): number {
    return countJsonlType(transcriptPath, "turn_context");
  },

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
      const zombieRecords = cullHookZombies();
      if (adapter.isSubagent(payload, env)) {
        return appendHookZombieReport("", zombieRecords);
      }
      const cwd = payload.cwd || process.cwd();
      if (!marker.isActive(cwd)) {
        return appendHookZombieReport("", zombieRecords);
      }

      const current = sessionKey(payload);
      const turn = adapter.currentTurn(payload.transcript_path);
      const m = marker.readMarker(cwd);
      const kind = classifyClaim(m.owner_session, m.baseline_turn, current);

      // Claim/re-claim + emit via the SHARED claim path (one copy of the
      // semantics — FULL + ON reminder, ack-latched CARRYOVER prepend, counter
      // re-baseline). SessionStart claims even on SAME-SESSION (resume) so
      // turn 0 is always covered.
      return appendHookZombieReport(
        claimAndEmit(cwd, current, turn, m, kind, env, adapter),
        zombieRecords
      );
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
