import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { globalTargetFiles, upsertInitBlock } from "../dist/init.js";
import { runUpgrade } from "../dist/upgrade.js";

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

function rootFixture() {
  const temp = mkdtempSync(join(tmpdir(), "subagent-upgrade-"));
  const home = join(temp, "home");
  const installRoot = join(temp, "install");
  for (const rel of [
    "dist/index.js",
    "dist/hooks/orchestration-claude.js",
    "dist/hooks/orchestration-claude-pretool.js",
    "dist/hooks/orchestration-codex.js",
    "dist/hooks/smcp-activate.js",
  ]) {
    const file = join(installRoot, ...rel.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
  }
  for (const name of ["smcp-config", "smcp-doctor", "smcp-help", "smcp-status", "smcp-handoff"]) {
    const skillDir = join(installRoot, "skills", name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `${name} skill\n`);
    const commandDir = join(installRoot, "commands");
    mkdirSync(commandDir, { recursive: true });
    writeFileSync(join(commandDir, `${name}.toml`), `${name} command\n`);
  }
  return { temp, home, installRoot };
}

async function withRoot(fn) {
  const r = rootFixture();
  try {
    return await fn(r);
  } finally {
    rmSync(r.temp, { recursive: true, force: true });
  }
}

function opts(base, mode, extra = {}) {
  const calls = [];
  return {
    calls,
    options: {
      home: base.home,
      installRoot: base.installRoot,
      isTTY: false,
      detect: () => ({
        mode,
        npmGlobalDist: mode === "marketplace" ? null : join(base.installRoot, "dist", "index.js"),
        marketplaceDists: mode === "npm-global" ? [] : [join(base.installRoot, "dist", "index.js")],
      }),
      backup: () => calls.push(["backup", []]),
      runner: {
        run(command, args) {
          calls.push([command, args]);
          return { status: 0 };
        },
      },
      doctor: async (doctorOpts) => {
        calls.push(["doctor", [doctorOpts.isTTY === false ? "non-tty" : "tty"]]);
        return 0;
      },
      log: () => {},
      ...extra,
    },
  };
}

test("npm-global path backs up before npm install", () => withRoot(async (r) => {
  const o = opts(r, "npm-global");
  assert.equal(await runUpgrade(o.options), 0);
  assert.deepEqual(o.calls.slice(0, 2), [
    ["backup", []],
    ["npm", ["install", "-g", "@heretyc/subagent-mcp@latest"]],
  ]);
  assert.deepEqual(o.calls.at(-1), ["doctor", ["non-tty"]]);
}));

test("marketplace path runs claude plugin update", () => withRoot(async (r) => {
  const o = opts(r, "marketplace");
  assert.equal(await runUpgrade(o.options), 0);
  assert.deepEqual(o.calls.slice(0, 2), [
    ["backup", []],
    ["claude", ["plugin", "update", "subagent-mcp@subagent-mcp"]],
  ]);
}));

test("dual-mode runs npm first, then marketplace", () => withRoot(async (r) => {
  const o = opts(r, "dual-mode");
  assert.equal(await runUpgrade(o.options), 0);
  assert.deepEqual(o.calls.slice(0, 3), [
    ["backup", []],
    ["npm", ["install", "-g", "@heretyc/subagent-mcp@latest"]],
    ["claude", ["plugin", "update", "subagent-mcp@subagent-mcp"]],
  ]);
}));

test("stale hook repair rewrites by canonical id", () => withRoot(async (r) => {
  const oldHook = join(r.temp, "missing", "dist", "hooks", "orchestration-claude.js");
  const settings = join(r.home, ".claude", "settings.json");
  const codexHooks = join(r.home, ".codex", "hooks.json");
  writeJson(settings, {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ id: "subagent-mcp-orchestration-claude", type: "command", command: "node", args: [oldHook] }] }],
    },
  });
  writeJson(codexHooks, {
    hooks: {
      SessionStart: [{ hooks: [{ id: "subagent-mcp-session-start", type: "command", command: `node "${oldHook}"`, commandWindows: null }] }],
    },
  });
  const o = opts(r, "npm-global");
  assert.equal(await runUpgrade(o.options), 0);
  const repaired = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(repaired.hooks.UserPromptSubmit[0].hooks[0].args[0], join(r.installRoot, "dist", "hooks", "orchestration-claude.js").replace(/\\/g, "/"));
  const repairedCodex = JSON.parse(readFileSync(codexHooks, "utf8"));
  const cmd = `node "${join(r.installRoot, "dist", "hooks", "smcp-activate.js").replace(/\\/g, "/")}"`;
  assert.equal(repairedCodex.hooks.SessionStart[0].hooks[0].command, cmd);
  assert.equal(repairedCodex.hooks.SessionStart[0].hooks[0].commandWindows, cmd);
}));

test("init block present updates in place", () => withRoot(async (r) => {
  const target = globalTargetFiles(r.home)[0];
  upsertInitBlock(target);
  writeFileSync(target, readFileSync(target, "utf8").replace("schema=5", "schema=4"), "utf8");
  const o = opts(r, "npm-global");
  assert.equal(await runUpgrade(o.options), 0);
  assert.match(readFileSync(target, "utf8"), /schema=5/);
}));

test("init block absent accepts Y", () => withRoot(async (r) => {
  const o = opts(r, "npm-global", {
    isTTY: true,
    input: Readable.from(["y\n"]),
    output: new Writable({ write(_chunk, _enc, cb) { cb(); } }),
  });
  assert.equal(await runUpgrade(o.options), 0);
  for (const target of globalTargetFiles(r.home)) assert.equal(existsSync(target), true);
}));

test("init block absent rejects n", () => withRoot(async (r) => {
  const o = opts(r, "npm-global", {
    isTTY: true,
    input: Readable.from(["n\n"]),
    output: new Writable({ write(_chunk, _enc, cb) { cb(); } }),
  });
  assert.equal(await runUpgrade(o.options), 0);
  for (const target of globalTargetFiles(r.home)) assert.equal(existsSync(target), false);
}));

test("init block absent non-TTY reports only", () => withRoot(async (r) => {
  const o = opts(r, "npm-global");
  assert.equal(await runUpgrade(o.options), 0);
  for (const target of globalTargetFiles(r.home)) assert.equal(existsSync(target), false);
}));

test("upgrade migrates a legacy deny list silently", () => withRoot(async (r) => {
  const settingsFile = join(r.home, ".claude", "settings.json");
  writeJson(settingsFile, {
    theme: "dark",
    permissions: { allow: ["Read(*)"], deny: ["Task", "Agent", "Explore", "Agent(Explore)", "Write(secret)"] },
  });
  const lines = [];
  const o = opts(r, "npm-global", { log: (line) => lines.push(line) });
  assert.equal(await runUpgrade(o.options), 0);

  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  for (const legacy of ["Task", "Explore", "Agent(Explore)"]) {
    assert.equal(settings.permissions.deny.includes(legacy), false, `${legacy} must be migrated away`);
  }
  assert.equal(settings.permissions.deny.includes("Agent"), true);
  assert.equal(settings.permissions.deny.includes("Write(secret)"), true, "user entry preserved");
  assert.equal(settings.theme, "dark");
  assert.deepEqual(settings.permissions.allow, ["Read(*)"]);
  // Silent: non-TTY upgrade never prompts about the deny list.
  assert.doesNotMatch(lines.join("\n"), /deny[\s\S]{0,40}\[Y\/n\]/i);
}));

test("upgrade deny migration is not gated on a prompt answer", () => withRoot(async (r) => {
  const settingsFile = join(r.home, ".claude", "settings.json");
  writeJson(settingsFile, { permissions: { deny: ["Task", "Explore", "Agent(Explore)"] } });
  const o = opts(r, "npm-global", {
    isTTY: true,
    input: Readable.from(["n\n"]),
    output: new Writable({ write(_chunk, _enc, cb) { cb(); } }),
  });
  assert.equal(await runUpgrade(o.options), 0);

  const deny = JSON.parse(readFileSync(settingsFile, "utf8")).permissions.deny;
  assert.deepEqual(deny, ["Agent"], "declining the init-block prompt must not skip the deny migration");
}));

test("upgrade deny migration is idempotent", () => withRoot(async (r) => {
  const settingsFile = join(r.home, ".claude", "settings.json");
  writeJson(settingsFile, { permissions: { deny: ["Task", "Agent", "Explore", "Write(secret)"] } });

  assert.equal(await runUpgrade(opts(r, "npm-global").options), 0);
  const first = readFileSync(settingsFile, "utf8");

  assert.equal(await runUpgrade(opts(r, "npm-global").options), 0);
  assert.equal(readFileSync(settingsFile, "utf8"), first, "second upgrade must not rewrite the deny list");
}));

test("update deploys smcp skills and slash commands", () => withRoot(async (r) => {
  const o = opts(r, "npm-global");
  assert.equal(await runUpgrade(o.options), 0);
  for (const name of ["smcp-config", "smcp-doctor", "smcp-help", "smcp-status", "smcp-handoff"]) {
    assert.equal(readFileSync(join(r.home, ".claude", "skills", name, "SKILL.md"), "utf8"), `${name} skill\n`);
    assert.equal(readFileSync(join(r.home, ".claude", "commands", `${name}.toml`), "utf8"), `${name} command\n`);
    assert.equal(readFileSync(join(r.home, ".agents", "skills", name, "SKILL.md"), "utf8"), `${name} skill\n`);
  }
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
