import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const source = new URL("../src/provider.json", import.meta.url);
const target = new URL("../dist/provider.json", import.meta.url);

if (!existsSync(source)) {
  console.warn("WARN src/provider.json is absent; skipping provider.json copy");
  process.exit(0);
}

mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
copyFileSync(source, target);
console.log("Copied src/provider.json to dist/provider.json");
