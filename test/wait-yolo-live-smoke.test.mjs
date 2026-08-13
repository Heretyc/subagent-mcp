/**
 * wait-yolo-live-smoke.test.mjs — ISOLATED live smoke for Issue #372.
 *
 * Launches a REAL configured-provider sub-agent under a yolo LAUNCH snapshot,
 * drives it to do work that can produce a permission request, and asserts that
 * `wait` NEVER surfaces a permission_requested attention entry for it (i.e. the
 * yolo park is auto-allowed / never blocks wait) and that the agent progresses
 * without the wait hanging.
 *
 * GATED / SKIP-BY-DEFAULT: the repo has no live-agent test in the default
 * `npm test` path, so this test skips unless SUBAGENT_MCP_LIVE_YOLO_SMOKE=1 is
 * set AND a `claude` provider binary is resolvable. It never runs in default
 * npm test / CI. It temporarily sets the global config ceiling to yolo and
 * restores it in a finally block. Windows-safe (uses os.tmpdir / path.join).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;
let skipped = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.stack ?? e.message}`);
    failed++;
  }
}
function skip(name, reason) {
  console.log(`  SKIP: ${name} - ${reason}`);
  skipped++;
}

const GATE = process.env.SUBAGENT_MCP_LIVE_YOLO_SMOKE === "1";

function claudeResolvable() {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], {
    encoding: "utf8",
  });
  return probe.status === 0 && String(probe.stdout).trim().length > 0;
}

if (!GATE) {
  skip(
    "live yolo auto-allow smoke",
    "set SUBAGENT_MCP_LIVE_YOLO_SMOKE=1 to run (never in default npm test/CI)"
  );
} else if (!claudeResolvable()) {
  skip("live yolo auto-allow smoke", "no `claude` provider binary resolvable on PATH");
} else {
  await test("live: yolo-snapshot agent never surfaces a permission attention in wait", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );

    // Force yolo launch ceiling via the global config, restored afterwards.
    const globalCfgPath = fileURLToPath(new URL("../dist/global-concurrency.jsonc", import.meta.url));
    const original = existsSync(globalCfgPath) ? readFileSync(globalCfgPath, "utf8") : null;
    let client;
    try {
      writeFileSync(
        globalCfgPath,
        JSON.stringify(
          { maxConcurrentAgents: 4, permissionsCeiling: "yolo", escalation: "off" },
          null,
          2
        )
      );

      const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        env: { ...process.env },
      });
      client = new Client({ name: "yolo-live-smoke", version: "1.0.0" });
      await client.connect(transport);

      const launch = await client.callTool({
        name: "launch_agent",
        arguments: {
          task_category: "agentic_execution",
          prompt:
            "Run the shell command `node -e \"console.log('yolo-ok')\"` using your Bash tool, " +
            "then reply with exactly DONE. Do not ask for permission.",
        },
      });
      const launchText = launch.content?.map((c) => c.text).join("\n") ?? "";
      const idMatch = launchText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      assert.ok(idMatch, `launch_agent returned an agent id: ${launchText.slice(0, 200)}`);
      const agentId = idMatch[0];

      // Poll wait a bounded number of times; each wait call has its own long
      // server-side deadline but returns as soon as the agent finishes. We cap
      // total iterations so the smoke cannot hang indefinitely.
      let sawPermissionAttention = false;
      let finished = false;
      for (let i = 0; i < 6 && !finished; i++) {
        const res = await client.callTool({ name: "wait", arguments: {} });
        const payload = JSON.parse(res.content[0].text);
        if (Array.isArray(payload.permission_requested)) {
          if (payload.permission_requested.some((p) => p.id === agentId)) {
            sawPermissionAttention = true;
          }
        }
        if (
          Array.isArray(payload.finished) &&
          payload.finished.some((f) => f.id === agentId)
        ) {
          finished = true;
        }
        if (payload.timed_out) break;
      }

      assert.equal(
        sawPermissionAttention,
        false,
        "wait must never surface a permission_requested attention for a yolo-snapshot agent"
      );
    } finally {
      if (client) await client.close().catch(() => {});
      if (original !== null) writeFileSync(globalCfgPath, original);
    }
  });
}

console.log(`\nwait-yolo-live-smoke results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) process.exit(1);
