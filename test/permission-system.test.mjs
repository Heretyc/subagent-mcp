import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { verdict } from "../dist/permission-engine.js";
import { codexApprovalOp, codexApprovalResult, ClaudeSdkDriver } from "../dist/drivers.js";
import {
  PendingPermissionManager,
  pendingPermissionManager,
} from "../dist/pending-permissions.js";
import {
  legacyConfigPath,
} from "../dist/concurrency.js";
import { buildCommand } from "../dist/effort.js";
import { selectUnreportedPermissionRequested } from "../dist/wait-helpers.js";
import { reconcilePermissionStatus } from "../dist/status-helpers.js";
import { shouldReapTerminalButAlive } from "../dist/zombie.js";

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

function stripJsonc(text) {
  return text.replace(/^\s*\/\/.*$/gm, "");
}

function loadVectors() {
  const raw = readFileSync(new URL("../src/permission-classes.test-vectors.jsonc", import.meta.url), "utf8");
  const parsed = JSON.parse(stripJsonc(raw));
  assert.equal(parsed.vectors.length, 67, "golden vector count must stay at 67");
  return parsed.vectors;
}

function codexParamsFromOp(op) {
  if (op.tool.toLowerCase().includes("bash")) {
    return {
      command: op.argv ?? op.command ?? "",
      cwd: op.cwd,
      irreversible: Boolean(op.irreversible),
    };
  }
  if (op.paths?.length || /edit|write|notebook/i.test(op.tool)) {
    // Codex apply-patch carries the change kind: a Write op is an add/create,
    // Edit/NotebookEdit are modify. The adapter maps these back to Write/Edit.
    const type = /write/i.test(op.tool) ? "add" : "modify";
    return { fileChanges: Object.fromEntries((op.paths ?? []).map((p) => [p, { type }])) };
  }
  return {};
}

function hasCodexApprovalPayload(op) {
  return op.tool.toLowerCase().includes("bash") || /edit|write|notebook/i.test(op.tool);
}

function claudeRequestFromOp(op) {
  const input = {};
  if (op.command !== undefined) input.command = op.command;
  if (op.argv !== undefined) input.command = op.argv.join(" ");
  if (op.paths !== undefined) input.paths = op.paths;
  if (op.network?.[0]?.url) input.url = op.network[0].url;
  if (op.network?.[0]?.host) input.host = op.network[0].host;
  if (op.irreversible) input.irreversible = true;
  return { toolName: op.tool, input, id: `claude-${op.tool}` };
}

async function claudeAdapterVerdict(op, rules) {
  const agentId = `golden-claude-${Math.random().toString(16).slice(2)}`;
  let sdkOptions;
  async function* query(params) {
    sdkOptions = params.options;
    yield { type: "result", result: "ready" };
  }
  const driver = new ClaudeSdkDriver(query);
  driver.process.stdout.on("error", () => {});
  driver.process.stderr.on("error", () => {});
  driver.open({
    provider: "claude",
    command: "claude",
    args: [],
    cwd: process.cwd(),
    env: process.env,
    model: "sonnet",
    effort: "high",
    agentId,
    permissionSnapshot: {
      ceiling: "auto",
      escalation: "irreversible-only",
      rules: rules ?? {},
    },
  });
  while (!sdkOptions) await new Promise((r) => setTimeout(r, 0));
  const pending = sdkOptions.canUseTool(claudeRequestFromOp(op));
  await new Promise((r) => setTimeout(r, 0));
  const parked = pendingPermissionManager.pendingForAgent(agentId)[0] ?? null;
  if (parked) {
    await pendingPermissionManager.respond(agentId, parked.request_id, "deny", "test cleanup");
    await pending;
    driver.kill();
    return "ask";
  }
  const result = await pending;
  driver.kill();
  return result.behavior === "allow" ? "allow" : "deny";
}

await test("golden vectors run through shared engine and both adapter mappings", async () => {
  for (const vector of loadVectors()) {
    const engine = verdict(vector.op, vector.rules ?? {}).verdict;
    assert.equal(engine, vector.expected_verdict, `${vector.name}: shared engine`);

    // Symlink parity (resolvedPaths) needs a real on-disk symlink for the
    // adapters' realpath resolution to reproduce the vector's resolved target;
    // that is exercised end-to-end in the dedicated symlink parity test below.
    // The engine verdict is still asserted above for these vectors.
    if (vector.op.resolvedPaths) continue;

    const claude = await claudeAdapterVerdict(vector.op, vector.rules);
    assert.equal(claude, engine, `${vector.name}: Claude adapter`);

    if (!hasCodexApprovalPayload(vector.op)) {
      assert.equal(verdict(vector.op, vector.rules ?? {}).verdict, engine, `${vector.name}: Codex no-approval read path`);
      continue;
    }
    const method = vector.op.paths?.length && !vector.op.tool.toLowerCase().includes("bash")
      ? "item/fileChange/requestApproval"
      : "item/commandExecution/requestApproval";
    const mapped = codexApprovalOp(method, codexParamsFromOp(vector.op), vector.op.cwd);
    const codex = mapped.confidence ? verdict(mapped.op, vector.rules ?? {}).verdict : "ask";
    assert.equal(codex, engine, `${vector.name}: Codex adapter`);
  }
});

await test("symlink deny parity: both adapters resolve the real target, not the literal link", async () => {
  const root = mkdtempSync(join(process.cwd(), ".tmp-subagent-perm-symlink-"));
  try {
    const realDir = join(root, ".ssh");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, "config"), "secret");
    const link = join(root, "link");
    symlinkSync(realDir, link, platform() === "win32" ? "junction" : "dir");
    const linkedPath = join(link, "config"); // absolute; realpath -> <root>/.ssh/config

    // Engine, given the resolved target, denies (dangerous .ssh segment).
    assert.equal(verdict({ tool: "Edit", paths: [linkedPath], resolvedPaths: [join(realDir, "config")], cwd: root }, {}).verdict, "deny");

    // Claude adapter: canUseTool only sees the literal link path.
    const claude = await claudeAdapterVerdict({ tool: "Edit", paths: [linkedPath], cwd: root }, {});
    assert.equal(claude, "deny", "Claude adapter must deny via resolved .ssh target");

    // Codex adapter: fileChange approval only names the literal link path.
    const mapped = codexApprovalOp(
      "item/fileChange/requestApproval",
      { fileChanges: { [linkedPath]: { type: "modify" } } },
      root
    );
    assert.equal(mapped.confidence, true);
    assert.equal(verdict(mapped.op, {}).verdict, "deny", "Codex adapter must deny via resolved .ssh target");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("Codex apply-patch maps add/create -> Write and modify -> Edit for rule round-trip", () => {
  const writeRules = { allow: ["Write(src/new.ts)"] };
  const editRules = { allow: ["Edit(src/new.ts)"] };
  const add = codexApprovalOp("item/fileChange/requestApproval", { fileChanges: { "src/new.ts": { type: "add" } } }, ".");
  const modify = codexApprovalOp("item/fileChange/requestApproval", { fileChanges: { "src/new.ts": { type: "modify" } } }, ".");
  assert.equal(add.op.tool, "Write");
  assert.equal(modify.op.tool, "Edit");
  // Write rule matches the add, not the modify; Edit rule matches the modify, not the add.
  assert.equal(verdict(add.op, writeRules).verdict, "allow");
  assert.equal(verdict(modify.op, writeRules).verdict, "ask");
  assert.equal(verdict(modify.op, editRules).verdict, "allow");
  assert.equal(verdict(add.op, editRules).verdict, "ask");
});

await test("Codex approval reply shapes are exact for every approval method", () => {
  const modern = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"];
  for (const method of modern) {
    assert.deepEqual(codexApprovalResult(method, "allow"), { decision: "accept" });
    assert.deepEqual(codexApprovalResult(method, "deny"), { decision: "decline" });
  }
  for (const method of ["execCommandApproval", "applyPatchApproval"]) {
    assert.deepEqual(codexApprovalResult(method, "allow"), { decision: "approved" });
    assert.deepEqual(codexApprovalResult(method, "deny"), { decision: "denied" });
  }
  assert.deepEqual(codexApprovalResult("mcpServer/elicitation/request", "allow"), { action: "accept" });
  assert.deepEqual(codexApprovalResult("mcpServer/elicitation/request", "deny"), { action: "decline" });
});

await test("permission lifecycle replies are never dropped for deny, timeout, kill, and cap overflow", async () => {
  const manager = new PendingPermissionManager();
  const replies = [];
  const base = {
    agent_id: "agent-a",
    harness_channel: "codex-app-server",
    tool_name_or_method: "item/commandExecution/requestApproval",
    action: { command: "node build.js" },
    correlation_id: 1,
    resolve: (reply) => replies.push(reply),
  };

  const denied = manager.create(base);
  await manager.respond("agent-a", denied.request_id, "deny", "manual deny");
  assert.equal(replies.at(-1).decision, "deny");

  const oldSetTimeout = globalThis.setTimeout;
  const oldClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (fn) => {
    queueMicrotask(fn);
    return { unref() {} };
  };
  globalThis.clearTimeout = () => {};
  try {
    const timeoutManager = new PendingPermissionManager();
    const timeoutReplies = [];
    timeoutManager.create({ ...base, agent_id: "agent-timeout", resolve: (r) => timeoutReplies.push(r) });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(timeoutReplies[0].decision, "deny");
    assert.match(timeoutReplies[0].reason, /park-timeout/);
    assert.equal(timeoutManager.telemetry.park_timeout_auto_denies, 1);
  } finally {
    globalThis.setTimeout = oldSetTimeout;
    globalThis.clearTimeout = oldClearTimeout;
  }

  const killReplies = [];
  const kill = manager.create({ ...base, agent_id: "agent-kill", resolve: (r) => killReplies.push(r) });
  assert.equal(kill.state, "pending");
  await manager.closeAgent("agent-kill", "agent stopped by operator");
  assert.equal(killReplies[0].decision, "deny");

  const overflowReplies = [];
  for (let i = 0; i < 17; i++) {
    manager.create({ ...base, agent_id: "agent-cap", correlation_id: i, resolve: (r) => overflowReplies.push(r) });
  }
  assert.equal(manager.pendingCount("agent-cap"), 16);
  assert.equal(overflowReplies.at(-1).decision, "deny");
  assert.equal(manager.telemetry.cap_overflow_auto_denies, 1);
});

await test("pendingForAgent records are JSON-serializable (no live timer leak)", () => {
  // Regression: poll_agent serializes pending_permissions; a leaked NodeJS.Timeout
  // is circular (Timeout -> TimersList -> Timeout) and crashes JSON.stringify.
  const manager = new PendingPermissionManager();
  manager.create({
    agent_id: "serialize-agent",
    harness_channel: "codex-app-server",
    tool_name_or_method: "item/commandExecution/requestApproval",
    action: { command: "whoami" },
    correlation_id: 1,
    resolve: () => {},
  });
  const records = manager.pendingForAgent("serialize-agent");
  assert.equal(records.length, 1);
  assert.equal("timer" in records[0], false, "public record must not carry the live timer");
  assert.equal("resolve" in records[0], false, "public record must not carry the resolve closure");
  assert.doesNotThrow(() => JSON.stringify(records), "pending record must round-trip through JSON");
});

await test("reconcilePermissionStatus recovers a park whose queue event fired before registration", () => {
  // pure rule: pending>0 flips a live agent to permission_requested
  assert.deepEqual(reconcilePermissionStatus("processing", 1), { status: "permission_requested", changed: true });
  assert.deepEqual(reconcilePermissionStatus("stalled", 2), { status: "permission_requested", changed: true });
  // already parked or draining: no churn
  assert.deepEqual(reconcilePermissionStatus("permission_requested", 1), { status: "permission_requested", changed: false });
  // queue drained: recover to processing
  assert.deepEqual(reconcilePermissionStatus("permission_requested", 0), { status: "processing", changed: true });
  // terminal-ish / nothing pending: untouched
  assert.deepEqual(reconcilePermissionStatus("processing", 0), { status: "processing", changed: false });
  assert.deepEqual(reconcilePermissionStatus("finished", 3), { status: "finished", changed: false });

  // Race simulation: a Codex approval parks (pending created) BEFORE the agent
  // row is registered, so the onAgentQueueChange listener no-ops. At
  // registration the agent is still "processing"; reconcile must flip it so an
  // in-flight `wait` (selectUnreportedPermissionRequested) surfaces it.
  const manager = new PendingPermissionManager();
  const agentId = "race-agent";
  manager.create({
    agent_id: agentId,
    harness_channel: "codex-app-server",
    tool_name_or_method: "item/commandExecution/requestApproval",
    action: { command: "whoami" },
    correlation_id: 7,
    resolve: () => {},
  });
  const agent = { id: agentId, status: "processing", waitReported: false, exitCode: null };
  assert.deepEqual(selectUnreportedPermissionRequested([agent]), [], "pre-reconcile: wait sees nothing");
  const r = reconcilePermissionStatus(agent.status, manager.pendingCount(agentId));
  if (r.changed) { agent.status = r.status; agent.waitReported = false; }
  assert.equal(agent.status, "permission_requested");
  assert.deepEqual(selectUnreportedPermissionRequested([agent]).map((a) => a.id), [agentId], "post-reconcile: wait early-returns it");
});

await test("permission lifecycle selectors and one-time grants behave as specified", async () => {
  const livePending = { id: "p", status: "permission_requested", waitReported: false };
  assert.deepEqual(selectUnreportedPermissionRequested([livePending]).map((a) => a.id), ["p"]);
  livePending.waitReported = true;
  assert.deepEqual(selectUnreportedPermissionRequested([livePending]), []);
  assert.equal(
    shouldReapTerminalButAlive({
      status: "permission_requested",
      exitedAt: Date.now() - 999999,
      lastActivity: Date.now() - 999999,
      driver: { closed: false },
    }, Date.now(), 1),
    false
  );

  const manager = new PendingPermissionManager();
  const replies = [];
  const req = manager.create({
    agent_id: "one-time",
    harness_channel: "claude-canUseTool",
    tool_name_or_method: "Bash",
    action: { command: "node build.js" },
    correlation_id: "x",
    resolve: (r) => replies.push(r),
  });
  await manager.respond("one-time", req.request_id, "allow", "one-time");
  assert.equal(replies.length, 1);
  await assert.rejects(() => manager.respond("one-time", req.request_id, "allow"), /not found|no pending/);
});

await test("irreversible auto escalation flag follows ceiling and knob semantics", async () => {
  const manager = new PendingPermissionManager();
  const base = {
    agent_id: "escalation-agent",
    harness_channel: "claude-canUseTool",
    tool_name_or_method: "Bash",
    action: { command: "psql -c 'DROP TABLE users'" },
    correlation_id: "x",
    resolve: () => {},
  };

  const auto = manager.create({
    ...base,
    permission_ceiling: "auto",
    escalation: "irreversible-only",
    irreversible: true,
  });
  assert.equal(auto.escalate_to_human, true);
  assert.equal(auto.irreversible, true);
  assert.equal(auto.escalation, "irreversible-only");

  const manual = manager.create({
    ...base,
    agent_id: "manual-agent",
    permission_ceiling: "manual",
    escalation: "irreversible-only",
    irreversible: true,
  });
  assert.equal(manual.escalate_to_human, false, "manual already routes residue to the human");
  assert.equal(manual.irreversible, true, "manual still exposes the informational irreversible tag");

  const off = manager.create({
    ...base,
    agent_id: "off-agent",
    permission_ceiling: "auto",
    escalation: "off",
    irreversible: true,
  });
  assert.equal(off.escalate_to_human, false);

  const defaultEscalation = manager.create({
    ...base,
    agent_id: "default-agent",
    permission_ceiling: "auto",
    irreversible: true,
  });
  assert.equal(defaultEscalation.escalate_to_human, true, "omitted escalation uses irreversible-only behavior");

  await manager.closeAgent("escalation-agent", "test cleanup");
  await manager.closeAgent("manual-agent", "test cleanup");
  await manager.closeAgent("off-agent", "test cleanup");
  await manager.closeAgent("default-agent", "test cleanup");
});

await test("escalated allow requires an audit reason but deny does not", async () => {
  const manager = new PendingPermissionManager();
  const makeRequest = (agent_id) =>
    manager.create({
      agent_id,
      harness_channel: "codex-app-server",
      tool_name_or_method: "item/commandExecution/requestApproval",
      action: { command: "psql -c 'DROP TABLE users'" },
      permission_ceiling: "auto",
      escalation: "irreversible-only",
      irreversible: true,
      correlation_id: "x",
      resolve: () => {},
    });

  const allowRequest = makeRequest("reason-agent");
  await assert.rejects(
    () => manager.respond("reason-agent", allowRequest.request_id, "allow"),
    /requires a non-empty reason/
  );
  assert.equal(manager.pendingCount("reason-agent"), 1, "rejected response leaves request pending");
  await manager.respond("reason-agent", allowRequest.request_id, "allow", "human approved irreversible action");
  assert.equal(manager.pendingCount("reason-agent"), 0);

  const denyRequest = makeRequest("deny-agent");
  await manager.respond("deny-agent", denyRequest.request_id, "deny");
  assert.equal(manager.pendingCount("deny-agent"), 0);
});

await test("config precedence, unions, repo allow, legacy read, and parse fail-closed", () => {
  const root = mkdtempSync(join(process.cwd(), ".tmp-subagent-perm-config-"));
  const cwd = join(root, "repo");
  const home = join(root, "home");
  const globalPath = join(root, "global-subagent-mcp-config.jsonc");
  try {
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    mkdirSync(join(cwd, ".codex"), { recursive: true });
    mkdirSync(join(home, ".subagent-mcp"), { recursive: true });
    writeFileSync(globalPath, '{"permissionsCeiling":"yolo","escalation":"off","strictReadParity":"off"}');
    writeFileSync(join(home, ".subagent-mcp", "settings.json"), JSON.stringify({
      disableBypassPermissionsMode: "disable",
      permissions: { allow: ["Read(home.txt)"], ask: ["Bash(node *)"], deny: ["Write(secret)"] },
    }));
    writeFileSync(join(cwd, ".claude", "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(node build.js)"], ask: ["Edit(src/*)"], deny: ["WebFetch(domain:bad.test)"] },
    }));
    writeFileSync(join(cwd, ".codex", "config.toml"), 'sandbox_mode = "read-only"\nwritable_roots = ["extra"]\n');

    const code = `
      import { readMergedPermissionConfig, consumeLegacyConfigDeprecationNotice, legacyConfigPath } from "./dist/concurrency.js";
      import { rmSync, writeFileSync } from "node:fs";
      const cwd = ${JSON.stringify(cwd)};
      const globalPath = ${JSON.stringify(globalPath)};
      const first = readMergedPermissionConfig(cwd, globalPath);
      rmSync(globalPath);
      writeFileSync(legacyConfigPath(globalPath), '{"permissionsCeiling":"manual"}');
      const legacy = readMergedPermissionConfig(cwd, globalPath);
      const notice = consumeLegacyConfigDeprecationNotice();
      writeFileSync(globalPath, "{not-json");
      const failed = readMergedPermissionConfig(cwd, globalPath);
      console.log(JSON.stringify({ first, legacy, notice, failed }));
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: "utf8",
    });
    const { first, legacy, notice, failed } = JSON.parse(out);
    assert.equal(first.permissionsCeiling, "auto", "user disableBypass caps yolo to auto");
    assert.ok(first.allow.includes("Bash(node build.js)"), "repo allow is honored");
    assert.ok(first.ask.includes("Bash(node *)") && first.ask.includes("Edit(src/*)"));
    assert.ok(first.deny.includes("Write(secret)") && first.deny.includes("WebFetch(domain:bad.test)"));
    assert.ok(first.deny.includes("Edit") && first.deny.includes("Write"));
    assert.equal(legacy.permissionsCeiling, "manual");
    assert.match(notice, /deprecated/);
    assert.equal(failed.permissionsCeiling, "manual");
    assert.ok(failed.ask.includes("Bash") && failed.ask.includes("Edit"));
    assert.ok(failed.configParseFailure.some((f) => f.source === "builtin"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("settings isolation canary and temp permissions", async () => {
  let sdkOptions;
  async function* query(params) {
    sdkOptions = params.options;
    yield { type: "result", result: "ok" };
  }
  const driver = new ClaudeSdkDriver(query);
  driver.process.stdout.on("error", () => {});
  driver.process.stderr.on("error", () => {});
  driver.open({
    provider: "claude",
    command: "claude",
    args: [],
    cwd: process.cwd(),
    env: process.env,
    model: "sonnet",
    effort: "high",
    permissionSnapshot: { ceiling: "auto", escalation: "irreversible-only", rules: {} },
  });
  while (!sdkOptions) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sdkOptions.settingSources, []);
  driver.kill();

  const built = buildCommand("claude", "opus", "ultracode", process.cwd(), "perm-test");
  assert.ok(built.ucSettingsPath && built.ucSettingsDir);
  if (platform() === "win32") {
    skip("POSIX temp mode assertion", "Windows uses platform ACL defaults");
  } else {
    assert.equal(statSync(built.ucSettingsDir).mode & 0o777, 0o700);
    assert.equal(statSync(built.ucSettingsPath).mode & 0o777, 0o600);
  }
  rmSync(built.ucSettingsDir, { recursive: true, force: true });
});

await test("child process does not expose respond_permission tool", () => {
  const code = `
    import { Client } from "@modelcontextprotocol/sdk/client/index.js";
    import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js"],
      env: { ...process.env, SUBAGENT_MCP_SUBAGENT: "1" },
    });
    const client = new Client({ name: "perm-test", version: "1.0.0" });
    await client.connect(transport);
    const tools = await client.listTools();
    console.log(JSON.stringify(tools.tools.map((t) => t.name)));
    await client.close();
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(JSON.parse(out).includes("respond_permission"), false);
});

// TODO(P8): full send_message-while-parked server integration needs a mock
// provider that emits a real Codex approval through launch_agent. The lower
// level guard is covered by PendingPermissionManager + adapter tests above.
skip("send_message rejected while parked (full MCP integration)", "requires provider approval fixture");

console.log(`\nPermission system results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) {
  process.exit(1);
}
