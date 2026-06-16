import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cwdHash, stateDir } from "./marker.js";

/**
 * Per-project model-selection mode — the SINGLE source of truth for whether a
 * working directory is in "smart" mode (the default; provider/model/effort
 * selectors are rejected and the best model is chosen automatically) or
 * "user-approved-overrides" mode (the user has explicitly authorized manual
 * selectors for a bounded window).
 *
 * State is a per-project file in the SAME shared state dir as the marker,
 * keyed by the SAME cwdHash so path-keying style stays uniform. The
 * user-approved-overrides grant is time-boxed: WINDOW_MS after enable, the
 * next resolveMode() lazily reverts the project to smart mode.
 *
 * FAIL-SAFE: filesystem reads return safe defaults ("smart") on any failure;
 * writes mirror marker.ts perms (0o700 dir / 0o600 file).
 */

const WINDOW_MS = 30 * 60 * 1000;

type ModelModeState = {
  mode: "smart" | "user-approved-overrides";
  enabled_at: number | null;
};

export function modelModePath(cwd: string): string {
  return join(stateDir, `model-${cwdHash(cwd)}.json`);
}

function readModelMode(cwd: string): ModelModeState {
  try {
    const raw = readFileSync(modelModePath(cwd), "utf8");
    const parsed = JSON.parse(raw) as Partial<ModelModeState>;
    const mode =
      parsed.mode === "user-approved-overrides" ? "user-approved-overrides" : "smart";
    const enabled_at =
      typeof parsed.enabled_at === "number" ? parsed.enabled_at : null;
    return { mode, enabled_at };
  } catch {
    // Missing/corrupt/invalid -> safe default (smart, never enabled).
    return { mode: "smart", enabled_at: null };
  }
}

function writeModelMode(cwd: string, state: ModelModeState): void {
  try {
    // Owner-only perms (mirror marker.ts): the file persists an enable-time.
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(modelModePath(cwd), JSON.stringify(state), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Fail-safe: never throw to the caller.
  }
}

export function resolveMode(
  cwd: string,
  now: number = Date.now(),
): {
  mode: "smart" | "user-approved-overrides";
  enabled_at: number | null;
  window_remaining_ms: number;
  reverted: boolean;
} {
  const state = readModelMode(cwd);
  if (
    state.mode === "user-approved-overrides" &&
    typeof state.enabled_at === "number" &&
    now - state.enabled_at > WINDOW_MS
  ) {
    // Lazy revert side-effect: the grant has expired, persist smart mode.
    writeModelMode(cwd, { mode: "smart", enabled_at: null });
    return {
      mode: "smart",
      enabled_at: null,
      window_remaining_ms: 0,
      reverted: true,
    };
  }
  if (state.mode === "user-approved-overrides") {
    return {
      mode: "user-approved-overrides",
      enabled_at: state.enabled_at,
      window_remaining_ms: Math.max(
        0,
        WINDOW_MS - (now - (state.enabled_at as number)),
      ),
      reverted: false,
    };
  }
  return {
    mode: "smart",
    enabled_at: state.enabled_at,
    window_remaining_ms: 0,
    reverted: false,
  };
}

export function setMode(
  cwd: string,
  mode: "smart" | "user-approved-overrides",
  now: number = Date.now(),
): {
  mode: "smart" | "user-approved-overrides";
  enabled_at: number | null;
  window_remaining_ms: number;
  reverted: boolean;
} {
  if (mode === "smart") {
    writeModelMode(cwd, { mode: "smart", enabled_at: null });
  } else {
    const cur = resolveMode(cwd, now);
    if (cur.mode === "user-approved-overrides") {
      // Re-enabling an already-active window must NOT refresh/extend it: the
      // original enable-timestamp stands.
    } else {
      writeModelMode(cwd, { mode: "user-approved-overrides", enabled_at: now });
    }
  }
  return resolveMode(cwd, now);
}

export function gateLaunch(
  cwd: string,
  selectors: { provider?: unknown; model?: unknown; effort?: unknown },
  now: number = Date.now(),
): {
  allowed: boolean;
  mode: "smart" | "user-approved-overrides";
  message?: string;
  reverted: boolean;
} {
  const r = resolveMode(cwd, now);
  const supplied = !!(selectors.provider || selectors.model || selectors.effort);
  if (r.mode === "user-approved-overrides") {
    return { allowed: true, mode: r.mode, reverted: r.reverted };
  }
  if (supplied) {
    return {
      allowed: false,
      mode: "smart",
      message: SELECTOR_REJECTION_MESSAGE,
      reverted: r.reverted,
    };
  }
  return { allowed: true, mode: "smart", reverted: r.reverted };
}

export const SELECTOR_REJECTION_MESSAGE: string = [
  "Model/provider/effort selection is DISABLED in smart mode (the default). " +
    "The best model is ALREADY being selected for you from the latest " +
    "benchmarking data, rigorous ongoing research, and numerous environment " +
    "conditions you may not be aware of — relaunch WITHOUT provider/model/effort.",
  "",
  "If you have a specific, scoped need for a particular provider/model/effort, " +
    "you must ALWAYS stop and ask the USER for authorization using the " +
    "structured-question tool (AskUserQuestion on Claude / request-user-input on " +
    "Codex; if no structured-question tool exists, a plain yes/no question), THEN " +
    'call `model-selection-mode` with mode "user-approved-overrides" before retrying.',
  "",
  "Fallback ladder (a): if you are blocked here because the structured-question " +
    "tool ITSELF is unavailable/failing (a provider issue), do NOT guess — keep " +
    "working until you actually need the answer, then RETURN to your caller with " +
    "the question plus the possible multiple-choice answers; the calling/" +
    "orchestrator agent asks the user in the orchestration context and relaunches " +
    "you with the answer.",
  "",
  "Fallback ladder (b): if you are blocked due to a REAL error (not a deliberate " +
    "smart-mode policy block), the user needs to know — surface it and consult the " +
    "user before continuing.",
].join("\n");
