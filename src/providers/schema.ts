import { ROUTING_CATEGORIES, validateRoutingMap } from "../config-validate.js";
import type { ApiProvider, TaskCategory } from "./types.js";

type ProviderDoc = { providers?: unknown };
type JsonObj = Record<string, unknown>;

function isObj(value: unknown): value is JsonObj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function textField(name: string, value: unknown, errors: string[]): value is string {
  if (typeof value === "string" && value.length > 0) return true;
  errors.push(`${name} must be string`);
  return false;
}

export function validateApiProviderEntry(name: string, value: unknown): { ok: true; provider: ApiProvider } | { ok: false; reason: string } {
  if (!isObj(value)) return { ok: false, reason: "entry must be object" };

  const errors: string[] = [];
  const apiStyle = value.api_style;
  textField("base_url", value.base_url, errors);
  textField("model", value.model, errors);
  textField("key_env", value.key_env, errors);
  if (apiStyle !== "claude" && apiStyle !== "openai") errors.push("api_style must be claude or openai");

  const routingResult = validateRoutingMap(name, value.routing);
  errors.push(...routingResult.errors.map((e) => e.replace(`routing provider ${name}: `, "")));
  if (errors.length) return { ok: false, reason: errors.join("; ") };

  return {
    ok: true,
    provider: {
      name,
      api_style: apiStyle as "claude" | "openai",
      base_url: value.base_url as string,
      model: value.model as string,
      key_env: value.key_env as string,
      routing: value.routing as Record<TaskCategory, number>,
    },
  };
}

export function apiProviderEntries(doc: ProviderDoc): Array<[string, unknown]> {
  if (!isObj(doc.providers)) return [];
  return Object.entries(doc.providers).filter(([, value]) => isObj(value) && value.api_style !== undefined);
}

export function validateApiProvidersDocument(doc: ProviderDoc): { ok: true; providers: ApiProvider[] } | { ok: false; reason: string } {
  if (!isObj(doc.providers)) return { ok: false, reason: "providers must be object" };
  const providers: ApiProvider[] = [];
  const errors: string[] = [];
  for (const [name, value] of apiProviderEntries(doc)) {
    const result = validateApiProviderEntry(name, value);
    if (result.ok) providers.push(result.provider);
    else errors.push(`${name}: ${result.reason}`);
  }
  if (errors.length) return { ok: false, reason: errors.join("; ") };
  return { ok: true, providers };
}

export { ROUTING_CATEGORIES };
