import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkInstallMode, checkMcpRegistration } from "../dist/doctor.js";

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
