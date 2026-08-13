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
  countJsonlType,
  runHook,
  sessionKey,
  TRANSCRIPT_READ_CAP,
  type HookPayload,
  type ProviderAdapter,
} from "../orchestration/hook-core.js";
import type { MeteringHarness, MeteringUsage } from "../orchestration/metering.js";
import { readStatuslineRecord } from "../orchestration/statusline-state.js";
import { readClaudeLongContextHint } from "../orchestration/settings-hint.js";
import { hasParentMarker } from "../launch-prompt.js";

/**
 * Claude Code UserPromptSubmit hook entry. Reads the JSON payload from stdin,
 * runs the provider-agnostic core with the Claude adapter, and writes the
 * result to stdout. Always exits 0 — a hook must never fail the host turn.
 *
 * Compiles to dist/hooks/orchestration-claude.js and is invoked as:
 *   node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/orchestration-claude.js"
 */

// Claude entrypoints that are themselves SUBAGENTS and must NOT be nagged.
// Top-level entrypoints that SHOULD inject (cli, mcp, claude-vscode) are simply
// absent from this set. DECISION: claude-desktop is a non-hook host (it has no
// UserPromptSubmit hook), so whether it appears here never matters there; we do
// NOT add it, which resolves the prototype/INSTALL.md conflict over whether
// claude-desktop should be skipped.
const SUBAGENT_ENTRYPOINTS = new Set([
  "local-agent",
  "sdk-cli",
  "sdk-ts",
  "sdk-py",
]);

interface UsageLiftResult {
  harness: MeteringHarness;
  model: string;
  source_ref: string;
  usage: MeteringUsage;
  harnessPercentage: number | null;
  harnessContextWindow?: number | null;
  longContextHint?: boolean | null;
  // Optional provenance of the newest context compaction proven from the
  // transcript tail. 'claude:<uuid>' for a proven auto boundary; null when the
  // newest boundary is manual or lacks a valid proof; key omitted when the
  // bounded tail shows no compaction boundary at all.
  compaction_generation?: string | null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Canonical 8-4-4-4-12 hex UUID. A compact_boundary's top-level uuid is the
// only accepted proof of an auto generation; anything else is treated as
// missing/invalid (-> null), never inferred from surrounding text.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function recordField(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

/**
 * Resolve the newest context-compaction generation from the already-read
 * transcript tail lines. Scans newest-first for the newest EXACT record with
 * type==='system' and subtype==='compact_boundary'; that newest boundary alone
 * decides the outcome:
 *   - compactMetadata.trigger==='auto' + a valid top-level uuid -> 'claude:'+uuid
 *   - trigger==='manual', or a missing/invalid uuid proof        -> null
 * Returns undefined when the bounded tail contains no compaction boundary (the
 * caller then omits the optional field entirely). Never infers the generation
 * from prompt/source/event strings.
 */
function resolveClaudeCompactionGeneration(
  lines: string[],
): string | null | undefined {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Skip malformed transcript lines and keep scanning older records.
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;
    // Sidechain (subagent) records must never prove the parent's compaction
    // generation, mirroring the isSidechain guard in the usage scan.
    if (record.isSidechain === true) continue;
    if (record.type !== "system" || record.subtype !== "compact_boundary") {
      continue;
    }
    // Newest boundary wins: decide from THIS record and stop scanning.
    const trigger = recordField(record.compactMetadata, "trigger");
    if (trigger === "auto" && isValidUuid(record.uuid)) {
      return `claude:${record.uuid}`;
    }
    return null;
  }
  return undefined;
}

function isRealClaudeModel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.trim() !== "<synthetic>"
  );
}

function readTranscriptTail(transcriptPath: string | undefined): string | null {
  if (!transcriptPath) return null;
  let fd: number | undefined;
  try {
    const size = statSync(transcriptPath).size;
    if (size <= TRANSCRIPT_READ_CAP) {
      return readFileSync(transcriptPath, "utf8");
    }

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
    const raw = buf.toString("utf8", 0, offset);
    const firstNewline = raw.indexOf("\n");
    return firstNewline === -1 ? "" : raw.slice(firstNewline + 1);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close failures. The hook must never fail the host turn.
      }
    }
  }
}

function liftClaudeUsageFromTranscript(transcriptPath: string | undefined): UsageLiftResult | null {
  const raw = readTranscriptTail(transcriptPath);
  if (raw === null || !transcriptPath) return null;
  const lines = raw.split("\n");

  // Resolve compaction provenance independently of the usage scan so neither
  // early-terminates the other; both draw from the same bounded tail lines.
  const compactionGeneration = resolveClaudeCompactionGeneration(lines);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed) as {
        type?: unknown;
        isSidechain?: unknown;
        message?: {
          model?: unknown;
          usage?: {
            input_tokens?: unknown;
            output_tokens?: unknown;
            cache_creation_input_tokens?: unknown;
            cache_read_input_tokens?: unknown;
          };
        };
      };
      if (msg.isSidechain === true) continue;
      if (msg.type !== "assistant" || !msg.message?.usage) continue;
      if (!isRealClaudeModel(msg.message.model)) continue;
      const usage = msg.message.usage;
      return {
        harness: "claude",
        model: msg.message.model.trim(),
        source_ref: transcriptPath,
        usage: {
          input: finiteNumber(usage.input_tokens) ? usage.input_tokens : 0,
          output: finiteNumber(usage.output_tokens) ? usage.output_tokens : 0,
          cache_creation: finiteNumber(usage.cache_creation_input_tokens)
            ? usage.cache_creation_input_tokens
            : 0,
          cache_read: finiteNumber(usage.cache_read_input_tokens)
            ? usage.cache_read_input_tokens
            : 0,
        },
        harnessPercentage: null,
        ...(compactionGeneration !== undefined
          ? { compaction_generation: compactionGeneration }
          : {}),
      };
    } catch {
      // Skip malformed transcript lines and keep scanning older completed turns.
    }
  }

  return null;
}

export const claudeAdapter: ProviderAdapter & {
  liftUsage(
    payload: HookPayload,
    env: NodeJS.ProcessEnv,
    transcriptPath: string | undefined,
  ): UsageLiftResult | null;
} = {
  isSubagent(payload: HookPayload, env: NodeJS.ProcessEnv): boolean {
    // subagent-mcp-spawned children inherit this guard and must not claim/nag.
    if (env.SUBAGENT_MCP_SUBAGENT === "1") {
      return true;
    }
    if (payload.agent_id) {
      return true;
    }
    const entrypoint = env.CLAUDE_CODE_ENTRYPOINT;
    if (typeof entrypoint === "string" && SUBAGENT_ENTRYPOINTS.has(entrypoint)) {
      return true;
    }
    return hasParentMarker(payload.prompt);
  },

  // Count JSONL lines in the transcript whose parsed object.type === 'user'.
  // Delegates to the bounded counter (reads at most the trailing window so a
  // huge/attacker-supplied transcript can't stall the inline host turn).
  // Unreadable/missing transcript -> 0 (fail-safe: the claim baseline stamps
  // at 0; cadence is counter-driven and unaffected). Read on claim turns only.
  currentTurn(transcriptPath: string | undefined): number {
    return countJsonlType(transcriptPath, "user");
  },

  liftUsage(
    payload: HookPayload,
    env: NodeJS.ProcessEnv,
    transcriptPath: string | undefined,
  ): UsageLiftResult | null {
    const lifted = liftClaudeUsageFromTranscript(transcriptPath);
    if (lifted === null) return null;
    const statusline = readStatuslineRecord(
      sessionKey(payload),
      typeof payload.cwd === "string" ? payload.cwd : undefined,
    );
    return {
      ...lifted,
      harnessPercentage:
        typeof statusline?.used_percentage === "number" &&
        Number.isFinite(statusline.used_percentage)
          ? statusline.used_percentage
          : null,
      harnessContextWindow:
        typeof statusline?.context_window_size === "number" &&
        Number.isFinite(statusline.context_window_size) &&
        statusline.context_window_size > 0
          ? statusline.context_window_size
          : null,
      longContextHint: readClaudeLongContextHint(payload.cwd, env),
    };
  },

  anonScope: "claude",
  fullDirectiveFile: "orchestration-claude.md",
  shortOnFile: "short-on.md",
  shortOffFile: "short-off.md",
  carryoverDirectiveFile: "carryover-claude.md",
  reminderOnFile: "reminder-on.md",
  reminderOffFile: "reminder-off-claude.md",
};

export function runClaudeHook(
  payload: HookPayload,
  env: NodeJS.ProcessEnv,
  adapter: ProviderAdapter = claudeAdapter
): string {
  try {
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
    // Bad/empty stdin -> empty payload; runHook degrades to '' safely.
  }
  let out = "";
  try {
    out = runClaudeHook(payload, process.env, claudeAdapter);
  } catch {
    out = "";
  }
  if (out) {
    process.stdout.write(out);
  }
  process.exit(0);
}

// Only run the stdin->stdout shim when invoked directly as the hook command,
// NOT when a test imports `claudeAdapter`. Importing must have no side effects.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  void main();
}
