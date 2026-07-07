// Structural guard for two driver-protocol regressions (LB-2, LB-3).
// These live-agent deadlock/wedge bugs are expensive to integration-test, so we
// assert the fix shape survives in src/drivers.ts source rather than exercising
// the real SDK / codex app-server. Plain node + assert, no build step.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "src", "drivers.ts"), "utf8");

// LB-2: codex driver must track approval RPCs by id and reply through JSON-RPC.
assert.doesNotMatch(src, /pendingServerRequest/, "LB-2: deleted single-slot pendingServerRequest returned");
assert.match(src, /pendingApprovals\s*=\s*new Map/, "LB-2: pendingApprovals map missing");
assert.match(src, /maxPendingApprovals\s*=\s*16/, "LB-2: pending approval cap missing");
assert.match(src, /replyCodexApproval\s*\(/, "LB-2: codex approval reply path missing");
assert.match(src, /replyJsonRpc\s*\(/, "LB-2: JSON-RPC reply helper missing");
assert.match(src, /isElicitationMethod\s*\(/, "LB-2: elicitation-method detection missing");
assert.match(
  src,
  /buildElicitationResult\s*\(/,
  "LB-2: elicitation reply builder missing"
);

// LB-3: claude driver must expose a resume path for post-bg-task wakeups.
assert.match(src, /notifyTaskComplete\s*\(/, "LB-3: notifyTaskComplete method missing");
assert.match(src, /resumePending/, "LB-3: resume debounce guard missing");

console.log("drivers-guard: OK (LB-2 + LB-3 structural guards present)");
