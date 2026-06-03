import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const source = new URL("../src/routing-table.json", import.meta.url);
const target = new URL("../dist/routing-table.json", import.meta.url);

if (!existsSync(source)) {
  console.warn("WARN src/routing-table.json is absent; skipping routing-table.json copy");
  process.exit(0);
}

mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
copyFileSync(source, target);
console.log("Copied src/routing-table.json to dist/routing-table.json");
