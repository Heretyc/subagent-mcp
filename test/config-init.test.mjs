import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { initConfigScaffold } from "../dist/config-init.js";
import { TASK_CATEGORIES } from "../dist/routing.js";

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
  const root = mkdtempSync(join(tmpdir(), "subagent-config-init-"));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  try {
    fn(root);
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
    rmSync(root, { recursive: true, force: true });
  }
}

function configPath(root, name) {
  return join(root, ".subagent-mcp", name);
}

test("CLI: config init writes only the mocked home", () => withHome((root) => {
  const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
  const result = spawnSync(process.execPath, [bin, "config", "init"], {
    encoding: "utf8",
    env: { ...process.env, HOME: root, USERPROFILE: root },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /created\s+.*providers\.jsonc/);
  assert.equal(existsSync(configPath(root, "providers.jsonc")), true);
  assert.equal(existsSync(configPath(root, ".env")), true);
}));

test("fresh init writes providers.jsonc and matching .env scaffold", () => withHome((root) => {
  const results = initConfigScaffold();
  assert.deepEqual(results.map((r) => r.status), ["created", "created"]);
  const providers = readFileSync(configPath(root, "providers.jsonc"), "utf8");
  const env = readFileSync(configPath(root, ".env"), "utf8");
  assert.equal((providers.match(/"key_env"/g) || []).length, 1);
  assert.match(env, /^EXAMPLE_PROVIDER_API_KEY=YOUR_KEY_HERE$/m);
  assert.match(providers, /\/\/ 1=first, 2=second slot; <1=skip/);
  for (const category of TASK_CATEGORIES.filter((c) => c !== "fallback_default")) {
    assert.match(providers, new RegExp(`"${category}"\\s*:\\s*-1`));
  }
  assert.doesNotMatch(providers, /"fallback_default"/);
}));

test("existing files are skipped without force", () => withHome((root) => {
  initConfigScaffold();
  writeFileSync(configPath(root, "providers.jsonc"), "keep\n", "utf8");
  writeFileSync(configPath(root, ".env"), "KEEP=1\n", "utf8");
  const results = initConfigScaffold();
  assert.deepEqual(results.map((r) => r.status), ["skipped", "skipped"]);
  assert.equal(readFileSync(configPath(root, "providers.jsonc"), "utf8"), "keep\n");
  assert.equal(readFileSync(configPath(root, ".env"), "utf8"), "KEEP=1\n");
}));

test("--force overwrites and backs up existing files", () => withHome((root) => {
  initConfigScaffold();
  writeFileSync(configPath(root, "providers.jsonc"), "old providers\n", "utf8");
  writeFileSync(configPath(root, ".env"), "OLD=1\n", "utf8");
  const results = initConfigScaffold(true);
  assert.deepEqual(results.map((r) => r.status), ["overwritten", "overwritten"]);
  assert.equal(results.every((r) => r.backup && existsSync(r.backup)), true);
  assert.equal(readdirSync(join(root, ".subagent-mcp")).filter((f) => f.includes(".bak-config-init-")).length, 2);
  assert.match(readFileSync(configPath(root, "providers.jsonc"), "utf8"), /"providers"/);
  assert.match(readFileSync(configPath(root, ".env"), "utf8"), /EXAMPLE_PROVIDER_API_KEY=YOUR_KEY_HERE/);
}));

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
