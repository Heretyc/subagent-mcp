import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export type Provider = "claude" | "codex";

export function mapModel(provider: Provider, model: string): string {
  if (provider === "claude") {
    if (model === "opus" || model === "opus-4-8") return "claude-opus-4-8";
    return model; // haiku, sonnet as-is
  } else {
    return model; // gpt-5.5
  }
}

export function resolveEffort(
  provider: Provider,
  model: string,
  effort: string
): { kind: "flag"; value: string } | { kind: "settings" } | { kind: "none" } {
  const isOpus48 = provider === "claude" && (model === "opus" || model === "opus-4-8");

  if (effort === "ultracode") {
    if (!isOpus48) {
      throw new Error(
        `ultracode effort is only available on Opus 4.8+ (got ${provider}/${model}). Use xhigh for other models.`
      );
    }
    return { kind: "settings" };
  }

  if (provider === "claude" && model === "haiku") {
    return { kind: "none" };
  }

  if (provider === "claude" && ["sonnet", "opus", "opus-4-8"].includes(model)) {
    if (["low", "medium", "high", "xhigh", "max"].includes(effort)) {
      return { kind: "flag", value: effort };
    }
  }

  if (provider === "codex") {
    if (effort === "max") {
      throw new Error(
        `max effort is not valid for gpt-5.5 (Codex). Valid: low, medium, high, xhigh.`
      );
    }
    if (["low", "medium", "high", "xhigh"].includes(effort)) {
      return { kind: "flag", value: effort };
    }
  }

  return { kind: "flag", value: "high" };
}

export function buildCommand(
  provider: Provider,
  model: string,
  effort: string,
  prompt: string,
  cwd: string
): { args: string[]; ucSettingsPath?: string } {
  const mapped = mapModel(provider, model);
  const er = resolveEffort(provider, model, effort);

  if (provider === "claude") {
    const args = ["-p", "--model", mapped];

    if (er.kind === "flag") {
      args.push("--effort", er.value);
    } else if (er.kind === "settings") {
      const ucSettingsPath = join(tmpdir(), `subagent-uc-${randomUUID()}.json`);
      writeFileSync(ucSettingsPath, '{"ultracode":true}');
      args.push("--settings", ucSettingsPath);
      args.push(
        "--permission-mode",
        "bypassPermissions",
        "--tools",
        "default",
        "--max-turns",
        "50",
        "--output-format",
        "stream-json",
        "--verbose"
      );
      return { args, ucSettingsPath };
    }

    args.push(
      "--permission-mode",
      "bypassPermissions",
      "--tools",
      "default",
      "--max-turns",
      "50",
      "--output-format",
      "stream-json",
      "--verbose"
    );
    return { args };
  } else {
    // codex
    const effortValue = (er as { kind: "flag"; value: string }).value;
    return {
      args: [
        "exec",
        "-C",
        cwd,
        "-m",
        "gpt-5.5",
        "-c",
        `model_reasoning_effort="${effortValue}"`,
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "--json",
        prompt,
      ],
    };
  }
}
