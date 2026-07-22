/**
 * advanced-ruleset.py execution gate — the user-editable python override hook
 * with final authority over launch_agent model routing.
 *
 * Side-effect-free at import time (like routing.ts: no spawning, no transport,
 * no FS reads at module scope) so unit tests can import dist/ruleset.js
 * directly. index.ts instantiates ONE createRulesetGate() singleton next to
 * deadlockWindow; the gate's latch is per-process, exactly the deadlock-window
 * scoping: env-check SUCCESS latches enabled/disabled for the process lifetime,
 * FAILURE never latches (re-run on the next launch_agent so an admin fix
 * recovers without a restart).
 *
 * Contract: docs/spec/advanced-ruleset/.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Provider } from "./effort.js";
import { type Candidate, LAUNCH_MODELS, LAUNCH_EFFORTS, HAIKU_EFFORT } from "./routing.js";
import { RULESET_SCAFFOLD } from "./ruleset-scaffold.js";

/** Hardcoded per-execution timeout (2 minutes per the owner spec). Tests assert the value. */
export const RULESET_TIMEOUT_MS = 120_000;

/**
 * Verbatim hard-fail message for ANY ruleset failure (missing interpreter,
 * non-zero exit, invalid/non-serializable JSON, timeout). NO AUTO_HINT is ever
 * appended — a deliberate, documented exception to the every-error-gets-hints
 * convention (resolution-matrix.md): the admin must intervene, not the model.
 */
export const RULESET_HARD_FAIL_MSG =
  "subagent ruleset erroring. Please ask the system administrator to debug before continuing. It is highly discouraged to continue use of this chat session as the system is now operating outside safe parameters.";

export const SCAFFOLD_FILENAME = "advanced-ruleset.py";

/** Candidate triple as serialized onto the script's stdin (rank is dense positional 1..N). */
export interface RulesetCandidate {
  provider: string;
  model: string;
  effort: string;
  rank: number;
}

/**
 * Launch context for the script. Deliberately EXCLUDES branch/tier/deadlock
 * state (deadlock status is NOT exposed to the script — owner spec). The
 * caller's own overrides leak nothing: the caller supplied them. Keys are
 * always present (null when absent) for a deterministic shape.
 */
export interface RulesetContext {
  task_category: string;
  cwd: string;
  selection_mode: "auto" | "provider" | "provider_model" | "explicit";
  provider: string | null;
  model: string | null;
  effort: string | null;
}

export interface RulesetStdinPayload {
  candidates: RulesetCandidate[];
  context: RulesetContext;
}

export type RulesetGateState = "unknown" | "disabled" | "enabled";

/** Resolve dist/advanced-ruleset.py relative to this module — the routing-table.json sibling dir. */
export function defaultScaffoldPath(): string {
  return fileURLToPath(new URL("./advanced-ruleset.py", import.meta.url));
}

/**
 * Recreate the scaffold when absent (runtime recovery for a deleted file). An
 * existing file is NEVER touched — user edits are sacred. Throws on write
 * failure; the gate methods catch any throw in the ruleset pipeline and map it
 * to the hard-fail result.
 */
export function ensureScaffold(path: string = defaultScaffoldPath()): void {
  if (existsSync(path)) return;
  writeFileSync(path, RULESET_SCAFFOLD);
}

/**
 * Interpreter auto-detect order. SUBAGENT_RULESET_PYTHON (non-empty) is
 * EXCLUSIVE — no fallback past it: a wrong override must surface as the hard
 * fail, never be masked by PATH luck. Otherwise: py launcher (win32 only),
 * python3, python.
 */
export function interpreterCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const override = env.SUBAGENT_RULESET_PYTHON;
  if (override) return [override];
  return platform === "win32" ? ["py", "python3", "python"] : ["python3", "python"];
}

/**
 * Outcome of one script execution.
 * - "no-spawn": the interpreter itself failed to start (sync spawn throw or
 *   async ENOENT/EACCES 'error' before 'spawn') — the auto-detect walk advances
 *   to the next interpreter.
 * - "failed": the interpreter spawned but the execution failed (non-zero exit,
 *   timeout, empty stdout) — a ruleset failure, NEVER a cue to try the next
 *   interpreter (a broken default python must surface, not be masked).
 */
export type ExecOutcome =
  | { kind: "ok"; stdout: string }
  | { kind: "failed"; detail: string }
  | { kind: "no-spawn"; detail: string };

export type ExecFn = (
  interpreter: string,
  scriptPath: string,
  argvExtra: string[],
  stdinText: string | null,
  timeoutMs: number
) => Promise<ExecOutcome>;

/**
 * Run the script once. Mode discriminator is argv: no extra args = env check;
 * ["route"] = routing mode (payload written to stdin, then end). OS env vars
 * reach the script natively via process.env. Spawn failures are ASYNC
 * (ENOENT/EACCES emit 'error' after spawn() returns) — same one-shot
 * spawn-vs-error race discipline as the launch path in index.ts. The timeout
 * kills the child (SIGKILL fallback after 2s on POSIX) and settles the promise
 * immediately. stderr is collected for server-side logging only; the MCP
 * caller only ever sees the verbatim hard-fail message.
 */
function execRuleset(
  interpreter: string,
  scriptPath: string,
  argvExtra: string[],
  stdinText: string | null,
  timeoutMs: number
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(interpreter, [scriptPath, ...argvExtra], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: process.env,
      });
    } catch (e) {
      resolve({ kind: "no-spawn", detail: e instanceof Error ? e.message : String(e) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let spawned = false;

    const finish = (outcome: ExecOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      if (process.platform !== "win32") {
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
        }, 2000).unref();
      }
      finish({ kind: "failed", detail: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.once("spawn", () => {
      spawned = true;
    });
    child.once("error", (err) => {
      // Pre-spawn error = interpreter not runnable (walk advances). A late
      // error is folded into the close-path outcome instead.
      if (!spawned) {
        finish({ kind: "no-spawn", detail: err instanceof Error ? err.message : String(err) });
      }
    });

    if (child.stdin) {
      // EPIPE if the script exits without reading stdin — never crash on it.
      child.stdin.on("error", () => {});
      if (stdinText !== null) child.stdin.write(stdinText);
      child.stdin.end();
    }

    child.on("close", (code) => {
      if (code !== 0) {
        finish({
          kind: "failed",
          detail: `exit code ${code}${stderr.trim() ? `; stderr: ${stderr.trim()}` : ""}`,
        });
        return;
      }
      if (stdout.trim() === "") {
        finish({ kind: "failed", detail: "empty stdout" });
        return;
      }
      finish({ kind: "ok", stdout });
    });
  });
}

/** Env-check stdout shape: {"ready": bool, "load-rules": bool} (hyphenated key), extra keys ignored. */
function parseEnvCheck(stdout: string): { ready: boolean; loadRules: boolean } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const ready = (parsed as Record<string, unknown>)["ready"];
  const loadRules = (parsed as Record<string, unknown>)["load-rules"];
  if (typeof ready !== "boolean" || typeof loadRules !== "boolean") return null;
  return { ready, loadRules };
}

// Per-model effort legality, derived from the exported launch enums. Own
// membership checks on purpose: resolveEffort (effort.ts) has a lenient default
// that silently coerces unknown efforts to "high", so buildCommand throwing can
// NOT be relied on to reject bad ruleset output.
const SONNET_EFFORTS: readonly string[] = LAUNCH_EFFORTS.filter((e) => e !== "ultracode");
const CODEX_EFFORTS: readonly string[] = LAUNCH_EFFORTS.filter(
  (e) => e !== "ultracode" && e !== "max"
);

function effortAllowed(model: string, effort: string): boolean {
  if (model === "haiku") return effort === HAIKU_EFFORT;
  if (model === "sonnet" || model === "fable") return SONNET_EFFORTS.includes(effort);
  if (model === "opus" || model === "opus-4-8") {
    return (LAUNCH_EFFORTS as readonly string[]).includes(effort);
  }
  // Codex launch models.
  return CODEX_EFFORTS.includes(effort);
}

/**
 * Strict validation of routing-mode stdout: a bare JSON array of candidate
 * objects, validated against the STATIC launch enums (not raw table rows — the
 * returned list is consumed verbatim by the attempt loop, so every entry must
 * be launchable; explicit mode has no table at all).
 *
 * Per element: string provider/model/effort; provider ∈ {claude, codex};
 * model ∈ launch enum; provider↔model legality (claude↔{haiku,sonnet,opus,
 * opus-4-8,fable}, codex↔{gpt-5.5,gpt-5.6}); per-model effort legality incl. haiku→"none".
 * API candidates must match the input list (including multiplicity), because
 * only input API candidates have attached providers.jsonc dispatch metadata.
 * Extra keys (incl. rank) are ignored on output; duplicates are allowed (the
 * attempt loop just tries them in order). An EMPTY array is VALID — it is the
 * limit case of the allowed filter operation and means "veto the launch"
 * (index.ts owns the veto error). The error string here is for server-side
 * stderr logging only.
 */
export function validateRulesetOutput(
  raw: unknown,
  inputCandidates: readonly RulesetCandidate[] = []
): { ok: true; candidates: Candidate[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "output must be a bare JSON array of candidate objects" };
  }

  const candidates: Candidate[] = [];
  const apiCandidates = new Map<string, number>();
  for (const candidate of inputCandidates) {
    if (candidate.provider !== "api") continue;
    const key = `${candidate.model}\0${candidate.effort}`;
    apiCandidates.set(key, (apiCandidates.get(key) ?? 0) + 1);
  }
  for (let i = 0; i < raw.length; i++) {
    const el = raw[i];
    if (!el || typeof el !== "object" || Array.isArray(el)) {
      return { ok: false, error: `candidate ${i}: not an object` };
    }
    const entry = el as Record<string, unknown>;
    const provider = entry.provider;
    const model = entry.model;
    const effort = entry.effort;
    if (typeof provider !== "string" || typeof model !== "string" || typeof effort !== "string") {
      return { ok: false, error: `candidate ${i}: provider, model, and effort must be strings` };
    }
    if (provider !== "claude" && provider !== "codex" && provider !== "api") {
      return { ok: false, error: `candidate ${i}: unknown provider ${provider}` };
    }
    if (provider === "api") {
      if (model.length === 0) {
        return { ok: false, error: `candidate ${i}: api model must be non-empty` };
      }
      if (effort !== "medium") {
        return { ok: false, error: `candidate ${i}: api effort must be medium` };
      }
      const key = `${model}\0${effort}`;
      const remaining = apiCandidates.get(key) ?? 0;
      if (remaining === 0) {
        return { ok: false, error: `candidate ${i}: api candidate was not present in ruleset input` };
      }
      apiCandidates.set(key, remaining - 1);
      candidates.push({ provider: "api", model, effort });
      continue;
    }
    if (!(LAUNCH_MODELS as readonly string[]).includes(model)) {
      return { ok: false, error: `candidate ${i}: unknown model ${model}` };
    }
    if (provider === "claude" && ["gpt-5.5", "gpt-5.6"].includes(model)) {
      return { ok: false, error: `candidate ${i}: claude does not support ${model}` };
    }
    if (provider === "codex" && !["gpt-5.5", "gpt-5.6"].includes(model)) {
      return { ok: false, error: `candidate ${i}: codex only supports gpt-5.5 or gpt-5.6, got ${model}` };
    }
    if (!effortAllowed(model, effort)) {
      return { ok: false, error: `candidate ${i}: effort ${effort} is not valid for ${provider}/${model}` };
    }
    candidates.push({ provider: provider as Provider, model, effort });
  }
  return { ok: true, candidates };
}

export interface RulesetGate {
  /**
   * Env-check gate (no-arg mode), run lazily at the first launch_agent call.
   * SUCCESS latches for the process lifetime: {ready:true, load-rules:false}
   * silently disables the ruleset (active:false), load-rules:true enables it
   * (active:true). FAILURE of any kind returns {ok:false} and NEVER latches —
   * the next launch_agent re-runs the check.
   */
  ensureReady(): Promise<{ ok: true; active: boolean } | { ok: false }>;
  /**
   * Routing mode — only call when ensureReady reported active:true. Runs ONCE
   * per launch_agent call (never re-run per failover attempt). Failure returns
   * {ok:false} and leaves the gate enabled (re-run next launch).
   */
  applyRules(payload: RulesetStdinPayload): Promise<{ ok: true; candidates: Candidate[] } | { ok: false }>;
}

/**
 * Per-process gate factory (deadlock.ts pattern: closure state, instantiated
 * once at module scope in index.ts). The opts are injection seams for tests
 * only; production uses the defaults.
 */
export function createRulesetGate(
  opts: {
    scriptPath?: string;
    env?: NodeJS.ProcessEnv;
    platform?: string;
    timeoutMs?: number;
    exec?: ExecFn;
  } = {}
): RulesetGate {
  const scriptPath = opts.scriptPath ?? defaultScaffoldPath();
  const env = opts.env ?? process.env;
  const platform = (opts.platform ?? process.platform) as NodeJS.Platform;
  const timeoutMs = opts.timeoutMs ?? RULESET_TIMEOUT_MS;
  const exec = opts.exec ?? execRuleset;

  let state: RulesetGateState = "unknown";
  // Remembered ONLY when the env-check latches success, so a failed walk is
  // repeated in full on the next launch (admin may fix PATH without a restart).
  let interpreter: string | null = null;

  async function ensureReady(): Promise<{ ok: true; active: boolean } | { ok: false }> {
    if (state !== "unknown") {
      return { ok: true, active: state === "enabled" };
    }

    try {
      ensureScaffold(scriptPath);
    } catch (e) {
      console.error(
        `[ruleset] scaffold recreate failed: ${e instanceof Error ? e.message : String(e)}`
      );
      return { ok: false };
    }

    const walk = interpreterCandidates(env, platform);
    for (const candidate of walk) {
      const outcome = await exec(candidate, scriptPath, [], null, timeoutMs);
      if (outcome.kind === "no-spawn") {
        continue; // interpreter not present/runnable — walk advances.
      }
      // First candidate that spawned IS the interpreter for this execution;
      // its script-level failure is a ruleset failure, not a cue to walk on.
      if (outcome.kind === "failed") {
        console.error(`[ruleset] env-check failed (${candidate}): ${outcome.detail}`);
        return { ok: false };
      }
      const parsed = parseEnvCheck(outcome.stdout);
      if (parsed === null) {
        console.error(`[ruleset] env-check output is not {"ready":bool,"load-rules":bool} (${candidate})`);
        return { ok: false };
      }
      if (!parsed.ready) {
        console.error(`[ruleset] env-check reported ready:false (${candidate})`);
        return { ok: false };
      }
      interpreter = candidate;
      state = parsed.loadRules ? "enabled" : "disabled";
      return { ok: true, active: state === "enabled" };
    }

    console.error(`[ruleset] no python interpreter found (tried: ${walk.join(", ")})`);
    return { ok: false };
  }

  async function applyRules(
    payload: RulesetStdinPayload
  ): Promise<{ ok: true; candidates: Candidate[] } | { ok: false }> {
    try {
      ensureScaffold(scriptPath);
    } catch (e) {
      console.error(
        `[ruleset] scaffold recreate failed: ${e instanceof Error ? e.message : String(e)}`
      );
      return { ok: false };
    }

    if (interpreter === null) {
      // Defensive: applyRules is only reachable after ensureReady latched "enabled".
      console.error("[ruleset] applyRules called before a successful env-check");
      return { ok: false };
    }

    const outcome = await exec(interpreter, scriptPath, ["route"], JSON.stringify(payload), timeoutMs);
    if (outcome.kind !== "ok") {
      console.error(`[ruleset] routing mode failed: ${outcome.detail}`);
      return { ok: false };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outcome.stdout);
    } catch {
      console.error("[ruleset] routing mode stdout is not valid JSON");
      return { ok: false };
    }

    const validated = validateRulesetOutput(parsed, payload.candidates);
    if (!validated.ok) {
      console.error(`[ruleset] invalid routing output: ${validated.error}`);
      return { ok: false };
    }
    return { ok: true, candidates: validated.candidates };
  }

  return { ensureReady, applyRules };
}
