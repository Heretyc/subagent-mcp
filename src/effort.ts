import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export type Provider = "claude" | "codex";

export function mapModel(provider: Provider, model: string): string {
  if (provider === "claude") {
    if (model === "opus" || model === "opus-4-8") return "claude-opus-4-8";
    if (model === "sonnet") return "claude-sonnet-4-6";
    if (model === "haiku") return "claude-haiku-4-5";
    if (model === "fable") return "claude-fable-5";
    return model;
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

  if (effort === "low") {
    throw new Error(
      `low effort is not supported. Valid efforts: medium, high, xhigh, max, ultracode.`
    );
  }

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

  if (provider === "claude" && ["sonnet", "opus", "opus-4-8", "fable"].includes(model)) {
    if (["medium", "high", "xhigh", "max"].includes(effort)) {
      return { kind: "flag", value: effort };
    }
  }

  if (provider === "codex") {
    if (effort === "max") {
      throw new Error(
        `max effort is not valid for gpt-5.5 (Codex). Valid: medium, high, xhigh.`
      );
    }
    if (["medium", "high", "xhigh"].includes(effort)) {
      return { kind: "flag", value: effort };
    }
  }

  return { kind: "flag", value: "high" };
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
  } else {
    // codex
    void (er as { kind: "flag"; value: string }).value;
    return {
      args: [
        "app-server",
        "--stdio",
      ],
    };
  }
}
