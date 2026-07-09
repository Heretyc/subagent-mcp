/**
 * mcp-compliance.test.mjs — Redundancy layer 1: makes `npm test` enforce the
 * vendor-metadata limits checked by scripts/check_mcp_compliance.mjs (server
 * `instructions` byte size, every tool description byte size, tool-name charset,
 * UserPromptSubmit additionalContext char caps, and the caveman directive-asset
 * byte budgets).
 *
 * WHY (Rule 9): these limits are silent vendor truncation points — Claude Code
 * cuts server instructions / tool descriptions at 2KB and hook additionalContext
 * at 10k chars with no error. A regression that pushed any string past its cap
 * would degrade routing/governance in production while every existing test still
 * passed. This wrapper fails the suite the moment the single-source-of-truth
 * script reports a breach, so the limits cannot drift unnoticed.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = join(__dirname, "..", "scripts", "check_mcp_compliance.mjs");

try {
  const out = execFileSync(process.execPath, [script], { encoding: "utf8" });
  process.stdout.write(out);
  console.log("PASS mcp-compliance: check_mcp_compliance.mjs exited 0");
} catch (err) {
  if (err.stdout) process.stdout.write(err.stdout);
  if (err.stderr) process.stderr.write(err.stderr);
  console.error("FAIL mcp-compliance: check_mcp_compliance.mjs exited non-zero");
  process.exit(1);
}
