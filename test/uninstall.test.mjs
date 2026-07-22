import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runUninstall, verifyNoSubagentMcp } from "../dist/uninstall.js";
import {
  reconcileClaudeNativeAgentDeny,
  reconcileCodexNativeAgentDisable,
} from "../dist/native-suppression.js";

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

/** Write the sidecar copy smcp takes immediately before a suppression write. */
function sidecar(file, stamp, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.bak-native-agent-${stamp}`, content, "utf8");
}

function run(home) {
  return runUninstall({
    home,
    isTTY: true,
    input: Readable.from(["y\n"]),
    output: new Writable({ write(_c, _e, cb) { cb(); } }),
    backup: () => {},
    log: () => {},
  });
}

const STAMP = "2026-01-01T00-00-00-000Z";
const CODEX_TAIL = ["", "[mcp_servers.other]", "command = \"other\"", ""];

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

test("Y path reverts the managed native-agent deny to fresh state", () => withHome(async (home) => {
  seed(home);
  const settingsFile = join(home, ".claude", "settings.json");
  const settings = readJson(settingsFile);
  settings.theme = "dark";
  settings.permissions = {
    allow: ["Read(*)"],
    deny: ["Agent", "Task", "Explore", "Agent(Explore)", "Write(secret)"],
  };
  writeJson(settingsFile, settings);

  assert.equal(await runUninstall({
    home,
    isTTY: true,
    input: Readable.from(["y\n"]),
    output: new Writable({ write(_c, _e, cb) { cb(); } }),
    backup: () => {},
    log: () => {},
  }), 0);

  const after = readJson(settingsFile);
  const deny = after.permissions?.deny ?? [];
  for (const managed of ["Agent", "Task", "Explore", "Agent(Explore)"]) {
    assert.equal(deny.includes(managed), false, `uninstall must remove managed deny rule ${managed}`);
  }
  assert.equal(deny.includes("Write(secret)"), true, "user-authored deny entry must survive uninstall");
  assert.deepEqual(after.permissions.allow, ["Read(*)"]);
  assert.equal(after.theme, "dark");
}));

test("uninstall leaves a settings file with no managed deny untouched", () => withHome(async (home) => {
  seed(home);
  const settingsFile = join(home, ".claude", "settings.json");
  const settings = readJson(settingsFile);
  settings.permissions = { deny: ["Write(secret)", "TaskCreate"] };
  writeJson(settingsFile, settings);

  assert.equal(await runUninstall({
    home,
    isTTY: true,
    input: Readable.from(["y\n"]),
    output: new Writable({ write(_c, _e, cb) { cb(); } }),
    backup: () => {},
    log: () => {},
  }), 0);

  assert.deepEqual(readJson(settingsFile).permissions.deny, ["Write(secret)", "TaskCreate"]);
}));

test("claude: migration sidecar carrying the legacy trio is rejected, not restored", () => withHome(async (home) => {
  seed(home);
  const file = join(home, ".claude", "settings.json");
  const base = readJson(file);
  // The sidecar smcp took while migrating an older install still carries the
  // legacy trio, yet reconciling it reproduces the current file byte-for-byte.
  // An equivalence-only check would restore it and reintroduce managed state.
  const backup = { ...base, permissions: { deny: ["Task", "Explore", "Agent(Explore)"] } };
  const current = { ...base, permissions: { deny: ["Agent"] } };
  const reconciled = JSON.parse(JSON.stringify(backup));
  reconcileClaudeNativeAgentDeny(reconciled);
  assert.equal(
    `${JSON.stringify(reconciled, null, 2)}\n`,
    `${JSON.stringify(current, null, 2)}\n`,
    "precondition: the unsafe backup must reconcile to exactly the current file"
  );
  writeJson(file, current);
  sidecar(file, STAMP, `${JSON.stringify(backup, null, 2)}\n`);

  assert.equal(await run(home), 0);

  const deny = readJson(file).permissions?.deny ?? [];
  for (const managed of ["Agent", "Task", "Explore", "Agent(Explore)"]) {
    assert.equal(deny.includes(managed), false, `managed deny ${managed} must not be reintroduced by a restore`);
  }
  assert.equal(readJson(file).permissions, undefined, "an emptied permissions block collapses to fresh-install shape");
}));

test("codex: sidecar already holding multi_agent=false cannot no-op past removal", () => withHome(async (home) => {
  seed(home);
  const file = join(home, ".codex", "config.toml");
  const content = ["[features]", "multi_agent = false", ...CODEX_TAIL].join("\n");
  // Reconciling this backup is a no-op, so equivalence alone would "restore"
  // it -- writing the same bytes back and silently skipping removal entirely.
  assert.equal(reconcileCodexNativeAgentDisable(content).toml, content, "precondition: reconcile must be a no-op");
  writeFileSync(file, content, "utf8");
  sidecar(file, STAMP, content);

  assert.equal(await run(home), 0);

  const after = readFileSync(file, "utf8");
  assert.equal(/multi_agent/.test(after), false, "managed multi_agent must be removed, not preserved by a no-op restore");
  assert.equal(/\[features\]/.test(after), false, "an emptied [features] table is dropped");
  assert.match(after, /\[mcp_servers\.other\]/);
}));

test("codex: demonstrably pre-smcp sidecar restores the user's own multi_agent value", () => withHome(async (home) => {
  seed(home);
  const file = join(home, ".codex", "config.toml");
  const backup = ["# user config", "[features]", "multi_agent = true", ...CODEX_TAIL].join("\n");
  const current = reconcileCodexNativeAgentDisable(backup).toml;
  assert.match(current, /multi_agent = false/, "precondition: smcp overwrote the user's value");
  writeFileSync(file, current, "utf8");
  sidecar(file, STAMP, backup);

  assert.equal(await run(home), 0);

  const after = readFileSync(file, "utf8");
  assert.match(after, /multi_agent = true/, "a fresh backup restores what surgical removal would have deleted");
  assert.match(after, /# user config/);
}));

test("codex: surgical removal drops only multi_agent=false and preserves the rest", () => withHome(async (home) => {
  seed(home);
  const file = join(home, ".codex", "config.toml");
  writeFileSync(file, ["# top", "[features]", "multi_agent = false", "other_flag = true", ...CODEX_TAIL].join("\n"), "utf8");

  assert.equal(await run(home), 0);

  const after = readFileSync(file, "utf8");
  assert.equal(/multi_agent/.test(after), false);
  assert.match(after, /\[features\]/, "a table with surviving keys keeps its header");
  assert.match(after, /other_flag = true/);
  assert.match(after, /# top/);
  assert.match(after, /\[mcp_servers\.other\]/);
}));

test("codex: user-authored multi_agent=true is never removed", () => withHome(async (home) => {
  seed(home);
  const file = join(home, ".codex", "config.toml");
  writeFileSync(file, ["[features]", "multi_agent = true", ...CODEX_TAIL].join("\n"), "utf8");

  assert.equal(await run(home), 0);

  assert.match(readFileSync(file, "utf8"), /multi_agent = true/);
}));

test("reversion is idempotent across repeated uninstall runs", () => withHome(async (home) => {
  seed(home);
  const settingsFile = join(home, ".claude", "settings.json");
  const settings = readJson(settingsFile);
  settings.permissions = { deny: ["Agent", "Task", "Write(secret)"] };
  writeJson(settingsFile, settings);
  const codexFile = join(home, ".codex", "config.toml");
  writeFileSync(codexFile, ["[features]", "multi_agent = false", ...CODEX_TAIL].join("\n"), "utf8");

  assert.equal(await run(home), 0);
  const settingsAfterFirst = readFileSync(settingsFile, "utf8");
  const codexAfterFirst = readFileSync(codexFile, "utf8");

  assert.equal(await run(home), 0);
  assert.equal(readFileSync(settingsFile, "utf8"), settingsAfterFirst, "second run must not change settings again");
  assert.equal(readFileSync(codexFile, "utf8"), codexAfterFirst, "second run must not change config.toml again");
  assert.deepEqual(readJson(settingsFile).permissions.deny, ["Write(secret)"]);
}));

test("n path changes nothing", () => withHome(async (home) => {
  seed(home);
  const settingsFile = join(home, ".claude", "settings.json");
  const settings = readJson(settingsFile);
  settings.permissions = { deny: ["Agent", "Write(secret)"] };
  writeJson(settingsFile, settings);
  const beforeSettings = readFileSync(settingsFile, "utf8");
  const before = readFileSync(join(home, ".codex", "hooks.json"), "utf8");
  const calls = [];
  assert.equal(await runUninstall({ home, isTTY: true, input: Readable.from(["n\n"]), output: new Writable({ write(_c, _e, cb) { cb(); } }), backup: () => calls.push("backup"), log: () => {} }), 0);
  assert.equal(readFileSync(join(home, ".codex", "hooks.json"), "utf8"), before);
  assert.equal(readFileSync(settingsFile, "utf8"), beforeSettings, "declined uninstall must not touch the deny list");
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
