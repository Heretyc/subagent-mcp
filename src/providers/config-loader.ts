import { join } from "node:path";
import { getConfigHome } from "../config-home.js";
import { parseJsoncFile } from "../jsonc.js";
import { apiProviderEntries, validateApiProviderEntry } from "./schema.js";
import type { ApiProvider } from "./types.js";

export function loadApiProviders(): ApiProvider[] {
  const file = join(getConfigHome(), "providers.jsonc");
  const parsed = parseJsoncFile(file);
  if (!parsed.ok) {
    console.error(`WARN providers: ${parsed.error}`);
    return [];
  }

  const providers: ApiProvider[] = [];
  for (const [name, entry] of apiProviderEntries(parsed.json)) {
    const result = validateApiProviderEntry(name, entry);
    if (result.ok) providers.push(result.provider);
    else console.error(`WARN providers: ${name}: ${result.reason}`);
  }
  return providers;
}
