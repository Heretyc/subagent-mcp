import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pkg from "../package.json" with { type: "json" };
import { verificationSummary } from "../scripts/postinstall.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

const hookRegistrationFiles = [
  "src/setup.ts",
  "scripts/postinstall.mjs",
  "hooks/hooks.json",
];

function read(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function withVerifyFixture(fn) {
  const root = join(tmpdir(), `postinstall-root-${process.pid}-${Date.now()}-${Math.random()}`);
  const home = join(tmpdir(), `postinstall-home-${process.pid}-${Date.now()}-${Math.random()}`);
  try {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "index.js"), "#!/usr/bin/env node\n");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeJson(join(home, ".claude.json"), {
      mcpServers: { "subagent-mcp": { type: "stdio", command: "node", args: [join(root, "dist", "index.js")] } },
    });
    writeJson(join(home, ".claude", "settings.json"), {
      hooks: {
        PreToolUse: [{ hooks: [{ id: "subagent-mcp-pretool" }] }],
        UserPromptSubmit: [{ hooks: [{ id: "subagent-mcp-orchestration-claude" }] }],
      },
    });
    writeFileSync(join(home, ".codex", "config.toml"),
      `[mcp_servers.subagent-mcp]\ncommand = "node"\nargs = ["${join(root, "dist", "index.js").replace(/\\/g, "/")}"]\n`);
    writeJson(join(home, ".codex", "hooks.json"), {
      hooks: {
        SessionStart: [{ hooks: [{ command: 'node "dist/hooks/orchestration-codex.js"' }] }],
        UserPromptSubmit: [{ hooks: [{ command: 'node "dist/hooks/orchestration-codex.js"' }] }],
      },
    });
    fn({ root, home });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

test("install paths do not register PostToolUse hooks", () => {
  for (const path of hookRegistrationFiles) {
    assert.doesNotMatch(read(path), /\bPostToolUse\b/, `${path} must not register PostToolUse`);
  }
});

test("hooks manifest contains no output-adjacent PostToolUse hook", () => {
  const manifest = JSON.parse(read("hooks/hooks.json"));
  assert.ok(manifest && typeof manifest === "object");
  assert.ok(manifest.hooks && typeof manifest.hooks === "object");
  assert.equal(Object.hasOwn(manifest.hooks, "PostToolUse"), false);
});

test("hooks manifest uses stable ids and bare node commands", () => {
  const manifest = readJson("hooks/hooks.json");
  const pretool = manifest.hooks.PreToolUse[0].hooks[0];
  const prompt = manifest.hooks.UserPromptSubmit[0].hooks[0];
  const session = manifest.hooks.SessionStart[0].hooks[0];
  assert.equal(pretool.id, "subagent-mcp-pretool");
  assert.equal(prompt.id, "subagent-mcp-orchestration-claude");
  assert.deepEqual(session, {
    id: "subagent-mcp-session-start",
    type: "command",
    command: "node dist/hooks/smcp-activate.js",
    commandWindows: null,
    timeout: 5,
  });
  assert.match(pretool.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\//);
  assert.match(prompt.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\//);
  assert.doesNotMatch(JSON.stringify(manifest), /\bsh\s+-c\b/);
});

test("Codex plugin manifest points at the repo hook template", () => {
  const manifest = readJson(".codex-plugin/plugin.json");
  assert.equal(manifest.name, "subagent-mcp");
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.hooks, "./codex/hooks.json");
});

test("Codex hook template uses plugin-relative dist paths", () => {
  const manifest = readJson("codex/hooks.json");
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /ABS\/PATH\/TO|Dropbox/);
  assert.doesNotMatch(text, /(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|opt|usr)\b)/);
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    const hook = manifest.hooks[event][0].hooks[0];
    assert.equal(hook.command, 'node "${PLUGIN_DIR}/dist/hooks/orchestration-codex.js"');
    assert.equal(hook.commandWindows, 'node "${PLUGIN_DIR}/dist/hooks/orchestration-codex.js"');
  }
});

test("Codex marketplace exposes the Git-backed plugin", () => {
  const marketplace = readJson(".agents/plugins/marketplace.json");
  assert.equal(marketplace.name, "subagent-mcp");
  assert.equal(marketplace.interface.displayName, "subagent-mcp");
  assert.equal(marketplace.plugins.length, 1);
  assert.deepEqual(marketplace.plugins[0], {
    name: "subagent-mcp",
    source: {
      source: "url",
      url: "https://github.com/Heretyc/subagent-mcp.git",
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Productivity",
  });
});

function runActivate(home) {
  return spawnSync(process.execPath, [join("dist", "hooks", "smcp-activate.js")], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HOMEDRIVE: "",
      HOMEPATH: "",
    },
  });
}

test("smcp-activate nudges only when providers config is absent", () => {
  const home = join(tmpdir(), `smcp-activate-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(home, { recursive: true });
    let result = runActivate(home);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "No providers configured. Run: subagent-mcp doctor\n");

    mkdirSync(join(home, ".subagent-mcp"), { recursive: true });
    writeFileSync(join(home, ".subagent-mcp", "providers.jsonc"), "{}\n", "utf8");
    result = runActivate(home);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install paths do not target poll_agent or wait from hook registration", () => {
  const outputAdjacent = /\bPostToolUse\b[\s\S]{0,400}\b(?:poll_agent|wait|stdout_tail|stderr_tail|final_output)\b|\b(?:poll_agent|wait|stdout_tail|stderr_tail|final_output)\b[\s\S]{0,400}\bPostToolUse\b/;
  for (const path of hookRegistrationFiles) {
    assert.doesNotMatch(read(path), outputAdjacent, `${path} must not add output-adjacent hooks`);
  }
});

test("postinstall verification: all user-config wiring passes", () => {
  withVerifyFixture(({ root, home }) => {
    const { rows, text } = verificationSummary({ root, home });
    assert.deepEqual(rows.map((r) => [r.vendor, r.ok]), [["Claude", true], ["Codex", true]]);
    assert.match(text, /Claude\s+PASS/);
    assert.match(text, /Codex\s+PASS/);
  });
});

test("postinstall verification: missing hook id fails with guidance", () => {
  withVerifyFixture(({ root, home }) => {
    writeJson(join(home, ".claude", "settings.json"), {
      hooks: { UserPromptSubmit: [{ hooks: [{ id: "subagent-mcp-orchestration-claude" }] }] },
    });
    const { rows, text } = verificationSummary({ root, home });
    assert.equal(rows.find((r) => r.vendor === "Claude").ok, false);
    assert.match(text, /Claude\s+FAIL/);
    assert.match(text, /Guidance: inspect ~\/\.claude\.json/);
    assert.match(text, /subagent-mcp doctor/);
  });
});

test("postinstall verification: marketplace hooks pass without user-config hooks", () => {
  withVerifyFixture(({ root, home }) => {
    writeJson(join(home, ".claude", "settings.json"), { hooks: {} });
    writeJson(join(home, ".codex", "hooks.json"), { hooks: {} });
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    mkdirSync(join(root, ".codex-plugin"), { recursive: true });
    mkdirSync(join(root, "hooks"), { recursive: true });
    mkdirSync(join(root, "codex"), { recursive: true });
    writeJson(join(root, ".claude-plugin", "plugin.json"), { hooks: "./hooks/hooks.json" });
    writeJson(join(root, "hooks", "hooks.json"), {
      hooks: {
        PreToolUse: [{ hooks: [{ id: "subagent-mcp-pretool" }] }],
        UserPromptSubmit: [{ hooks: [{ id: "subagent-mcp-orchestration-claude" }] }],
        SessionStart: [{ hooks: [{ id: "subagent-mcp-session-start" }] }],
      },
    });
    writeJson(join(root, ".codex-plugin", "plugin.json"), { hooks: "./codex/hooks.json" });
    writeJson(join(root, "codex", "hooks.json"), {
      hooks: {
        SessionStart: [{ hooks: [{ command: 'node "${PLUGIN_DIR}/dist/hooks/orchestration-codex.js"' }] }],
        UserPromptSubmit: [{ hooks: [{ command: 'node "${PLUGIN_DIR}/dist/hooks/orchestration-codex.js"' }] }],
      },
    });
    const { rows, text } = verificationSummary({ root, home });
    assert.deepEqual(rows.map((r) => [r.vendor, r.ok]), [["Claude", true], ["Codex", true]]);
    assert.match(text, /plugin-manifest/);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
