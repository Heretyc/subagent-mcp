/**
 * setup-wire.test.mjs — Unit tests for the vendor-agnostic wireMcpServer
 * driver policy in dist/setup.js, with injected ExecDeps fakes.
 *
 * WHY (Rule 9): the per-vendor wiring previously had three policy bugs:
 *   - a CLI registration failure on the "file already canonical" path was
 *     reported as "already correct" instead of a failure;
 *   - when the CLI verified but the on-disk config diverged from canonical,
 *     the stale file was silently kept (claude) / never read back (codex).
 * The driver contract under test: CLI-first -> read-back -> reconcile ->
 * unconditional canonical write on divergence -> fail ONLY when neither the
 * CLI registration nor the file fallback took. Dry-run never writes or fails.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SERVER_NAME,
  serverPaths,
  vendorWireSpecs,
  wireMcpServer,
  registrationDetail,
  reconcileClaudeSettings,
  deployHandoffResumeSkill,
  deploySmcpSkillsAndCommands,
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

const ROOT = "C:/fake-install-root";
const P = serverPaths(ROOT); // server: C:/fake-install-root/dist/index.js

/** Fake exec seams: `listed` controls whether mcp get/list output contains the
 *  server name; the fake CLI never touches any file. */
function fakeDeps({ listed = false, dryRun = false } = {}) {
  return {
    run: () => true,
    capture: () => ({
      ok: true,
      stdout: listed ? `${SERVER_NAME}: ${SERVER_NAME}  - ✓ Connected` : "No MCP servers configured",
    }),
    dryRun,
  };
}

const CANON_CLAUDE_ENTRY = { type: "stdio", command: "subagent-mcp", args: [], env: {} };
const STALE_CLAUDE_ENTRY = { type: "stdio", command: "node", args: ["C:/stale/dist/index.js"], env: {} };
const CANON_CODEX_TOML = `[mcp_servers.subagent-mcp]\ncommand = "node"\nargs = ["${P.server}"]\n`;
const STALE_CODEX_TOML = `[mcp_servers.subagent-mcp]\ncommand = "node"\nargs = ["C:/stale/dist/index.js"]\n`;

function shellQuoteInner(command) {
  return process.platform === "win32"
    ? JSON.stringify(command)
    : `'${command.replace(/'/g, "'\\''")}'`;
}

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "wire-home-"));
  try {
    fn(home, vendorWireSpecs(P, home));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function withSkillRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "wire-root-"));
  try {
    const skillDir = join(root, "skills", "handoff-resume");
    mkdirSync(skillDir, { recursive: true });
    const source = join(skillDir, "SKILL.md");
    writeFileSync(source, "package skill\n");
    fn(root, source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeSmcpAssets(root) {
  for (const name of ["smcp-doctor", "smcp-help", "smcp-status"]) {
    const skillDir = join(root, "skills", name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `${name} skill\n`);
    writeFileSync(join(skillDir, "notes.txt"), `${name} sibling\n`);
    const commandDir = join(root, "commands");
    mkdirSync(commandDir, { recursive: true });
    writeFileSync(join(commandDir, `${name}.toml`), `${name} command\n`);
  }
}

const backupsIn = (dir, base) =>
  readdirSync(dir).filter((f) => f.startsWith(`${base}.bak-setup-`));

// ---------------------------------------------------------------------------
// Finding 1: canonical file but CLI registration never takes -> reported failure
// ---------------------------------------------------------------------------
test("claude: canonical file + CLI verify always false -> failure, no write", () => {
  withHome((home, specs) => {
    const file = join(home, ".claude.json");
    const before = JSON.stringify({ mcpServers: { [SERVER_NAME]: CANON_CLAUDE_ENTRY } }, null, 2);
    writeFileSync(file, before);
    const r = wireMcpServer(specs.claude, fakeDeps({ listed: false }));
    assert.equal(typeof r.failure, "string", "must surface a failure, not 'already correct'");
    assert.equal(r.registered, false);
    assert.equal(r.wroteFile, false);
    assert.equal(readFileSync(file, "utf8"), before, "canonical file untouched");
    assert.deepEqual(backupsIn(home, ".claude.json"), [], "no backup churn");
  });
});

test("codex: canonical file + CLI verify always false -> failure, no write", () => {
  withHome((home, specs) => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(specs.codex.configFile, CANON_CODEX_TOML);
    const r = wireMcpServer(specs.codex, fakeDeps({ listed: false }));
    assert.equal(typeof r.failure, "string");
    assert.equal(r.wroteFile, false);
    assert.equal(readFileSync(specs.codex.configFile, "utf8"), CANON_CODEX_TOML);
    assert.deepEqual(backupsIn(join(home, ".codex"), "config.toml"), []);
  });
});

// ---------------------------------------------------------------------------
// Findings 3+4: CLI verifies but file diverges -> canonical write + backup
// ---------------------------------------------------------------------------
test("claude: stale file + CLI that verifies but never writes -> canonical rewrite + backup", () => {
  withHome((home, specs) => {
    const file = join(home, ".claude.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { [SERVER_NAME]: STALE_CLAUDE_ENTRY } }, null, 2));
    const r = wireMcpServer(specs.claude, fakeDeps({ listed: true }));
    assert.equal(r.status, "repaired");
    assert.equal(r.registered, true);
    assert.equal(r.wroteFile, true, "divergent file must be rewritten even though CLI verified");
    assert.equal(r.failure, null);
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(onDisk.mcpServers[SERVER_NAME], CANON_CLAUDE_ENTRY, "canonical form on disk");
    assert.equal(backupsIn(home, ".claude.json").length, 1, "pre-edit backup created");
  });
});

test("codex: stale file + CLI that verifies but never writes -> canonical rewrite + backup", () => {
  withHome((home, specs) => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(specs.codex.configFile, STALE_CODEX_TOML);
    const r = wireMcpServer(specs.codex, fakeDeps({ listed: true }));
    assert.equal(r.status, "repaired");
    assert.equal(r.registered, true);
    assert.equal(r.wroteFile, true);
    assert.equal(r.failure, null);
    const onDisk = readFileSync(specs.codex.configFile, "utf8");
    assert.ok(onDisk.includes(`args = ["${P.server}"]`), "canonical path on disk");
    assert.ok(!onDisk.includes("C:/stale/"), "stale path gone");
    assert.equal(backupsIn(join(home, ".codex"), "config.toml").length, 1);
  });
});

// ---------------------------------------------------------------------------
// File fallback: CLI never takes but the direct write does -> not a failure
// ---------------------------------------------------------------------------
test("claude: stale file + CLI verify false -> file fallback write, no failure", () => {
  withHome((home, specs) => {
    const file = join(home, ".claude.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { [SERVER_NAME]: STALE_CLAUDE_ENTRY } }, null, 2));
    const r = wireMcpServer(specs.claude, fakeDeps({ listed: false }));
    assert.equal(r.registered, false);
    assert.equal(r.wroteFile, true);
    assert.equal(r.failure, null, "file fallback succeeded -> not a failure");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).mcpServers[SERVER_NAME], CANON_CLAUDE_ENTRY);
  });
});

test("codex: no ~/.codex at all + CLI verify false -> dir+file created, no failure", () => {
  withHome((home, specs) => {
    const r = wireMcpServer(specs.codex, fakeDeps({ listed: false }));
    assert.equal(r.status, "added");
    assert.equal(r.wroteFile, true);
    assert.equal(r.failure, null);
    assert.ok(existsSync(specs.codex.configFile), "config.toml created via ensureDir");
    assert.ok(readFileSync(specs.codex.configFile, "utf8").includes(`args = ["${P.server}"]`));
  });
});

// ---------------------------------------------------------------------------
// Dry-run: never writes, never fails
// ---------------------------------------------------------------------------
test("dry-run: stale file -> no write, no backup, no failure", () => {
  withHome((home, specs) => {
    const file = join(home, ".claude.json");
    const before = JSON.stringify({ mcpServers: { [SERVER_NAME]: STALE_CLAUDE_ENTRY } }, null, 2);
    writeFileSync(file, before);
    const r = wireMcpServer(specs.claude, fakeDeps({ listed: false, dryRun: true }));
    assert.equal(r.wroteFile, false);
    assert.equal(r.failure, null);
    assert.equal(readFileSync(file, "utf8"), before, "dry-run must not touch the file");
    assert.deepEqual(backupsIn(home, ".claude.json"), []);
  });
});

// ---------------------------------------------------------------------------
// Finding 5: registrationDetail branch strings
// ---------------------------------------------------------------------------
test("registrationDetail: all four branches", () => {
  assert.equal(registrationDetail(true, false), "registered");
  assert.equal(registrationDetail(true, true), "repaired");
  assert.equal(registrationDetail(false, true), "not registered; CLI repair failed");
  assert.equal(registrationDetail(false, false), "not registered — run: subagent-mcp doctor");
});

// ---------------------------------------------------------------------------
// Claude statusLine wiring stays isolated to parsed settings objects
// ---------------------------------------------------------------------------
test("claude settings: empty settings registers statusLine shim", () => {
  const s = {};
  const r = reconcileClaudeSettings(s, P.claudeHook);
  assert.equal(r.status, "added");
  assert.deepEqual(s.statusLine, {
    type: "command",
    command: `node "${P.claudeStatuslineHook}"`,
  });
});

test("claude settings: statusLine foreign command wraps once and is idempotent", () => {
  const s = {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "node", args: [P.claudeHook] }] }],
      PreToolUse: [{ hooks: [{ type: "command", command: "node", args: [P.claudePreToolHook], timeout: 5 }] }],
    },
    statusLine: { type: "command", command: "starship prompt" },
  };
  const first = reconcileClaudeSettings(s, P.claudeHook);
  const afterFirst = JSON.stringify(s);
  const second = reconcileClaudeSettings(s, P.claudeHook);
  assert.equal(first.status, "repaired");
  assert.deepEqual(s.statusLine, {
    type: "command",
    command: `node "${P.claudeStatuslineHook}" ${shellQuoteInner("starship prompt")}`,
  });
  assert.equal(second.status, "ok");
  assert.equal(JSON.stringify(s), afterFirst, "second run must not double-wrap or churn");
});

// ---------------------------------------------------------------------------
// Claude handoff-resume skill deployment
// ---------------------------------------------------------------------------
test("handoff-resume skill: setup deploys package copy", () => {
  withHome((home) => withSkillRoot((root, source) => {
    const r = deployHandoffResumeSkill(root, home);
    const target = join(home, ".claude", "skills", "handoff-resume", "SKILL.md");
    assert.equal(r.status, "added");
    assert.equal(r.changed, true);
    assert.equal(readFileSync(target, "utf8"), readFileSync(source, "utf8"));
  }));
});

test("handoff-resume skill: second setup is unchanged", () => {
  withHome((home) => withSkillRoot((root) => {
    deployHandoffResumeSkill(root, home);
    const r = deployHandoffResumeSkill(root, home);
    assert.equal(r.status, "ok");
    assert.equal(r.changed, false);
  }));
});

test("handoff-resume skill: user-modified target is restored", () => {
  withHome((home) => withSkillRoot((root, source) => {
    deployHandoffResumeSkill(root, home);
    const target = join(home, ".claude", "skills", "handoff-resume", "SKILL.md");
    writeFileSync(target, "user edit\n");
    const r = deployHandoffResumeSkill(root, home);
    assert.equal(r.status, "repaired");
    assert.equal(r.changed, true);
    assert.equal(readFileSync(target, "utf8"), readFileSync(source, "utf8"));
  }));
});

test("smcp skills and commands: setup deploys skills, siblings, and slash commands", () => {
  withHome((home) => withSkillRoot((root) => {
    writeSmcpAssets(root);
    const r = deploySmcpSkillsAndCommands(root, home);
    assert.equal(r.status, "added");
    assert.equal(r.changed, true);
    for (const name of ["smcp-doctor", "smcp-help", "smcp-status"]) {
      assert.equal(readFileSync(join(home, ".claude", "skills", name, "SKILL.md"), "utf8"), `${name} skill\n`);
      assert.equal(readFileSync(join(home, ".claude", "skills", name, "notes.txt"), "utf8"), `${name} sibling\n`);
      assert.equal(readFileSync(join(home, ".claude", "commands", `${name}.toml`), "utf8"), `${name} command\n`);
    }
  }));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
