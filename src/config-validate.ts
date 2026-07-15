import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfigHome } from "./config-home.js";
import { parseJsoncFile, type JsonObj } from "./jsonc.js";
import { TASK_CATEGORIES } from "./routing.js";

const TEMPLATE_PATH = fileURLToPath(new URL("../templates/providers.jsonc.template", import.meta.url));
const ROUTING_CATEGORIES = TASK_CATEGORIES.filter((c) => c !== "fallback_default");

type SchemaField = { name: string; type: "string" | "array" | "object" };

function parseArgs(args: string[]): { file: string } {
  let file = join(getConfigHome(), "providers.jsonc");
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--file" || !args[i + 1]) throw new Error(`unknown config validate argument: ${args[i]}`);
    file = args[++i];
  }
  return { file };
}

function templateFields(): SchemaField[] {
  const parsed = parseJsoncFile(TEMPLATE_PATH);
  if (!parsed.ok) throw new Error(`template parse error: ${parsed.error}`);
  const provider = Object.values(parsed.json.providers ?? {})[0] as JsonObj | undefined;
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) throw new Error("template has no provider shape");
  return Object.keys(provider).map((name) => ({
    name,
    type: Array.isArray(provider[name]) ? "array" : typeof provider[name] === "object" ? "object" : "string",
  }));
}

function readDotEnv(file: string): Map<string, string> {
  const env = new Map<string, string>();
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env.set(m[1], m[2].replace(/^["']|["']$/g, ""));
  }
  return env;
}

function providerEntries(config: JsonObj): Array<[string, JsonObj]> {
  const providers = config.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return [];
  return Object.entries(providers).filter((e): e is [string, JsonObj] => !!e[1] && typeof e[1] === "object" && !Array.isArray(e[1]));
}

export function validateConfigFile(file: string): { ok: boolean; lines: string[] } {
  const parsed = parseJsoncFile(file);
  const fields = templateFields();
  if (!parsed.ok) return { ok: false, lines: [`ERROR parse ${file}: ${parsed.error}`] };

  const errors: string[] = [];
  const routed = new Set<string>();
  const providers = providerEntries(parsed.json);
  if (providers.length === 0) errors.push("schema providers: expected non-empty object");

  const env = readDotEnv(join(dirname(file), ".env"));
  for (const [name, provider] of providers) {
    for (const field of fields) {
      const value = provider[field.name];
      const ok = field.type === "array" ? Array.isArray(value) : field.type === "object" ? !!value && typeof value === "object" && !Array.isArray(value) : typeof value === "string" && value.length > 0;
      if (!ok) errors.push(`schema provider ${name}: ${field.name} must be ${field.type}`);
    }
    if (typeof provider.key_env === "string") {
      const value = env.get(provider.key_env);
      if (!value || value === "YOUR_KEY_HERE") errors.push(`env provider ${name}: missing key_env ${provider.key_env}`);
    }

    const routing = provider.routing;
    if (!routing || typeof routing !== "object" || Array.isArray(routing)) continue;
    const keys = Object.keys(routing);
    for (const category of ROUTING_CATEGORIES) {
      if (!keys.includes(category)) errors.push(`routing provider ${name}: missing category ${category}`);
      else if (!Number.isInteger(routing[category])) errors.push(`routing provider ${name}: category ${category} slot must be integer`);
      else if (routing[category] >= 1) routed.add(category);
    }
    for (const key of keys) {
      if (!ROUTING_CATEGORIES.includes(key as any)) errors.push(`routing provider ${name}: unknown category ${key}`);
    }
  }

  const fieldText = fields.map((f) => `${f.name}:${f.type}`).join(", ");
  if (errors.length) return { ok: false, lines: [`ERROR config validate failed`, `schema fields: ${fieldText}`, ...errors.sort()] };
  return { ok: true, lines: [`OK config validate: providers=${providers.length} categories_routed=${routed.size}`, `schema fields: ${fieldText}`] };
}

export async function runConfigValidate(args = process.argv.slice(4)): Promise<number> {
  try {
    const { file } = parseArgs(args);
    const result = validateConfigFile(file);
    for (const line of result.lines) console.log(line);
    return result.ok ? 0 : 1;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}
