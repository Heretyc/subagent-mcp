import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfigHome } from "./config-home.js";

export interface ConfigInitResult {
  file: string;
  status: "created" | "skipped" | "overwritten";
  backup?: string;
}

const TEMPLATE_PATH = fileURLToPath(new URL("../templates/providers.jsonc.template", import.meta.url));

function backup(file: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${file}.bak-config-init-${stamp}`;
  copyFileSync(file, target);
  return target;
}

function parseArgs(args: string[]): { force: boolean } {
  const opts = { force: false };
  for (const arg of args) {
    if (arg === "--force") opts.force = true;
    else throw new Error(`unknown config init argument: ${arg}`);
  }
  return opts;
}

function envScaffold(template: string): string {
  const names = [...template.matchAll(/"key_env"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  return [
    "# Stored next to providers.jsonc under ~/.subagent-mcp, which is outside git by default.",
    ...Array.from(new Set(names)).map((name) => `${name}=YOUR_KEY_HERE`),
    "",
  ].join("\n");
}

function writeMaybe(file: string, content: string, force: boolean): ConfigInitResult {
  if (existsSync(file) && !force) return { file, status: "skipped" };
  mkdirSync(dirname(file), { recursive: true });
  const old = existsSync(file) ? backup(file) : undefined;
  writeFileSync(file, content, "utf8");
  return { file, status: old ? "overwritten" : "created", backup: old };
}

export function initConfigScaffold(force = false): ConfigInitResult[] {
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  const home = getConfigHome();
  return [
    writeMaybe(join(home, "providers.jsonc"), template, force),
    writeMaybe(join(home, ".env"), envScaffold(template), force),
  ];
}

export async function runConfigInit(args = process.argv.slice(4)): Promise<number> {
  let opts: { force: boolean };
  try {
    opts = parseArgs(args);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  try {
    for (const result of initConfigScaffold(opts.force)) {
      const extra = result.backup ? ` (backup: ${basename(result.backup)})` : "";
      console.log(`${result.status.padEnd(11)} ${result.file}${extra}`);
    }
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}
