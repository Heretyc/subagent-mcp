/**
 * setup-repair.test.mjs — Unit tests for the pure wiring-reconcile helpers in
 * dist/setup.js (the self-repair core of `subagent-mcp setup` / `doctor`).
 *
 * WHY (Rule 9): the old setup treated ANY existing reference to our hook/server
 * as "already present — left as-is", so a wiring entry pointing at a stale path
 * (moved npm prefix, scope rename, dev-tree leftover) stayed broken forever.
 * These tests encode the repair contract:
 *   - exact wiring -> ok (idempotent, no churn),
 *   - stale path   -> repaired IN PLACE (never duplicated),
 *   - absent       -> added,
 *   - unrelated user config (other hooks, other servers, other TOML tables)
 *     is NEVER touched.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findOnPath,
  reconcileClaudeSettings,
  reconcileClaudeJson,
  reconcileCodexToml,
  reconcileCodexHooks,
  claudeAddArgs,
  codexAddArgs,
} from "../dist/setup.js";

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

const HOOK = "C:/global/npm/node_modules/@heretyc/subagent-mcp/dist/hooks/orchestration-claude.js";
const PRETOOL = "C:/global/npm/node_modules/@heretyc/subagent-mcp/dist/hooks/orchestration-claude-pretool.js";
const SERVER = "C:/global/npm/node_modules/@heretyc/subagent-mcp/dist/index.js";
const STALE = "C:/old/dev/tree/dist/hooks/orchestration-claude.js";
const STALE_PRETOOL = "C:/old/dev/tree/dist/hooks/orchestration-claude-pretool.js";

// ---------------------------------------------------------------------------
// reconcileClaudeSettings
// ---------------------------------------------------------------------------
test("claude settings: absent -> added (exec form)", () => {
  const s = {};
  const r = reconcileClaudeSettings(s, HOOK);
  assert.equal(r.status, "added");
  assert.equal(r.changed, true);
  const hk = s.hooks.UserPromptSubmit[0].hooks[0];
  const pre = s.hooks.PreToolUse[0].hooks[0];
  assert.deepEqual(hk, { type: "command", command: "node", args: [HOOK] });
  assert.deepEqual(pre, { type: "command", command: "node", args: [PRETOOL], timeout: 5 });
});

test("claude settings: exact wiring -> ok, nothing changed", () => {
  const s = { hooks: {
    UserPromptSubmit: [{ hooks: [{ type: "command", command: "node", args: [HOOK] }] }],
    PreToolUse: [{ hooks: [{ type: "command", command: "node", args: [PRETOOL], timeout: 5 }] }],
  } };
  const before = JSON.stringify(s);
  const r = reconcileClaudeSettings(s, HOOK);
  assert.equal(r.status, "ok");
  assert.equal(r.changed, false);
  assert.equal(JSON.stringify(s), before, "ok must be a no-op (idempotent)");
});

test("claude settings: stale path -> repaired in place, not duplicated", () => {
  const s = { hooks: {
    UserPromptSubmit: [{ hooks: [{ type: "command", command: "node", args: [STALE] }] }],
    PreToolUse: [{ hooks: [{ type: "command", command: "node", args: [STALE_PRETOOL], timeout: 5 }] }],
  } };
  const r = reconcileClaudeSettings(s, HOOK);
  assert.equal(r.status, "repaired");
  assert.equal(s.hooks.UserPromptSubmit.length, 1, "no duplicate entry");
  assert.deepEqual(s.hooks.UserPromptSubmit[0].hooks[0].args, [HOOK]);
  assert.deepEqual(s.hooks.PreToolUse[0].hooks[0].args, [PRETOOL]);
});

test("claude settings: legacy single-string command form -> repaired to exec form", () => {
  const s = { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: `node "${STALE}"` }] }] } };
  const r = reconcileClaudeSettings(s, HOOK);
  assert.equal(r.status, "repaired");
  const hk = s.hooks.UserPromptSubmit[0].hooks[0];
  assert.equal(hk.command, "node");
  assert.deepEqual(hk.args, [HOOK]);
});

test("claude settings: unrelated hooks are never touched", () => {
  const other = { type: "command", command: "node", args: ["C:/me/my-hook.js"] };
  const s = { hooks: { UserPromptSubmit: [{ hooks: [other] }], PreCompact: [{ hooks: [{ command: "x" }] }] } };
  const r = reconcileClaudeSettings(s, HOOK);
  assert.equal(r.status, "added");
  assert.deepEqual(s.hooks.UserPromptSubmit[0].hooks[0], other, "user's own hook untouched");
  assert.equal(s.hooks.UserPromptSubmit.length, 2, "ours appended alongside");
  assert.deepEqual(s.hooks.PreToolUse[0].hooks[0], {
    type: "command", command: "node", args: [PRETOOL], timeout: 5,
  });
  assert.ok(s.hooks.PreCompact, "other events untouched");
});

// ---------------------------------------------------------------------------
// reconcileClaudeJson
// ---------------------------------------------------------------------------
test("claude.json: absent -> added with CLI-compatible schema", () => {
  const cj = {};
  const r = reconcileClaudeJson(cj, SERVER);
  assert.equal(r.status, "added");
  assert.deepEqual(cj.mcpServers["subagent-mcp"], {
    type: "stdio", command: "subagent-mcp", args: [], env: {},
  });
});

test("claude.json: exact -> ok; stale path -> repaired; other servers preserved", () => {
  const cj = {
    mcpServers: {
      "other-server": { command: "python", args: ["x.py"] },
      "subagent-mcp": { type: "stdio", command: "subagent-mcp", args: [], env: {} },
    },
  };
  assert.equal(reconcileClaudeJson(cj, SERVER).status, "ok");
  cj.mcpServers["subagent-mcp"] = { type: "stdio", command: "node", args: [SERVER], env: {} };
  const r = reconcileClaudeJson(cj, SERVER);
  assert.equal(r.status, "repaired");
  assert.deepEqual(cj.mcpServers["subagent-mcp"], {
    type: "stdio", command: "subagent-mcp", args: [], env: {},
  });
  assert.deepEqual(cj.mcpServers["other-server"], { command: "python", args: ["x.py"] },
    "unrelated server untouched");
});

// ---------------------------------------------------------------------------
// reconcileCodexToml
// ---------------------------------------------------------------------------
test("codex toml: absent block -> appended, existing content preserved", () => {
  const toml = `model = "gpt-5.5"\n\n[mcp_servers.other]\ncommand = "node"\n`;
  const r = reconcileCodexToml(toml, SERVER);
  assert.equal(r.status, "added");
  assert.ok(r.toml.startsWith(toml), "existing content preserved verbatim");
  assert.ok(r.toml.includes(`args = ["${SERVER}"]`));
});

test("codex toml: exact block -> ok, text unchanged", () => {
  const toml = `[mcp_servers.subagent-mcp]\ncommand = "node"\nargs = ["${SERVER}"]\nstartup_timeout_sec = 10\ntool_timeout_sec = 60\n`;
  const r = reconcileCodexToml(toml, SERVER);
  assert.equal(r.status, "ok");
  assert.equal(r.toml, toml);
});

test("codex toml: CLI-written block without timeouts -> ok, text unchanged", () => {
  const toml = `[mcp_servers.subagent-mcp]\ncommand = "node"\nargs = ["${SERVER}"]\n`;
  const r = reconcileCodexToml(toml, SERVER);
  assert.equal(r.status, "ok");
  assert.equal(r.toml, toml);
});

test("codex toml: stale args -> main block rewritten; .tools subtables preserved", () => {
  const toml =
    `[mcp_servers.subagent-mcp]\ncommand = "node"\nargs = ["C:/stale/dist/index.js"]\n\n` +
    `[mcp_servers.subagent-mcp.tools.launch_agent]\napproval_mode = "approve"\n\n` +
    `[mcp_servers.other]\ncommand = "x"\n`;
  const r = reconcileCodexToml(toml, SERVER);
  assert.equal(r.status, "repaired");
  assert.ok(r.toml.includes(`args = ["${SERVER}"]`), "path corrected");
  assert.ok(!r.toml.includes("C:/stale/"), "stale path gone");
  assert.ok(r.toml.includes("[mcp_servers.subagent-mcp.tools.launch_agent]"),
    "tool-approval subtable preserved");
  assert.ok(r.toml.includes("[mcp_servers.other]"), "unrelated table preserved");
});

test("codex toml: empty file -> block created", () => {
  const r = reconcileCodexToml("", SERVER);
  assert.equal(r.status, "added");
  assert.ok(r.toml.includes("[mcp_servers.subagent-mcp]"));
});

// ---------------------------------------------------------------------------
// reconcileCodexHooks
// ---------------------------------------------------------------------------
const CODEX_CMD = `node "C:/global/npm/node_modules/@heretyc/subagent-mcp/dist/hooks/orchestration-codex.js"`;
const CODEX_STALE = `node "C:/stale/dist/hooks/orchestration-codex.js"`;

test("codex hooks: absent -> both events added", () => {
  const h = {};
  const r = reconcileCodexHooks(h, CODEX_CMD);
  assert.deepEqual(r.statuses, { SessionStart: "added", UserPromptSubmit: "added" });
  for (const ev of ["SessionStart", "UserPromptSubmit"]) {
    assert.deepEqual(h.hooks[ev][0].hooks[0], {
      type: "command", command: CODEX_CMD, commandWindows: CODEX_CMD, timeout: 10,
    });
  }
});

test("codex hooks: exact -> ok both events, unchanged", () => {
  const entry = { type: "command", command: CODEX_CMD, commandWindows: CODEX_CMD, timeout: 10 };
  const h = { hooks: { SessionStart: [{ hooks: [entry] }], UserPromptSubmit: [{ hooks: [{ ...entry }] }] } };
  const r = reconcileCodexHooks(h, CODEX_CMD);
  assert.equal(r.changed, false);
  assert.deepEqual(r.statuses, { SessionStart: "ok", UserPromptSubmit: "ok" });
});

test("codex hooks: stale path -> repaired in place; other events' hooks untouched", () => {
  const stale = { type: "command", command: CODEX_STALE, commandWindows: CODEX_STALE, timeout: 10 };
  const mine = { type: "command", command: "node my-other-hook.js", timeout: 5 };
  const h = { hooks: { SessionStart: [{ hooks: [stale] }], UserPromptSubmit: [{ hooks: [mine] }] } };
  const r = reconcileCodexHooks(h, CODEX_CMD);
  assert.equal(r.statuses.SessionStart, "repaired");
  assert.equal(r.statuses.UserPromptSubmit, "added");
  assert.equal(h.hooks.SessionStart[0].hooks[0].command, CODEX_CMD);
  assert.deepEqual(h.hooks.UserPromptSubmit[0].hooks[0], mine, "user's hook untouched");
});

// ---------------------------------------------------------------------------
// findOnPath (injectable env/platform — no dependency on where/which)
// ---------------------------------------------------------------------------
test("findOnPath: finds a .cmd shim via PATHEXT on win32", () => {
  const dir = mkdtempSync(join(tmpdir(), "fop-"));
  try {
    writeFileSync(join(dir, "mycli.cmd"), "@echo off\n");
    const env = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    assert.equal(findOnPath("mycli", env, "win32"), join(dir, "mycli.cmd"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The posix positive case needs colon-free PATH entries, which a Windows temp
// dir (C:\...) cannot provide — a drive letter would be split as a PATH
// separator. Run it only on posix hosts (mirrors the isWin gating in
// orchestration-marker.test.mjs).
if (process.platform !== "win32") {
  test("findOnPath: finds a plain executable on posix", () => {
    const dir = mkdtempSync(join(tmpdir(), "fop-"));
    try {
      writeFileSync(join(dir, "mycli"), "#!/bin/sh\n");
      const env = { PATH: `${join(dir, "nope")}:${dir}` };
      assert.equal(findOnPath("mycli", env, "linux"), join(dir, "mycli"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("findOnPath: posix lookup misses -> null (colon-free fake paths)", () => {
  const env = { PATH: "/nope/a:/nope/b" };
  assert.equal(findOnPath("not-there", env, "linux"), null);
});

test("findOnPath: empty PATH -> null (never throws)", () => {
  assert.equal(findOnPath("anything", {}, "linux"), null);
  assert.equal(findOnPath("anything", {}, "win32"), null);
});

// ---------------------------------------------------------------------------
// vendor CLI argv contracts
// ---------------------------------------------------------------------------
test("claudeAddArgs: official user-scope shim registration argv", () => {
  assert.deepEqual(claudeAddArgs(), ["mcp", "add", "subagent-mcp", "subagent-mcp", "-s", "user"]);
});

test("codexAddArgs: official node server registration argv", () => {
  assert.deepEqual(codexAddArgs(SERVER), ["mcp", "add", "subagent-mcp", "--", "node", SERVER]);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
