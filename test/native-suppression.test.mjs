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
} from "../dist/native-suppression.js";

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

test("claude: preserves settings and adds native-agent deny once", () => {
  const s = { theme: "dark", permissions: { allow: ["Read(*)"], deny: ["Write(secret)"] } };
  const first = reconcileClaudeNativeAgentDeny(s);
  assert.equal(first.status, "repaired");
  assert.equal(s.theme, "dark");
  assert.deepEqual(s.permissions.allow, ["Read(*)"]);
  for (const rule of CLAUDE_NATIVE_AGENT_DENY) assert.ok(s.permissions.deny.includes(rule));
  const afterFirst = JSON.stringify(s);
  const second = reconcileClaudeNativeAgentDeny(s);
  assert.equal(second.status, "ok");
  assert.equal(JSON.stringify(s), afterFirst);
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

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
