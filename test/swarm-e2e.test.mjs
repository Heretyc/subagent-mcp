import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distIndex = join(repoRoot, "dist", "index.js");

const { STAGE_COACHING, invalidStageText, outOfOrderText } = await import("../dist/swarm.js");
const { SUB_ORCHESTRATOR_ENV, SUB_ORCH_DEPTH_ERROR } = await import("../dist/sub-orchestrator.js");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

function withTimeout(promise, ms, label, getDetails) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const details = getDetails ? ` ${getDetails()}` : "";
        reject(new Error(`${label} timed out after ${ms}ms.${details}`));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function mainEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  if (!Object.hasOwn(extra, "SUBAGENT_MCP_SUBAGENT")) delete env.SUBAGENT_MCP_SUBAGENT;
  if (!Object.hasOwn(extra, "SUBAGENT_MCP_DEPTH")) delete env.SUBAGENT_MCP_DEPTH;
  if (!Object.hasOwn(extra, SUB_ORCHESTRATOR_ENV)) delete env[SUB_ORCHESTRATOR_ENV];
  return env;
}

function createMcpSession(options = {}) {
  const child = spawn(process.execPath, [distIndex], {
    cwd: options.cwd || repoRoot,
    env: options.env || mainEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let nextId = 1;
  let stdout = "";
  let stderr = "";
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    while (true) {
      const newline = stdout.indexOf("\n");
      if (newline === -1) break;
      const line = stdout.slice(0, newline).replace(/\r$/, "");
      stdout = stdout.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id).resolve(message);
        pending.delete(message.id);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.on("exit", (code, signal) => {
    for (const { reject } of pending.values()) {
      reject(new Error(`server exited before response (code=${code}, signal=${signal}, stderr=${stderr})`));
    }
    pending.clear();
  });

  function request(method, params) {
    const id = nextId++;
    const response = new Promise((resolveResponse, rejectResponse) => {
      pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return withTimeout(response, 5000, `${method} response`, () => `stderr=${stderr}`);
  }

  function notify(method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async function initialize() {
    const response = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "swarm-e2e-test", version: "0.0.0" },
    });
    notify("notifications/initialized");
    return response;
  }

  async function close() {
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill();
    }
    await withTimeout(
      new Promise((resolveClose) => child.once("exit", resolveClose)),
      2000,
      "server close",
      () => `stderr=${stderr}`
    ).catch(() => {});
  }

  return { request, initialize, close };
}

async function listTools(session) {
  const response = await session.request("tools/list", {});
  assert.equal(response.error, undefined);
  return response.result.tools;
}

async function callTool(session, name, args) {
  const response = await session.request("tools/call", { name, arguments: args });
  assert.equal(response.error, undefined);
  return response.result;
}

await test("main tools expose swarm and launch_agent carries sub-orchestrator schema", async () => {
  const session = createMcpSession();
  try {
    await session.initialize();
    const tools = await listTools(session);
    assert.ok(tools.some((tool) => tool.name === "swarm"), "main server must list swarm");
    const launch = tools.find((tool) => tool.name === "launch_agent");
    assert.equal(
      launch.inputSchema.properties["sub-orchestrator"].type,
      "boolean",
      "launch_agent schema must expose the sub-orchestrator flag"
    );
  } finally {
    await session.close();
  }
});

await test("plain child server excludes swarm", async () => {
  const session = createMcpSession({ env: mainEnv({ SUBAGENT_MCP_SUBAGENT: "1" }) });
  try {
    await session.initialize();
    const tools = await listTools(session);
    assert.equal(tools.some((tool) => tool.name === "swarm"), false, "child servers must not list swarm");
  } finally {
    await session.close();
  }
});

await test("swarm tool advances, corrects out-of-order calls, and updates get_status", async () => {
  const session = createMcpSession();
  try {
    await session.initialize();
    const start = await callTool(session, "swarm", {});
    assert.equal(start.isError, undefined);
    assert.equal(start.content[0].text, STAGE_COACHING[1]);

    const stage1 = await callTool(session, "swarm", { stage: 1 });
    assert.equal(stage1.isError, undefined);
    assert.equal(stage1.content[0].text, STAGE_COACHING[2]);

    const outOfOrder = await callTool(session, "swarm", { stage: 5 });
    assert.equal(outOfOrder.isError, undefined);
    assert.equal(outOfOrder.content[0].text, outOfOrderText(5, 2));

    const status = await callTool(session, "get_status", {});
    const payload = JSON.parse(status.content[0].text);
    assert.equal(payload.swarm.current_stage, 2);
    assert.equal(payload.swarm.pin_active, true);
  } finally {
    await session.close();
  }
});

await test("swarm tool accepts string stage at schema layer and returns coaching text", async () => {
  const session = createMcpSession();
  try {
    await session.initialize();
    await callTool(session, "swarm", {});
    const stringStage = await callTool(session, "swarm", { stage: "3" });
    assert.equal(stringStage.isError, undefined);
    assert.equal(stringStage.content[0].text, invalidStageText("3", 1));
    const integerStage = await callTool(session, "swarm", { stage: 1 });
    assert.equal(integerStage.isError, undefined);
    assert.equal(integerStage.content[0].text, STAGE_COACHING[2]);
  } finally {
    await session.close();
  }
});

await test("sub-orchestrator depth gate rejects depth 1 callers", async () => {
  const session = createMcpSession({
    env: mainEnv({ SUBAGENT_MCP_SUBAGENT: "1", SUBAGENT_MCP_DEPTH: "1" }),
  });
  try {
    await session.initialize();
    const result = await callTool(session, "launch_agent", {
      task_category: "coding",
      prompt: "blocked sub-orchestrator launch",
      "sub-orchestrator": true,
    });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, SUB_ORCH_DEPTH_ERROR(1));
  } finally {
    await session.close();
  }
});

await test("sub-orchestrator server gets its instructions variant and respond_permission", async () => {
  const env = mainEnv({ SUBAGENT_MCP_SUBAGENT: "1", [SUB_ORCHESTRATOR_ENV]: "1" });
  const session = createMcpSession({ env });
  try {
    const init = await session.initialize();
    assert.ok(
      init.result.instructions.startsWith("SUB-ORCHESTRATOR SESSION:"),
      "sub-orchestrator server must get the concrete instructions variant"
    );
    const tools = await listTools(session);
    assert.ok(
      tools.some((tool) => tool.name === "respond_permission"),
      "sub-orchestrator server must list respond_permission for its own workers"
    );
  } finally {
    await session.close();
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
process.exit(0);
