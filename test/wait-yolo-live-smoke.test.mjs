/**
 * Gated live smoke for yolo wait settlement.
 *
 * Launches a real configured-provider sub-agent under a yolo launch snapshot,
 * creates an isolated pending record through a test-only seam, and asserts
 * that `wait` settles it without surfacing permission_requested attention.
 *
 * GATED / SKIP-BY-DEFAULT: the repo has no live-agent test in the default
 * `npm test` path, so this test skips unless SUBAGENT_MCP_LIVE_YOLO_SMOKE=1 is
 * set AND a `claude` provider binary is resolvable. It never runs in default
 * npm test / CI. It temporarily sets the global config ceiling to yolo,
 * restores exact original content in a finally block, and isolates temporary
 * config and slot state. Windows-safe (uses os.tmpdir / path.join).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

    const globalCfgPath = fileURLToPath(
      new URL("../dist/global-subagent-mcp-config.jsonc", import.meta.url)
    );
    const original = existsSync(globalCfgPath) ? readFileSync(globalCfgPath, "utf8") : null;
    let testRoot;
    let client;
    let agentId;
    try {
      testRoot = mkdtempSync(join(tmpdir(), "subagent-mcp-yolo-wait-"));
      const configHome = join(testRoot, "config");
      const slotDir = join(testRoot, "slots");
      mkdirSync(configHome);
      mkdirSync(slotDir);
      writeFileSync(
        globalCfgPath,
        JSON.stringify(
          {
            globalConcurrentSubagents: 10,
            checkForUpdates: false,
            permissionsCeiling: "yolo",
            escalation: "off",
            strictReadParity: "off",
            sandboxNetwork: false,
          },
          null,
          2
        )
      );

      const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        env: {
          ...process.env,
          SUBAGENT_CONFIG_HOME: configHome,
          SUBAGENT_SLOT_DIR: slotDir,
          SUBAGENT_UPDATE_CHECK: "0",
          SUBAGENT_MCP_ENABLE_TEST_SEAMS: "1",
          SUBAGENT_MCP_LIVE_YOLO_SMOKE: "1",
        },
      });
      client = new Client({ name: "yolo-live-smoke", version: "1.0.0" });
      await client.connect(transport);

      const selection = await client.callTool({
        name: "model-selection-mode",
        arguments: { mode: "user-approved-overrides" },
      });
      assert.notEqual(selection.isError, true, "test enables explicit Claude selection");

      const launch = await client.callTool({
        name: "launch_agent",
        arguments: {
          task_category: "agentic_execution",
          provider: "claude",
          model: "sonnet",
          effort: "medium",
          prompt:
            "Run the shell command `node -e \"setTimeout(() => console.log('yolo-ok'), 5000)\"` using your Bash tool, " +
            "then reply with exactly DONE. Do not ask for permission.",
        },
      });
      const launchText = launch.content?.map((c) => c.text).join("\n") ?? "";
      const launchPayload = JSON.parse(launchText);
      assert.equal(launchPayload.permissions_applied.ceiling, "yolo");
      agentId = launchPayload.agent_id;
      assert.equal(typeof agentId, "string", "launch_agent returned an agent id");

      const parked = await client.callTool({
        name: "__test_park_yolo_wait_permission",
        arguments: { agent_id: agentId },
      });
      const parkedPayload = JSON.parse(parked.content[0].text);
      assert.equal(parkedPayload.pending_count, 1);

      const poll = await client.callTool({
        name: "poll_agent",
        arguments: { agent_id: agentId },
      });
      const pollPayload = JSON.parse(poll.content[0].text);
      const pending = pollPayload.pending_permissions?.find(
        (entry) => entry.request_id === parkedPayload.request_id
      );
      assert.equal(pending?.permission_ceiling, "manual");

      const waited = await client.callTool(
        { name: "wait", arguments: { verbose: true } },
        undefined,
        { timeout: 180000 }
      );
      const waitPayload = JSON.parse(waited.content[0].text);
      assert.equal(
        waitPayload.permission_requested,
        undefined,
        "wait must never surface a permission_requested attention for a yolo-snapshot agent"
      );
      assert.ok(
        waitPayload.finished?.some((entry) => entry.id === agentId),
        "wait must return the yolo-snapshot agent as finished"
      );
    } finally {
      if (client && agentId) {
        await client
          .callTool({ name: "kill_agent", arguments: { agent_id: agentId } })
          .catch(() => {});
      }
      if (client) await client.close().catch(() => {});
      if (original === null) unlinkSync(globalCfgPath);
      else writeFileSync(globalCfgPath, original);
      if (testRoot) rmSync(testRoot, { recursive: true, force: true });
    }
  });
}

console.log(`\nwait-yolo-live-smoke results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) process.exit(1);
