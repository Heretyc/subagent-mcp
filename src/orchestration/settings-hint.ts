import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

function readModelFromSettings(path: string): string | null | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const model = (parsed as { model?: unknown }).model;
    return typeof model === "string" ? model : undefined;
  } catch {
    return undefined;
  }
}

function configDir(env: NodeJS.ProcessEnv): string {
  const raw = env.CLAUDE_CONFIG_DIR;
  if (typeof raw === "string" && raw.trim()) {
    return isAbsolute(raw) ? raw : join(homedir(), raw);
  }
  return join(homedir(), ".claude");
}

export function readClaudeLongContextHint(
  cwd: string | undefined,
  env: NodeJS.ProcessEnv,
): boolean | null {
  const envModel = env.ANTHROPIC_MODEL;
  if (typeof envModel === "string") {
    return /\[1m\]/i.test(envModel);
  }
  // Without a session cwd there is no session to attribute a model to, so the
  // machine-global settings fallback must NOT leak in. Real hooks always pass a
  // cwd (so project + global lookups still apply in production); a payload with
  // no cwd and no ANTHROPIC_MODEL yields a fail-safe null hint.
  if (!cwd) return null;
  const paths: string[] = [
    join(cwd, ".claude", "settings.local.json"),
    join(cwd, ".claude", "settings.json"),
    join(configDir(env), "settings.json"),
  ];

  for (const path of paths) {
    const model = readModelFromSettings(path);
    if (typeof model === "string") {
      return /\[1m\]/i.test(model);
    }
  }
  return null;
}
