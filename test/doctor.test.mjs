import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  checkDuplicateHooks,
  checkEnvKeys,
  checkInstallMode,
  checkMcpRegistration,
  checkProviderConfig,
  checkReachability,
  checkRoutingCoverage,
  checkUpdate,
} from "../dist/doctor.js";

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

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "subagent-doctor-"));
  const home = join(root, "home");
  const globalRoot = join(root, "global");
  const fakeBin = join(root, "bin");
  const pkgRoot = join(globalRoot, "@heretyc", "subagent-mcp");
  mkdirSync(join(pkgRoot, "dist"), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(pkgRoot, "dist", "index.js"), "#!/usr/bin/env node\n");
  const npmSh = join(fakeBin, "npm");
  writeFileSync(npmSh, `#!/bin/sh\necho "${globalRoot.replace(/\\/g, "/")}"\n`);
  chmodSync(npmSh, 0o755);
  writeFileSync(join(fakeBin, "npm-cli.js"), `console.log(${JSON.stringify(globalRoot)});\n`);
  writeFileSync(
    join(fakeBin, "npm.cmd"),
    `@IF EXIST "%~dp0\\node.exe" ("%~dp0\\node.exe" "%~dp0\\npm-cli.js" %*) ELSE ("${process.execPath}" "%~dp0\\npm-cli.js" %*)\r\n`
  );
  return { root, home, globalRoot, fakeBin, pkgRoot };
}

async function withRoot(fn) {
  const r = makeRoot();
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = r.home;
  process.env.USERPROFILE = r.home;
  try {
    return await fn(r);
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
    rmSync(r.root, { recursive: true, force: true });
  }
}

function env(fakeBin) {
  return { ...process.env, PATH: fakeBin, Path: fakeBin };
}

function liveConfig(home) {
  writeJson(join(home, ".claude.json"), {
    mcpServers: { "subagent-mcp": { command: "subagent-mcp", args: [] } },
  });
}

function providerConfig(home, providers) {
  writeJson(join(home, ".subagent-mcp", "providers.jsonc"), { providers });
}

function claudePromptHook(path, extra = {}) {
  return {
    id: "subagent-mcp-orchestration-claude",
    type: "command",
    command: "node",
    args: [path],
    ...extra,
  };
}

function writeClaudeHooks(home, hooks) {
  writeJson(join(home, ".claude", "settings.json"), {
    hooks: { UserPromptSubmit: [{ hooks }] },
  });
}

function writePlugin(home) {
  const plugin = join(home, ".claude", "plugins", "subagent-mcp");
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, "dist", "hooks"), { recursive: true });
  writeJson(join(plugin, ".claude-plugin", "plugin.json"), { name: "subagent-mcp" });
  writeFileSync(join(plugin, "dist", "index.js"), "");
  writeJson(join(plugin, "hooks", "hooks.json"), {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ id: "subagent-mcp-orchestration-claude", command: 'node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/orchestration-claude.js"' }] }],
    },
  });
}

test("install-mode: npm-global mode reports dist path", () => withRoot(({ home, fakeBin, pkgRoot }) => {
  const r = checkInstallMode({ home, env: env(fakeBin) });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /npm-global=/);
  assert.match(r.detail.replace(/\\/g, "/"), new RegExp(pkgRoot.replace(/\\/g, "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}));

test("install-mode: marketplace mode reports plugin dist path", () => withRoot(({ home }) => {
  const plugin = join(home, ".claude", "plugins", "subagent-mcp");
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, "dist"), { recursive: true });
  writeJson(join(plugin, ".claude-plugin", "plugin.json"), { name: "subagent-mcp" });
  writeFileSync(join(plugin, "dist", "index.js"), "");
  const r = checkInstallMode({ home, env: { ...process.env, PATH: "", Path: "" } });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /marketplace=/);
}));

test("install-mode: dual mode reports both installs", () => withRoot(({ home, fakeBin }) => {
  const plugin = join(home, ".claude", "plugins", "subagent-mcp");
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, "dist"), { recursive: true });
  writeJson(join(plugin, ".claude-plugin", "plugin.json"), { name: "subagent-mcp" });
  writeFileSync(join(plugin, "dist", "index.js"), "");
  const r = checkInstallMode({ home, env: env(fakeBin) });
  assert.match(r.detail, /npm-global=/);
  assert.match(r.detail, /marketplace=/);
}));

test("mcp-registration: stale mcp.json warns without failing live registration", async () => withRoot(async ({ home, fakeBin }) => {
  liveConfig(home);
  writeJson(join(home, ".claude", "mcp.json"), {
    mcpServers: { "subagent-mcp": { command: "node", args: [join(home, "missing", "node_modules", "subagent-mcp", "dist", "index.js")] } },
  });
  const r = await checkMcpRegistration({ home, env: env(fakeBin), isTTY: false });
  assert.equal(r.status, "WARN");
  assert.match(r.detail, /non-TTY: no changes made/);
}));

test("mcp-registration: repair Y rewrites only stale mcp.json after backup", async () => withRoot(async ({ home, fakeBin }) => {
  liveConfig(home);
  const stale = join(home, ".claude", "mcp.json");
  writeJson(stale, {
    mcpServers: {
      other: { command: "other" },
      "subagent-mcp": { command: "node", args: [join(home, "missing", "dist", "index.js")] },
    },
  });
  const beforeLive = readFileSync(join(home, ".claude.json"), "utf8");
  const r = await checkMcpRegistration({
    home,
    env: env(fakeBin),
    isTTY: true,
    input: Readable.from(["y\n"]),
    output: new Writable({ write(_chunk, _enc, cb) { cb(); } }),
  });
  assert.equal(r.status, "WARN");
  assert.equal(readFileSync(join(home, ".claude.json"), "utf8"), beforeLive);
  const repaired = JSON.parse(readFileSync(stale, "utf8"));
  assert.equal(repaired.mcpServers.other.command, "other");
  assert.equal(repaired.mcpServers["subagent-mcp"].command, "subagent-mcp");
  assert.equal(existsSync(join(home, ".subagent-mcp", "backups")), true);
}));

test("mcp-registration: non-TTY never modifies stale mcp.json", async () => withRoot(async ({ home, fakeBin }) => {
  liveConfig(home);
  const stale = join(home, ".claude", "mcp.json");
  const body = {
    mcpServers: { "subagent-mcp": { command: "node", args: [join(home, "missing", "dist", "index.js")] } },
  };
  writeJson(stale, body);
  const before = readFileSync(stale, "utf8");
  const r = await checkMcpRegistration({ home, env: env(fakeBin), isTTY: false });
  assert.equal(r.status, "WARN");
  assert.equal(readFileSync(stale, "utf8"), before);
}));

test("duplicate-hooks: no dupes passes", async () => withRoot(async ({ home, pkgRoot, fakeBin }) => {
  writeClaudeHooks(home, [claudePromptHook(join(pkgRoot, "dist", "hooks", "orchestration-claude.js"))]);
  const r = await checkDuplicateHooks({ home, env: env(fakeBin), isTTY: false });
  assert.equal(r.status, "PASS");
}));

test("duplicate-hooks: same-id dupes warn", async () => withRoot(async ({ home, pkgRoot, fakeBin }) => {
  const hook = join(pkgRoot, "dist", "hooks", "orchestration-claude.js");
  writeClaudeHooks(home, [claudePromptHook(hook), claudePromptHook(join(home, "old", "dist", "hooks", "orchestration-claude.js"))]);
  const r = await checkDuplicateHooks({ home, env: env(fakeBin), isTTY: false });
  assert.equal(r.status, "WARN");
  assert.match(r.detail, /same-id subagent-mcp-orchestration-claude/);
  assert.match(r.detail, /non-TTY: no changes made/);
}));

test("duplicate-hooks: legacy id-less plus id-bearing pair warns", async () => withRoot(async ({ home, pkgRoot, fakeBin }) => {
  const hook = join(pkgRoot, "dist", "hooks", "orchestration-claude.js");
  writeClaudeHooks(home, [claudePromptHook(hook), { type: "command", command: "node", args: [hook] }]);
  const r = await checkDuplicateHooks({ home, env: env(fakeBin), isTTY: false });
  assert.equal(r.status, "WARN");
  assert.match(r.detail, /legacy-pair subagent-mcp-orchestration-claude/);
}));

test("duplicate-hooks: dual-mode keeps plugin and marks user config redundant", async () => withRoot(async ({ home, pkgRoot, fakeBin }) => {
  writePlugin(home);
  writeClaudeHooks(home, [claudePromptHook(join(pkgRoot, "dist", "hooks", "orchestration-claude.js"))]);
  const r = await checkDuplicateHooks({ home, env: env(fakeBin), isTTY: false });
  assert.equal(r.status, "WARN");
  assert.match(r.detail, /dual-mode subagent-mcp-orchestration-claude/);
  assert.match(r.detail, /keep plugin manifest/);
}));

test("duplicate-hooks: repair Y removes duplicate after backup", async () => withRoot(async ({ home, pkgRoot, fakeBin }) => {
  const hook = join(pkgRoot, "dist", "hooks", "orchestration-claude.js");
  const file = join(home, ".claude", "settings.json");
  writeClaudeHooks(home, [claudePromptHook(hook), { type: "command", command: "node", args: [hook] }]);
  const r = await checkDuplicateHooks({
    home,
    env: env(fakeBin),
    isTTY: true,
    input: Readable.from(["y\n"]),
    output: new Writable({ write(_chunk, _enc, cb) { cb(); } }),
  });
  assert.equal(r.status, "WARN");
  assert.match(r.detail, /removed=1 after backup/);
  const after = readFileSync(file, "utf8");
  assert.match(after, /\n  "hooks"/);
  assert.equal(JSON.parse(after).hooks.UserPromptSubmit[0].hooks.length, 1);
  assert.equal(existsSync(join(home, ".subagent-mcp", "backups")), true);
}));

test("duplicate-hooks: repair n leaves config unchanged", async () => withRoot(async ({ home, pkgRoot, fakeBin }) => {
  const hook = join(pkgRoot, "dist", "hooks", "orchestration-claude.js");
  const file = join(home, ".claude", "settings.json");
  writeClaudeHooks(home, [claudePromptHook(hook), { type: "command", command: "node", args: [hook] }]);
  const before = readFileSync(file, "utf8");
  const r = await checkDuplicateHooks({
    home,
    env: env(fakeBin),
    isTTY: true,
    input: Readable.from(["n\n"]),
    output: new Writable({ write(_chunk, _enc, cb) { cb(); } }),
  });
  assert.equal(r.status, "WARN");
  assert.match(r.detail, /removed=0/);
  assert.equal(readFileSync(file, "utf8"), before);
}));

test("duplicate-hooks: non-TTY leaves config unchanged", async () => withRoot(async ({ home, pkgRoot, fakeBin }) => {
  const hook = join(pkgRoot, "dist", "hooks", "orchestration-claude.js");
  const file = join(home, ".claude", "settings.json");
  writeClaudeHooks(home, [claudePromptHook(hook), { type: "command", command: "node", args: [hook] }]);
  const before = readFileSync(file, "utf8");
  const r = await checkDuplicateHooks({ home, env: env(fakeBin), isTTY: false });
  assert.equal(r.status, "WARN");
  assert.match(r.detail, /non-TTY: no changes made/);
  assert.equal(readFileSync(file, "utf8"), before);
}));

test("provider-config: absent providers.jsonc fails with init hint", () => withRoot(({ home }) => {
  const r = checkProviderConfig({ configHome: join(home, ".subagent-mcp") });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /subagent-mcp config init/);
}));

test("provider-config: parse error fails with line info", () => withRoot(({ home }) => {
  const configHome = join(home, ".subagent-mcp");
  mkdirSync(configHome, { recursive: true });
  writeFileSync(join(configHome, "providers.jsonc"), "{\n  nope\n}\n", "utf8");
  const r = checkProviderConfig({ configHome });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /parse error/);
  assert.match(r.detail, /line 2/);
}));

test("env-keys: missing or placeholder key warns without value leakage", () => withRoot(({ home }) => {
  const configHome = join(home, ".subagent-mcp");
  providerConfig(home, {
    a: { key_env: "A_KEY", routing: {} },
    b: { key_env: "B_KEY", routing: {} },
  });
  writeFileSync(join(configHome, ".env"), "A_KEY=YOUR_KEY_HERE\nB_KEY=real-secret\n", "utf8");
  const r = checkEnvKeys({ configHome });
  assert.equal(r.status, "WARN");
  assert.match(r.detail, /A_KEY/);
  assert.doesNotMatch(r.detail, /real-secret/);
}));

test("routing-coverage: zero active slots warns", () => withRoot(({ home }) => {
  const configHome = join(home, ".subagent-mcp");
  providerConfig(home, { a: { routing: { coding: -1 } } });
  const r = checkRoutingCoverage({ configHome });
  assert.equal(r.status, "WARN");
  assert.equal(r.detail, "no API routing active");
}));

test("routing-coverage: reports N of 14 routed categories", () => withRoot(({ home }) => {
  const configHome = join(home, ".subagent-mcp");
  providerConfig(home, { a: { routing: { coding: 1, debugging: 2, fallback_default: 1 } } });
  const r = checkRoutingCoverage({ configHome });
  assert.equal(r.status, "PASS");
  assert.equal(r.detail, "2/14 categories routed");
}));

test("reachability: unreachable probe is INFO only", async () => withRoot(async ({ home }) => {
  const configHome = join(home, ".subagent-mcp");
  providerConfig(home, { a: { base_url: "https://provider.test", routing: {} } });
  const lines = await checkReachability({
    configHome,
    providerHead: async () => ({ ok: false, error: "offline" }),
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].status, "INFO");
  assert.match(lines[0].detail, /unreachable/);
}));

test("update-check: behind warns with upgrade command", async () => {
  const r = await checkUpdate({
    packageInfo: () => ({ name: "@heretyc/subagent-mcp", version: "1.0.0" }),
    fetch: async () => ({ ok: true, json: async () => ({ "dist-tags": { latest: "1.0.1" } }) }),
    registryBaseUrl: "https://registry.example.test",
  });
  assert.equal(r.status, "WARN");
  assert.match(r.detail, /subagent-mcp upgrade/);
});

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
