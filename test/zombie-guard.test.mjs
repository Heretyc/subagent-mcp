import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");

function run() {
  const source = readFileSync(join(repo, "src", "zombie.ts"), "utf8");

  assert.doesNotMatch(source, /\.map\(\(line\) => JSON\.parse\(line\) as ZombieRecord\)/);
  // Fix 1: readFileSync of the renamed claim is guarded (rename-visibility
  // races on Windows/AV/Dropbox can make a just-renamed file transiently
  // unopenable), then lines are split off the captured `raw` string.
  assert.match(source, /raw = readFileSync\(claim, "utf8"\);/);
  assert.match(source, /for \(const line of raw\.split\(\/\\r\?\\n\/\)\.filter\(Boolean\)\) \{/);
  assert.match(source, /try \{\s*records\.push\(JSON\.parse\(line\) as ZombieRecord\);\s*\} catch \{/);
  assert.match(source, /console\.error\(`zombies: skipped corrupt jsonl line in \$\{claim\}: \$\{line\.slice\(0, 120\)\}`\);/);
  // SRC-12: cull a live child only when its owning server is dead/absent (spare children of a live server).
  assert.doesNotMatch(source, /if \(ownerPid !== null && livePid\(pid\) && pid !== process\.pid\) \{/);
  assert.match(source, /ownerPid === null \|\| !ownerAlive/);
  assert.match(source, /livePid\(pid\) && pid !== process\.pid\) \{/);
}

try {
  run();
  console.log("PASS zombie guard");
} catch (err) {
  console.error(err);
  process.exit(1);
}
