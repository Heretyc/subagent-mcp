import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

import { getConfigHome } from "../config-home.js";

export function runSmcpActivate(): void {
  if (!existsSync(join(getConfigHome(), "providers.jsonc"))) {
    process.stderr.write("No providers configured. Run: subagent-mcp doctor\n");
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  runSmcpActivate();
  process.exit(0);
}
