import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runUninstall, verifyNoSubagentMcp } from "../dist/uninstall.js";

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

async function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), "subagent-uninstall-"));
  try {
    return await fn(join(root, "home"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function seed(home) {
  writeJson(join(home, ".claude", "settings.json"), {
    hooks: {
      UserPromptSubmit: [{ hooks: [
        { id: "subagent-mcp-orchestration-claude", command: "node", args: ["/x/dist/hooks/orchestration-claude.js"] },
        { id: "keep", command: "node", args: ["/x/keep.js"] },
      ] }],
    },
  });
  writeJson(join(home, ".codex", "hooks.json"), {
    hooks: {
      SessionStart: [{ hooks: [
        { id: "subagent-mcp-session-start", command: "node /x/dist/hooks/smcp-activate.js" },
        { command: "node \"/x/dist/hooks/orchestration-codex.js\"" },
      ] }],
    },
  });
  writeJson(join(home, ".claude.json"), { mcpServers: { "subagent-mcp": {}, other: {} } });
  writeJson(join(home, ".claude", "mcp.json"), { mcpServers: { "subagent-mcp": {} } });
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".codex", "config.toml"), [
    "[mcp_servers.subagent-mcp]",
    "command = \"node\"",
    "[mcp_servers.subagent-mcp.tools.launch_agent]",
    "enabled = true",
    "[mcp_servers.other]",
    "command = \"other\"",
    "",
  ].join("\n"), "utf8");
  mkdirSync(join(home, ".subagent-mcp"), { recursive: true });
  writeFileSync(join(home, ".subagent-mcp", "providers.jsonc"), "{/* keep */}\n");
  writeFileSync(join(home, ".subagent-mcp", ".env"), "KEEP=1\n");
}

test("Y path removes hooks and registrations, preserving provider config", () => withHome(async (home) => {
  seed(home);
  const calls = [];
  const out = [];
  const code = await runUninstall({
    home,
    isTTY: true,
    input: Readable.from(["y\n"]),
    output: new Writable({ write(_c, _e, cb) { cb(); } }),
    backup: () => calls.push("backup"),
    log: (line) => out.push(line),
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, ["backup"]);
  assert.equal(verifyNoSubagentMcp(home).length, 0);
  assert.equal(readJson(join(home, ".claude", "settings.json")).hooks.UserPromptSubmit[0].hooks[0].id, "keep");
  assert.equal(readJson(join(home, ".claude.json")).mcpServers.other.constructor, Object);
  assert.match(readFileSync(join(home, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.other\]/);
  assert.equal(readFileSync(join(home, ".subagent-mcp", "providers.jsonc"), "utf8"), "{/* keep */}\n");
  assert.equal(readFileSync(join(home, ".subagent-mcp", ".env"), "utf8"), "KEEP=1\n");
  assert.match(out.join("\n"), /verification: PASS/);
  assert.match(out.join("\n"), /npm uninstall -g @heretyc\/subagent-mcp/);
}));

test("legacy id-less hook removal only drops dist hook commands", () => withHome(async (home) => {
  writeJson(join(home, ".codex", "hooks.json"), {
    hooks: {
      UserPromptSubmit: [{ hooks: [
        { command: "node \"/x/dist/hooks/orchestration-codex.js\"" },
        { command: "node \"/x/dist/not-hooks/orchestration-codex.js\"" },
      ] }],
    },
  });
  assert.equal(await runUninstall({ home, isTTY: true, input: Readable.from(["y\n"]), output: new Writable({ write(_c, _e, cb) { cb(); } }), backup: () => {}, log: () => {} }), 0);
  const hooks = readJson(join(home, ".codex", "hooks.json")).hooks.UserPromptSubmit[0].hooks;
  assert.equal(hooks.length, 1);
  assert.match(hooks[0].command, /not-hooks/);
}));

test("n path changes nothing", () => withHome(async (home) => {
  seed(home);
  const before = readFileSync(join(home, ".codex", "hooks.json"), "utf8");
  const calls = [];
  assert.equal(await runUninstall({ home, isTTY: true, input: Readable.from(["n\n"]), output: new Writable({ write(_c, _e, cb) { cb(); } }), backup: () => calls.push("backup"), log: () => {} }), 0);
  assert.equal(readFileSync(join(home, ".codex", "hooks.json"), "utf8"), before);
  assert.deepEqual(calls, []);
}));

test("non-TTY dry output changes nothing", () => withHome(async (home) => {
  seed(home);
  const before = readFileSync(join(home, ".claude.json"), "utf8");
  const out = [];
  assert.equal(await runUninstall({ home, isTTY: false, backup: () => assert.fail("backup must not run"), log: (line) => out.push(line) }), 0);
  assert.equal(readFileSync(join(home, ".claude.json"), "utf8"), before);
  assert.match(out.join("\n"), /Would inspect\/remove/);
  assert.match(out.join("\n"), /non-TTY: no changes made/);
}));

test("missing provider files stay missing", () => withHome(async (home) => {
  writeJson(join(home, ".claude.json"), { mcpServers: { "subagent-mcp": {} } });
  assert.equal(await runUninstall({ home, isTTY: true, input: Readable.from(["y\n"]), output: new Writable({ write(_c, _e, cb) { cb(); } }), backup: () => {}, log: () => {} }), 0);
  assert.equal(existsSync(join(home, ".subagent-mcp", "providers.jsonc")), false);
  assert.equal(existsSync(join(home, ".subagent-mcp", ".env")), false);
}));

for (const t of tests) {
  try {
    await t.fn();
    console.log(`  PASS: ${t.name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${t.name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
