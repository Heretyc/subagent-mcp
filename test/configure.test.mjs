import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { configure } from "../dist/configure.js";
import { ROUTING_CATEGORIES } from "../dist/config-validate.js";

function withConfigHome(fn) {
  const root = mkdtempSync(join(tmpdir(), "subagent-configure-"));
  const old = process.env.SUBAGENT_CONFIG_HOME;
  process.env.SUBAGENT_CONFIG_HOME = root;
  try {
    return fn(root);
  } finally {
    if (old === undefined) delete process.env.SUBAGENT_CONFIG_HOME;
    else process.env.SUBAGENT_CONFIG_HOME = old;
    rmSync(root, { recursive: true, force: true });
  }
}

function json(result) {
  return JSON.parse(result.content[0].text);
}

function text(result) {
  return JSON.stringify(result);
}

function backups(dir, name) {
  return readdirSync(dir).filter((f) => f.startsWith(`${name}.bak-`));
}

function routing(slot = -1) {
  return Object.fromEntries(ROUTING_CATEGORIES.map((c) => [c, c === "coding" ? slot : -1]));
}

function provider(overrides = {}) {
  return {
    api_style: "openai",
    base_url: "https://api.example.test/v1",
    model: "example-model",
    key_env: "API_KEY",
    routing: routing(1),
    ...overrides,
  };
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("configure validates action/key/value combinations", () => withConfigHome(() => {
  for (const params of [
    { action: "list", key: "user.contextCoaching" },
    { action: "list", value: "true" },
    { action: "get" },
    { action: "get", key: "user.contextCoaching", value: "true" },
    { action: "set" },
    { action: "set", key: "user.contextCoaching" },
  ]) {
    const r = configure(params);
    assert.equal(r.isError, true, JSON.stringify(params));
    assert.equal(json(r).ok, false);
  }
}));

test("configure redacts secret values and never returns the raw secret", () => withConfigHome(() => {
  const raw = "abcdSECRETxy";
  const set = configure({ action: "set", key: "env.PUBLIC_NAME", value: raw });
  assert.equal(json(set).value, `abcd${String.fromCharCode(0x2026)}xy`);
  assert.doesNotMatch(JSON.stringify(set), new RegExp(raw));

  const get = configure({ action: "get", key: "env.PUBLIC_NAME" });
  assert.equal(json(get).value, `abcd${String.fromCharCode(0x2026)}xy`);
  assert.doesNotMatch(JSON.stringify(get), new RegExp(raw));

  assert.equal(json(configure({ action: "set", key: "env.SHORT", value: "abc" })).value, "******");
}));

test("configure coaches global and mode sets without config-home writes", () => withConfigHome((root) => {
  const global = json(configure({ action: "set", key: "global.globalConcurrentSubagents" }));
  assert.equal(global.status, "coached");
  assert.equal(global.restart_required, false);
  assert.ok(isAbsolute(global.path));
  assert.match(global.message, new RegExp(global.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(readdirSync(root), []);

  assert.match(json(configure({ action: "set", key: "mode.orchestration" })).message, /orchestration-mode tool/);
  assert.match(json(configure({ action: "set", key: "mode.modelSelection" })).message, /model-selection-mode tool/);
}));

test("configure writes user setting once, backs up old bytes, then reports unchanged", () => withConfigHome((root) => {
  const file = join(root, "settings.json");
  writeFileSync(file, '{\n  "contextCoaching": true\n}\n', "utf8");
  const first = json(configure({ action: "set", key: "user.contextCoaching", value: "false" }));
  assert.equal(first.status, "updated");
  assert.equal(first.backup !== null && existsSync(first.backup), true);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).contextCoaching, false);
  assert.equal(backups(root, "settings.json").length, 1);

  const second = json(configure({ action: "set", key: "user.contextCoaching", value: "false" }));
  assert.equal(second.status, "unchanged");
  assert.equal(second.backup, null);
  assert.equal(backups(root, "settings.json").length, 1);
}));

test("configure rejects invalid provider updates without changing the file", () => withConfigHome((root) => {
  mkdirSync(root, { recursive: true });
  const file = join(root, "providers.jsonc");
  writeJson(file, { providers: { api: provider() } });
  writeFileSync(join(root, ".env"), "API_KEY=secret\n", "utf8");
  const before = readFileSync(file, "utf8");

  for (const params of [
    { action: "set", key: "providers.api.api_style", value: "bad" },
    { action: "set", key: "providers.api.routing.coding", value: "1.5" },
    { action: "set", key: "providers.api", value: "{" },
  ]) {
    const r = configure(params);
    assert.equal(r.isError, true, JSON.stringify(params));
    assert.equal(readFileSync(file, "utf8"), before);
  }
  assert.equal(backups(root, "providers.jsonc").length, 0);
}));

test("configure rejects prototype-polluting provider names and nested payload keys", () => withConfigHome((root) => {
  mkdirSync(root, { recursive: true });
  const file = join(root, "providers.jsonc");
  writeFileSync(join(root, ".env"), "API_KEY=secret\n", "utf8");

  const polluted = configure({ action: "set", key: "providers.__proto__.model", value: "pwn" });
  assert.equal(polluted.isError, true);
  assert.equal(Object.prototype.model, undefined);

  const missingModel = configure({
    action: "set",
    key: "providers.api",
    value: JSON.stringify(provider({ model: undefined })),
  });
  assert.equal(missingModel.isError, true);
  assert.equal(existsSync(file), false);

  const nested = configure({
    action: "set",
    key: "providers.api",
    value: '{"api_style":"openai","base_url":"https://api.example.test/v1","model":"example-model","key_env":"API_KEY","routing":{},"note":{"__proto__":{"model":"pwn"}}}',
  });
  assert.equal(nested.isError, true);
  assert.equal(existsSync(file), false);
}));

test("configure masks whole-provider extra fields from set, get, and list", () => withConfigHome((root) => {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, ".env"), "API_KEY=secret\n", "utf8");
  const raw = "sk-live-AAAABBBBCCCCDDDD";
  const value = provider({ credential: raw, note: { deep: raw } });

  const set = configure({ action: "set", key: "providers.api", value: JSON.stringify(value) });
  const get = configure({ action: "get", key: "providers.api" });
  const list = configure({ action: "list" });

  for (const r of [set, get, list]) assert.doesNotMatch(text(r), new RegExp(raw));
  for (const body of [json(set), json(get), json(list).keys.find((k) => k.key === "providers.api")]) {
    assert.equal(body.value.model, "example-model");
    assert.equal(body.value.base_url, "https://api.example.test/v1");
    assert.equal(body.value.routing.coding, 1);
    assert.notEqual(body.value.credential, raw);
    assert.notEqual(body.value.note.deep, raw);
  }
}));

test("configure JSON parse errors do not echo submitted content", () => withConfigHome(() => {
  const raw = "TOPSECRET123";
  const r = configure({ action: "set", key: "providers.newp", value: raw });
  assert.equal(r.isError, true);
  assert.match(json(r).error, /invalid JSON/);
  assert.doesNotMatch(text(r), new RegExp(raw));
}));

test("configure masks unknown keys in the envelope and error", () => withConfigHome(() => {
  const raw = "abcdSECRETxy";
  const r = configure({ action: "get", key: `unknown.${raw}` });
  const body = json(r);
  assert.equal(r.isError, true);
  assert.doesNotMatch(body.key, new RegExp(raw));
  assert.doesNotMatch(body.error, new RegExp(raw));
  assert.doesNotMatch(text(r), new RegExp(raw));
}));

test("configure rejects unsafe routing integers without writing", () => withConfigHome((root) => {
  mkdirSync(root, { recursive: true });
  const file = join(root, "providers.jsonc");
  writeJson(file, { providers: { api: provider() } });
  writeFileSync(join(root, ".env"), "API_KEY=secret\n", "utf8");
  const before = readFileSync(file, "utf8");

  const r = configure({ action: "set", key: "providers.api.routing.coding", value: "9007199254740992" });
  assert.equal(r.isError, true);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(backups(root, "providers.jsonc").length, 0);
}));

test("configure catch-all errors are sanitized", () => withConfigHome(() => {
  const raw = "TOPSECRET123";
  const r = configure({ action: "set", key: { toString: () => raw }, value: "safe" });
  assert.equal(r.isError, true);
  assert.match(json(r).error, /withheld/);
  assert.doesNotMatch(text(r), new RegExp(raw));
}));

test("configure reports restart only for env and key_env changes", () => withConfigHome((root) => {
  const file = join(root, "providers.jsonc");
  writeJson(file, { providers: { api: provider({ key_env: "OLD_KEY" }) } });
  writeFileSync(join(root, ".env"), "OLD_KEY=old-secret\nNEW_KEY=new-secret\n", "utf8");

  assert.equal(json(configure({ action: "set", key: "env.API_KEY", value: "secret-value" })).restart_required, true);
  assert.equal(json(configure({ action: "set", key: "providers.api.model", value: "next-model" })).restart_required, false);
  assert.equal(json(configure({ action: "set", key: "providers.api.key_env", value: "NEW_KEY" })).restart_required, true);
}));
