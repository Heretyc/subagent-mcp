/**
 * native-suppression.test.mjs - native sub-agent suppression reconcilers.
 *
 * WHY: the Claude deny list is a *managed* set. It must converge on the single
 * canonical rule ("Agent"), actively remove the legacy rules we used to write
 * ("Task", "Explore", "Agent(Explore)"), never disturb user-authored deny
 * entries, and be idempotent so repeated setup/init/upgrade runs are no-ops.
 * Denying bare "Task" is what regressed the harness TaskCreate/TaskUpdate
 * tools, so the canonical list is pinned literally here.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  CLAUDE_NATIVE_AGENT_DENY,
  GEMINI_NATIVE_AGENT_POLICY,
  ensureNativeAgentSuppression,
  geminiNativeAgentPolicyOk,
  reconcileClaudeNativeAgentDeny,
  reconcileCodexNativeAgentDisable,
  reconcileGeminiSettings,
  removeClaudeNativeAgentDeny,
  removeNativeAgentDenyFromClaudeSettings,
} from "../dist/native-suppression.js";

/** Rules earlier versions wrote that must now be actively removed. */
const LEGACY_CLAUDE_DENY = ["Task", "Explore", "Agent(Explore)"];

/** Harness tools that must never be gated by the native-agent deny list. */
const MUST_STAY_ALLOWED = ["TaskCreate", "TaskUpdate"];

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

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "native-suppression-"));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Relative order of `subset` inside `list`, ignoring anything else. */
function orderOf(list, subset) {
  return list.filter((v) => subset.includes(v));
}

test("claude: canonical deny is exactly [\"Agent\"] and cannot gate TaskCreate/TaskUpdate", () => {
  assert.deepEqual([...CLAUDE_NATIVE_AGENT_DENY], ["Agent"]);
  for (const legacy of LEGACY_CLAUDE_DENY) {
    assert.equal(
      CLAUDE_NATIVE_AGENT_DENY.includes(legacy),
      false,
      `legacy rule ${legacy} must not be part of the canonical list`
    );
  }
  for (const tool of MUST_STAY_ALLOWED) {
    for (const rule of CLAUDE_NATIVE_AGENT_DENY) {
      assert.equal(
        tool === rule || tool.startsWith(rule),
        false,
        `deny rule ${rule} matches ${tool}; that is the regression this list reverts`
      );
    }
  }
});

test("claude: adds canonical deny to settings that have no permissions block", () => {
  const s = { theme: "dark" };
  const r = reconcileClaudeNativeAgentDeny(s);
  assert.equal(r.changed, true);
  assert.equal(r.status, "added");
  assert.equal(s.theme, "dark");
  assert.deepEqual(s.permissions.deny, ["Agent"]);
});

test("claude: removes legacy deny rules and keeps user entries", () => {
  const s = {
    theme: "dark",
    permissions: {
      allow: ["Read(*)"],
      deny: ["Task", "Write(secret)", "Explore", "Agent(Explore)", "Bash(rm:*)"],
    },
  };
  const r = reconcileClaudeNativeAgentDeny(s);
  assert.equal(r.changed, true);
  assert.equal(r.status, "repaired");

  const deny = s.permissions.deny;
  for (const legacy of LEGACY_CLAUDE_DENY) {
    assert.equal(deny.includes(legacy), false, `legacy rule ${legacy} must be removed`);
  }
  assert.equal(deny.includes("Agent"), true, "canonical rule must be present");

  // User-authored entries survive, in their original relative order.
  assert.deepEqual(orderOf(deny, ["Write(secret)", "Bash(rm:*)"]), ["Write(secret)", "Bash(rm:*)"]);

  // Nothing else in the settings tree is disturbed.
  assert.equal(s.theme, "dark");
  assert.deepEqual(s.permissions.allow, ["Read(*)"]);
});

test("claude: legacy-only deny list collapses to the canonical rule", () => {
  const s = { permissions: { deny: [...LEGACY_CLAUDE_DENY] } };
  const r = reconcileClaudeNativeAgentDeny(s);
  assert.equal(r.changed, true);
  assert.deepEqual(s.permissions.deny, ["Agent"]);
});

test("claude: user entries that merely look like agent rules are preserved", () => {
  const s = { permissions: { deny: ["TaskCreate", "TaskUpdate", "AgentSomething"] } };
  reconcileClaudeNativeAgentDeny(s);
  for (const kept of ["TaskCreate", "TaskUpdate", "AgentSomething"]) {
    assert.equal(s.permissions.deny.includes(kept), true, `${kept} is user-authored and must survive`);
  }
});

test("claude: reconcile is idempotent once migrated", () => {
  const s = { permissions: { allow: ["Read(*)"], deny: ["Task", "Write(secret)", "Agent(Explore)"] } };
  const first = reconcileClaudeNativeAgentDeny(s);
  assert.equal(first.changed, true);
  const afterFirst = JSON.stringify(s);

  const second = reconcileClaudeNativeAgentDeny(s);
  assert.equal(second.changed, false);
  assert.equal(second.status, "ok");
  assert.equal(JSON.stringify(s), afterFirst);

  const third = reconcileClaudeNativeAgentDeny(s);
  assert.equal(third.changed, false);
  assert.equal(JSON.stringify(s), afterFirst);
});

test("claude: already-canonical settings report ok without rewriting", () => {
  const s = { permissions: { deny: ["Agent", "Write(secret)"] } };
  const r = reconcileClaudeNativeAgentDeny(s);
  assert.equal(r.changed, false);
  assert.equal(r.status, "ok");
  assert.deepEqual(s.permissions.deny, ["Agent", "Write(secret)"]);
});

test("codex: preserves toml and forces [features] multi_agent=false", () => {
  const toml = `model = "gpt-5"\n\n[features]\nhooks = true\nmulti_agent = true\n\n[mcp_servers.other]\ncommand = "node"\n`;
  const first = reconcileCodexNativeAgentDisable(toml);
  assert.equal(first.status, "repaired");
  assert.match(first.toml, /model = "gpt-5"/);
  assert.match(first.toml, /hooks = true/);
  assert.match(first.toml, /^\s*multi_agent = false$/m);
  assert.match(first.toml, /\[mcp_servers\.other\]/);
  const second = reconcileCodexNativeAgentDisable(first.toml);
  assert.equal(second.status, "ok");
  assert.equal(second.toml, first.toml);
});

test("codex: repairs non-boolean multi_agent in place without duplicating it", () => {
  const toml = `[features]\nmulti_agent = "yes" # stale bad value\nhooks = true\n`;
  const first = reconcileCodexNativeAgentDisable(toml);
  assert.equal(first.status, "repaired");
  assert.equal((first.toml.match(/multi_agent\s*=/g) ?? []).length, 1);
  assert.match(first.toml, /^multi_agent = false # stale bad value$/m);
});

test("gemini: preserves settings and policy denies known native tools", () => {
  const s = { mcpServers: { keep: { command: "node" } }, experimental: { old: true, enableAgents: true } };
  const first = reconcileGeminiSettings(s);
  assert.equal(first.status, "repaired");
  assert.equal(s.experimental.enableAgents, false);
  assert.equal(s.experimental.old, true);
  assert.equal(s.mcpServers.keep.command, "node");
});

test("gemini: policy check keeps each rule independent", () => {
  const borrowedDeny = `
[[rule]]
toolName = "generalist"
decision = "allow"

[[rule]]
toolName = "codebase_investigator"
decision = "deny"

[[rule]]
toolName = "cli_help"
decision = "deny"

[[rule]]
toolName = "browser_agent"
decision = "deny"
`;
  assert.equal(geminiNativeAgentPolicyOk(borrowedDeny), false);
});

test("ensureNativeAgentSuppression: writes only fake home, backs up existing files, idempotent", () => withHome((home) => {
  writeJson(join(home, ".claude", "settings.json"), { keep: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".codex", "config.toml"), `model = "gpt-5"\n`, "utf8");
  writeJson(join(home, ".gemini", "settings.json"), { mcpServers: { keep: {} } });

  const first = ensureNativeAgentSuppression(home, ["claude", "codex", "gemini"]);
  assert.equal(first.every((r) => r.changed), true);
  assert.equal(existsSync(join(home, ".claude", "settings.json")), true);
  assert.equal(existsSync(join(home, ".codex", "config.toml")), true);
  assert.equal(existsSync(join(home, ".gemini", "settings.json")), true);
  assert.equal(geminiNativeAgentPolicyOk(readFileSync(join(home, ".gemini", "policies", GEMINI_NATIVE_AGENT_POLICY), "utf8")), true);
  assert.equal(readdirSync(join(home, ".claude")).some((f) => f.includes(".bak-native-agent-")), true);
  assert.equal(readdirSync(join(home, ".codex")).some((f) => f.includes(".bak-native-agent-")), true);
  assert.equal(readdirSync(join(home, ".gemini")).some((f) => f.includes(".bak-native-agent-")), true);

  const second = ensureNativeAgentSuppression(home, ["claude", "codex", "gemini"]);
  assert.equal(second.every((r) => !r.changed), true);
}));

test("ensureNativeAgentSuppression: migrates a legacy deny list on disk, then no-ops", () => withHome((home) => {
  const settings = join(home, ".claude", "settings.json");
  writeJson(settings, {
    theme: "dark",
    permissions: { allow: ["Read(*)"], deny: ["Task", "Agent", "Explore", "Agent(Explore)", "Write(secret)"] },
  });

  const first = ensureNativeAgentSuppression(home, ["claude"]);
  assert.equal(first.length, 1);
  assert.equal(first[0].changed, true);

  const migrated = readJson(settings);
  assert.deepEqual(orderOf(migrated.permissions.deny, [...LEGACY_CLAUDE_DENY]), []);
  assert.equal(migrated.permissions.deny.includes("Agent"), true);
  assert.equal(migrated.permissions.deny.includes("Write(secret)"), true);
  assert.equal(migrated.theme, "dark");
  assert.deepEqual(migrated.permissions.allow, ["Read(*)"]);

  const body = readFileSync(settings, "utf8");
  const second = ensureNativeAgentSuppression(home, ["claude"]);
  assert.equal(second[0].changed, false);
  assert.equal(second[0].status, "ok");
  assert.equal(readFileSync(settings, "utf8"), body, "idempotent run must not rewrite the file");
}));

test("ensureNativeAgentSuppression: dry run reports the migration without touching disk", () => withHome((home) => {
  const settings = join(home, ".claude", "settings.json");
  writeJson(settings, { permissions: { deny: ["Task", "Explore"] } });
  const before = readFileSync(settings, "utf8");

  const r = ensureNativeAgentSuppression(home, ["claude"], { dryRun: true });
  assert.equal(r[0].changed, true);
  assert.equal(readFileSync(settings, "utf8"), before);
}));

// ---------------------------------------------------------------------------
// Removal primitives (the windowed-doctrine deny toggle's other half). Removal
// is the exact inverse of the reconciler: only smcp-owned rules go, and no
// sidecar restore state is needed because smcp only ever appends its own rules.
// ---------------------------------------------------------------------------

test("removeClaudeNativeAgentDeny: drops only smcp-owned rules, keeps the rest", () => {
  const json = {
    permissions: { deny: ["custom-a", "Agent", "Task", "custom-b"], allow: ["Read(*)"] },
    theme: "dark",
  };
  assert.equal(removeClaudeNativeAgentDeny(json), 2);
  assert.deepEqual(json.permissions.deny, ["custom-a", "custom-b"]);
  assert.deepEqual(json.permissions.allow, ["Read(*)"]);
  assert.equal(json.theme, "dark");
});

test("removeClaudeNativeAgentDeny: deletes empty deny and permissions containers", () => {
  const json = { permissions: { deny: ["Agent"] } };
  assert.equal(removeClaudeNativeAgentDeny(json), 1);
  assert.equal("permissions" in json, false);
  assert.equal(removeClaudeNativeAgentDeny({ permissions: { deny: ["user-rule"] } }), 0);
  assert.equal(removeClaudeNativeAgentDeny(null), 0);
  assert.equal(removeClaudeNativeAgentDeny({}), 0);
});

test("removeNativeAgentDenyFromClaudeSettings: backup + surgical write; roundtrips with the reconciler", () => withHome((home) => {
  const settings = join(home, ".claude", "settings.json");
  writeJson(settings, { permissions: { deny: ["Agent", "user-rule"], allow: ["Bash(ls:*)"] }, theme: "dark" });

  const removed = removeNativeAgentDenyFromClaudeSettings(home);
  assert.equal(removed.changed, true);
  assert.equal(removed.removed, 1);
  const after = readJson(settings);
  assert.deepEqual(after.permissions.deny, ["user-rule"]);
  assert.deepEqual(after.permissions.allow, ["Bash(ls:*)"]);
  assert.equal(after.theme, "dark");
  assert.equal(
    readdirSync(dirname(settings)).some((f) => f.startsWith("settings.json.bak-native-agent-")),
    true,
    "a timestamped backup precedes the removal"
  );

  // Idempotent: nothing left to remove.
  const again = removeNativeAgentDenyFromClaudeSettings(home);
  assert.equal(again.changed, false);
  assert.equal(again.removed, 0);

  // The reconciler restores the canonical entry exactly (the toggle's other direction).
  ensureNativeAgentSuppression(home, ["claude"]);
  const restored = readJson(settings);
  assert.equal(restored.permissions.deny.includes("Agent"), true);
  assert.equal(restored.permissions.deny.includes("user-rule"), true);
}));

test("ensureNativeAgentSuppression: windowed doctrine skips the claude deny unless forced", () => withHome((home) => {
  const configHome = join(home, ".subagent-mcp");
  mkdirSync(configHome, { recursive: true });
  writeFileSync(join(configHome, "settings.json"), '{ "doctrine": "windowed" }\n', "utf8");
  const settings = join(home, ".claude", "settings.json");

  const skipped = ensureNativeAgentSuppression(home, ["claude"], { configHome });
  assert.equal(skipped[0].status, "skipped");
  assert.equal(skipped[0].changed, false);
  assert.equal(existsSync(settings), false, "a skip writes nothing");

  // force is the confirmed-transition escape hatch: the deny is written even
  // while the doctrine files say windowed.
  const forced = ensureNativeAgentSuppression(home, ["claude"], { configHome, force: true });
  assert.equal(forced[0].changed, true);
  assert.equal(readJson(settings).permissions.deny.includes("Agent"), true);
}));

test("removeNativeAgentDenyFromClaudeSettings: absent file and dryRun are no-ops", () => withHome((home) => {
  const missing = removeNativeAgentDenyFromClaudeSettings(home);
  assert.equal(missing.changed, false);
  assert.equal(missing.removed, 0);

  const settings = join(home, ".claude", "settings.json");
  writeJson(settings, { permissions: { deny: ["Agent"] } });
  const before = readFileSync(settings, "utf8");
  const dry = removeNativeAgentDenyFromClaudeSettings(home, { dryRun: true });
  assert.equal(dry.changed, true);
  assert.equal(readFileSync(settings, "utf8"), before, "dryRun never writes");
}));

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
