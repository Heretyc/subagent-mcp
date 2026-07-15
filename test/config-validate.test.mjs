import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { TASK_CATEGORIES } from "../dist/routing.js";
import { loadApiProviders } from "../dist/providers/config-loader.js";

let passed = 0;
let failed = 0;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "dist", "index.js");
const CATEGORIES = TASK_CATEGORIES.filter((c) => c !== "fallback_default");

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

function withConfig(fn) {
  const root = mkdtempSync(join(tmpdir(), "subagent-config-validate-"));
  try {
    const dir = join(root, ".subagent-mcp");
    mkdirSync(dir, { recursive: true });
    fn(dir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), "subagent-provider-loader-"));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  try {
    const dir = join(root, ".subagent-mcp");
    mkdirSync(dir, { recursive: true });
    fn(dir);
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
    rmSync(root, { recursive: true, force: true });
  }
}

function captureWarns(fn) {
  const old = console.error;
  const lines = [];
  console.error = (line) => lines.push(String(line));
  try {
    return { value: fn(), lines };
  } finally {
    console.error = old;
  }
}

function provider(routing = Object.fromEntries(CATEGORIES.map((c) => [c, -1]))) {
  return {
    providers: {
      a: {
        display_name: "A",
        command: "a",
        args: [],
        key_env: "A_KEY",
        routing,
      },
    },
  };
}

function apiProvider(overrides = {}) {
  return {
    api_style: "openai",
    base_url: "https://api.example.test/v1",
    model: "example-model",
    key_env: "EXAMPLE_API_KEY",
    routing: Object.fromEntries(CATEGORIES.map((c) => [c, c === "coding" ? 1 : -1])),
    ...overrides,
  };
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(file) {
  return spawnSync(process.execPath, [BIN, "config", "validate", "--file", file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  });
}

test("valid config exits 0 with summary", () => withConfig((dir) => {
  const file = join(dir, "providers.jsonc");
  const routing = Object.fromEntries(CATEGORIES.map((c) => [c, c === "coding" ? 1 : -1]));
  writeJson(file, provider(routing));
  writeFileSync(join(dir, ".env"), "A_KEY=secret\n", "utf8");
  const r = run(file);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK config validate: providers=1 categories_routed=1/);
  assert.match(r.stdout, /schema fields: display_name:string, command:string, args:array, key_env:string, routing:object/);
}));

test("syntax error includes line number", () => withConfig((dir) => {
  const file = join(dir, "providers.jsonc");
  writeFileSync(file, "{\n  nope\n}\n", "utf8");
  const r = run(file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /line 2/);
}));

test("missing key_env in .env reports name only", () => withConfig((dir) => {
  const file = join(dir, "providers.jsonc");
  writeJson(file, provider());
  writeFileSync(join(dir, ".env"), "A_KEY=YOUR_KEY_HERE\n", "utf8");
  const r = run(file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing key_env A_KEY/);
  assert.doesNotMatch(r.stdout, /YOUR_KEY_HERE/);
}));

test("missing category key fails", () => withConfig((dir) => {
  const routing = Object.fromEntries(CATEGORIES.map((c) => [c, -1]));
  delete routing.coding;
  const file = join(dir, "providers.jsonc");
  writeJson(file, provider(routing));
  writeFileSync(join(dir, ".env"), "A_KEY=secret\n", "utf8");
  const r = run(file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing category coding/);
}));

test("unknown category fails", () => withConfig((dir) => {
  const routing = Object.fromEntries(CATEGORIES.map((c) => [c, -1]));
  routing.nope = 1;
  const file = join(dir, "providers.jsonc");
  writeJson(file, provider(routing));
  writeFileSync(join(dir, ".env"), "A_KEY=secret\n", "utf8");
  const r = run(file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /unknown category nope/);
}));

test("non-integer slot fails", () => withConfig((dir) => {
  const routing = Object.fromEntries(CATEGORIES.map((c) => [c, -1]));
  routing.coding = 1.5;
  const file = join(dir, "providers.jsonc");
  writeJson(file, provider(routing));
  writeFileSync(join(dir, ".env"), "A_KEY=secret\n", "utf8");
  const r = run(file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /category coding slot must be integer/);
}));

test("api provider loader loads valid config", () => withHome((dir) => {
  writeJson(join(dir, "providers.jsonc"), { providers: { api: apiProvider() } });
  const { value, lines } = captureWarns(() => loadApiProviders());
  assert.equal(lines.length, 0);
  assert.deepEqual(value.map((p) => p.name), ["api"]);
  assert.equal(value[0].api_style, "openai");
  assert.equal(value[0].routing.coding, 1);
}));

test("api provider loader skips one bad entry and keeps good entries", () => withHome((dir) => {
  writeJson(join(dir, "providers.jsonc"), {
    providers: {
      good: apiProvider({ api_style: "claude" }),
      bad: apiProvider({ model: "" }),
      cli: provider().providers.a,
    },
  });
  const { value, lines } = captureWarns(() => loadApiProviders());
  assert.deepEqual(value.map((p) => p.name), ["good"]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /WARN providers: bad: model must be string/);
}));

test("api provider loader returns empty on malformed file", () => withHome((dir) => {
  writeFileSync(join(dir, "providers.jsonc"), "{\n  nope\n}\n", "utf8");
  const { value, lines } = captureWarns(() => loadApiProviders());
  assert.deepEqual(value, []);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /WARN providers: .*line 2/);
}));

test("api provider loader returns empty on absent file", () => withHome(() => {
  const { value, lines } = captureWarns(() => loadApiProviders());
  assert.deepEqual(value, []);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /WARN providers: missing /);
}));

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
