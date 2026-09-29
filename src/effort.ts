import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export type Provider = "claude" | "codex" | "api";

/**
 * Codex models that carry a `max` effort tier. Verified 2026-09-29 against the
 * actual account model catalogue (codex-cli 0.158.0 `model/list`,
 * sanitized-model-list.json): the gpt-6 family (astra/sol/luna) AND the pinned
 * gpt-5.6 trio (gpt-5.6-sol / gpt-5.6-terra / gpt-5.6-luna) all list `max` in
 * their supportedReasoningEfforts. gpt-5.5 tops out at `xhigh`, so it is absent.
 * The generic `gpt-5.6` alias is included too: mapModel pins it to gpt-5.6-sol
 * (an EXPLICIT pin — see mapModel below — not a guess), and the driver sends
 * that resolved canonical id, so `gpt-5.6@max` runs end-to-end as the supported
 * `gpt-5.6-sol@max`. The alias therefore INHERITS its pinned target's verified
 * max tier, mirroring the Claude generic-alias convention (generic `opus` ->
 * claude-opus-5-5 carries its target's full ladder). (`ultra`, present in the
 * catalogue for some models, is NOT adopted — see LAUNCH_EFFORTS.) Single source
 * of truth for this membership rule, shared by resolveEffort here and routing.ts
 * (normalizeEffort/validatePresence) and ruleset.ts (effortAllowed).
 */
export const CODEX_MAX_MODELS: ReadonlySet<string> = new Set([
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.6",
]);

/**
 * Per-model selectable effort ladders for the `claude` provider. SINGLE SOURCE
 * OF TRUTH shared by resolveEffort (below), routing.ts (normalizeEffort /
 * validatePresence) and ruleset.ts (effortAllowed), so every gate rejects the
 * same unsupported (model, effort) pairs.
 *
 * Verified 2026-09-29 against three independent sources that agree exactly:
 *   1. installed @anthropic-ai/claude-agent-sdk sdk.d.ts EffortLevel doc-comment
 *      ("xhigh — Deeper than high (Fable 5, Opus 4.7+, Sonnet 5; falls back to
 *      'high' elsewhere)"),
 *   2. the claude-api skill Thinking & Effort table (Opus 4.6 / Sonnet 4.6 =
 *      low/medium/high/max, "xhigh arrived with Opus 4.7"; Opus 4.5 =
 *      low/medium/high only; Sonnet 4.5 / Haiku 4.5 = effort errors),
 *   3. the vendor effort doc supportedModels/xhigh/max lists.
 *
 * `low` is repo-banned upstream (never appears here). `ultracode` is Opus-4.8-
 * only CLI settings injection, handled separately (not an --effort tier). A
 * requested tier ABSENT from a model's ladder is REJECTED loudly — NEVER
 * silently remapped to a neighbouring tier (the pre-fix Sonnet 4.6 @ xhigh bug
 * emitted `--effort xhigh`, which the CLI silently downgraded to `high`, below
 * Sonnet 4.6's supported `max`).
 */
export const CLAUDE_EFFORT_LADDERS: Readonly<Record<string, ReadonlySet<string>>> = {
  // Generic aliases + current-GA snapshots with the full xhigh+max ladder.
  opus: new Set(["medium", "high", "xhigh", "max"]), // -> claude-opus-5-5
  "opus-5-5": new Set(["medium", "high", "xhigh", "max"]),
  "opus-5": new Set(["medium", "high", "xhigh", "max"]),
  "opus-4-8": new Set(["medium", "high", "xhigh", "max"]), // + ultracode (handled separately)
  "opus-4-7": new Set(["medium", "high", "xhigh", "max"]),
  "opus-4-6": new Set(["medium", "high", "max"]), // NO xhigh (arrived with Opus 4.7)
  "opus-4-5": new Set(["medium", "high"]), // extended-thinking pin: no xhigh, no max
  sonnet: new Set(["medium", "high", "xhigh", "max"]), // -> claude-sonnet-5-5
  "sonnet-5-5": new Set(["medium", "high", "xhigh", "max"]),
  "sonnet-5": new Set(["medium", "high", "xhigh", "max"]),
  "sonnet-4-6": new Set(["medium", "high", "max"]), // NO xhigh (silent-downgrade fix)
  fable: new Set(["medium", "high", "xhigh", "max"]), // -> claude-fable-5-1
  "fable-5-1": new Set(["medium", "high", "xhigh", "max"]),
  "fable-5": new Set(["medium", "high", "xhigh", "max"]),
};

/**
 * Claude models that take NO `--effort` flag at all: absent from the vendor
 * effort supportedModels list, they use extended-thinking budget_tokens instead
 * (Haiku 4.5, Sonnet 4.5). buildCommand emits only `--model` for these, and the
 * resolver reports the HAIKU_EFFORT sentinel — passing an effort value is not an
 * error (mirrors Haiku), it is simply ignored.
 */
export const CLAUDE_NO_EFFORT_MODELS: ReadonlySet<string> = new Set([
  "haiku",
  "sonnet-4-5",
]);

export function mapModel(provider: Provider, model: string): string {
  if (provider === "claude") {
    // Generic `opus`/`sonnet`/`fable` track the latest verified GA model;
    // explicit version aliases are pinned to their exact CLI model IDs. The
    // dated Opus 4.5 / Sonnet 4.5 snapshots stay pinned to their exact dated
    // CLI ids (verified via the claude-api models reference, both Active GA).
    if (model === "opus" || model === "opus-5-5") return "claude-opus-5-5";
    if (model === "opus-5") return "claude-opus-5";
    if (model === "opus-4-8") return "claude-opus-4-8";
    if (model === "opus-4-7") return "claude-opus-4-7";
    if (model === "opus-4-6") return "claude-opus-4-6";
    if (model === "opus-4-5") return "claude-opus-4-5-20251101";
    if (model === "sonnet" || model === "sonnet-5-5") return "claude-sonnet-5-5";
    if (model === "sonnet-5") return "claude-sonnet-5";
    if (model === "sonnet-4-6") return "claude-sonnet-4-6";
    if (model === "sonnet-4-5") return "claude-sonnet-4-5-20250929";
    if (model === "haiku") return "claude-haiku-4-5";
    if (model === "fable" || model === "fable-5-1") return "claude-fable-5-1";
    if (model === "fable-5") return "claude-fable-5";
    return model;
  }
  if (provider === "codex") {
    if (model === "gpt-5.6") return "gpt-5.6-sol";
    return model;
  }
  throw new Error("api provider dispatch not implemented");
}

export function resolveEffort(
  provider: Provider,
  model: string,
  effort: string
): { kind: "flag"; value: string } | { kind: "settings" } | { kind: "none" } {
  // ultracode is CLI-only settings-file injection, verified solely on Opus 4.8.
  // Other GA models (including generic `opus`, which resolves to Opus 5.5) are
  // not enabled for ultracode without independent CLI verification.
  const isOpus48 = provider === "claude" && model === "opus-4-8";

  if (effort === "low") {
    throw new Error(
      `low effort is not supported. Valid efforts: medium, high, xhigh, max, ultracode.`
    );
  }

  if (effort === "ultracode") {
    if (!isOpus48) {
      throw new Error(
        `ultracode effort is only available on Opus 4.8 (got ${provider}/${model}). Use xhigh for other models.`
      );
    }
    return { kind: "settings" };
  }

  if (provider === "claude" && CLAUDE_NO_EFFORT_MODELS.has(model)) {
    // Haiku 4.5 / Sonnet 4.5 have no --effort flag; the value is ignored.
    return { kind: "none" };
  }

  if (provider === "claude") {
    const ladder = CLAUDE_EFFORT_LADDERS[model];
    if (ladder) {
      if (ladder.has(effort)) {
        return { kind: "flag", value: effort };
      }
      // Effort present but not in THIS model's ladder: reject loudly with the
      // exact supported tiers — never silently downgrade to a neighbour.
      const supported = [...ladder].join(", ") + (model === "opus-4-8" ? ", ultracode" : "");
      throw new Error(
        `${effort} effort is not supported by claude/${model}. Supported: ${supported}. No silent downgrade.`
      );
    }
    // Unknown claude model — fall through to the generic loud throw below.
  }

  if (provider === "codex") {
    const supportsMax = CODEX_MAX_MODELS.has(model);
    if (effort === "max" && !supportsMax) {
      throw new Error(
        `max effort is not valid for ${model} (Codex). Valid: medium, high, xhigh.`
      );
    }
    if (["medium", "high", "xhigh", "max"].includes(effort)) {
      return { kind: "flag", value: effort };
    }
  }

  if (provider === "api") {
    throw new Error("api provider dispatch not implemented");
  }

  // No silent high fallback: an unrecognized model/effort pair fails loudly.
  throw new Error(
    `unsupported model/effort combination: ${provider}/${model} @ ${effort}.`
  );
}

export function buildCommand(
  provider: Provider,
  model: string,
  effort: string,
  cwd: string,
  agentId?: string
): { args: string[]; ucSettingsPath?: string; ucSettingsDir?: string } {
  const mapped = mapModel(provider, model);
  const er = resolveEffort(provider, model, effort);

  if (provider === "claude") {
    const args = ["--model", mapped];

    if (er.kind === "flag") {
      args.push("--effort", er.value);
    } else if (er.kind === "settings") {
      const safeAgentId = (agentId ?? randomUUID()).replace(/[^a-zA-Z0-9._-]/g, "_");
      // J1-5: keep per-agent settings under the user's temp profile; POSIX modes
      // restrict the scratch dir/file, while Windows applies fs defaults.
      const ucSettingsDir = join(tmpdir(), "subagent-mcp", `perm-${safeAgentId}`);
      mkdirSync(ucSettingsDir, { recursive: true, mode: 0o700 });
      const ucSettingsPath = join(ucSettingsDir, "settings.json");
      writeFileSync(ucSettingsPath, '{"ultracode":true}', { mode: 0o600 });
      args.push("--settings", ucSettingsPath);
      return { args, ucSettingsPath, ucSettingsDir };
    }

    return { args };
  }

  if (provider === "api") {
    throw new Error("api provider dispatch not implemented");
  }

  // codex
  void (er as { kind: "flag"; value: string }).value;
  return {
    args: [
      "app-server",
      "--stdio",
    ],
  };
}
