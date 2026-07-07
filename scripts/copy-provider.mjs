import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const source = new URL("../src/routing-table.json", import.meta.url);
const target = new URL("../dist/routing-table.json", import.meta.url);
const scaffoldSource = new URL("../src/advanced-ruleset.py", import.meta.url);
const scaffoldTarget = new URL("../dist/advanced-ruleset.py", import.meta.url);
const concurrencySource = new URL("../src/global-subagent-mcp-config.jsonc", import.meta.url);
const concurrencyTarget = new URL("../dist/global-subagent-mcp-config.jsonc", import.meta.url);
const legacyConcurrencyTarget = new URL("../dist/global-concurrency.jsonc", import.meta.url);

mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });

if (!existsSync(source)) {
  console.warn("WARN src/routing-table.json is absent; skipping routing-table.json copy");
} else {
  copyFileSync(source, target);
  console.log("Copied src/routing-table.json to dist/routing-table.json");
}

// The ruleset scaffold is a verified shipped part (deploy/setup verify lists
// include dist/advanced-ruleset.py), so unlike the routing table's
// warn-and-skip above, a missing source HARD-FAILS the build: a silent skip
// would ship an incomplete tarball.
if (!existsSync(scaffoldSource)) {
  console.error("ERROR src/advanced-ruleset.py is absent; refusing to build without the ruleset scaffold");
  process.exit(1);
}
copyFileSync(scaffoldSource, scaffoldTarget);
console.log("Copied src/advanced-ruleset.py to dist/advanced-ruleset.py");

if (!existsSync(concurrencySource)) {
  console.error("ERROR src/global-subagent-mcp-config.jsonc is absent; refusing to build without the concurrency config");
  process.exit(1);
}
copyFileSync(concurrencySource, concurrencyTarget);
console.log("Copied src/global-subagent-mcp-config.jsonc to dist/global-subagent-mcp-config.jsonc");
copyFileSync(concurrencySource, legacyConcurrencyTarget);
console.log("Copied src/global-subagent-mcp-config.jsonc to dist/global-concurrency.jsonc");
