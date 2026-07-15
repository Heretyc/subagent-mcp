import assert from "node:assert/strict";
import { createServer } from "node:http";

import { callApiProvider } from "../dist/providers/provider-client.js";
import { slotInsert } from "../dist/providers/slot-router.js";
import { TASK_CATEGORIES } from "../dist/routing.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

function routing(slot) {
  return Object.fromEntries(
    TASK_CATEGORIES
      .filter((category) => category !== "fallback_default")
      .map((category) => [category, category === "coding" ? slot : -1])
  );
}

function provider(api_style, base_url, overrides = {}) {
  return {
    name: overrides.name ?? api_style,
    api_style,
    base_url,
    model: overrides.model ?? `${api_style}-model`,
    key_env: overrides.key_env ?? `${api_style.toUpperCase()}_TEST_KEY`,
    routing: routing(overrides.slot ?? 1),
  };
}

async function withJsonServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

async function callCandidate(apiProvider, prompt = "mock route") {
  const old = process.env[apiProvider.key_env];
  process.env[apiProvider.key_env] = "test-key";
  try {
    const candidates = slotInsert(
      [{ provider: "claude", model: "sonnet", effort: "high" }],
      [apiProvider],
      "coding"
    );
    assert.equal(candidates[0].provider, "api");
    assert.equal(candidates[0].apiProvider, apiProvider);
    return await callApiProvider(apiProvider, {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 64,
    });
  } finally {
    if (old === undefined) delete process.env[apiProvider.key_env];
    else process.env[apiProvider.key_env] = old;
  }
}

await test("mock Claude Messages routing posts /v1/messages and normalizes text", async () => {
  let calls = 0;
  await withJsonServer(async (req, res) => {
    calls++;
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/messages");
    assert.equal(req.headers.authorization, "Bearer test-key");
    assert.equal(req.headers["anthropic-version"], "2023-06-01");
    const body = await readJson(req);
    assert.equal(body.model, "claude-model");
    assert.equal(body.messages[0].content, "mock route");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "claude ok" }] }));
  }, async (baseUrl) => {
    const result = await callCandidate(provider("claude", baseUrl));
    assert.equal(result.text, "claude ok");
    assert.equal(calls, 1);
  });
});

await test("mock OpenAI-compatible routing posts /v1/chat/completions and normalizes text", async () => {
  let calls = 0;
  await withJsonServer(async (req, res) => {
    calls++;
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer test-key");
    const body = await readJson(req);
    assert.equal(body.model, "openai-model");
    assert.equal(body.messages[0].content, "mock route");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "openai ok" } }] }));
  }, async (baseUrl) => {
    const result = await callCandidate(provider("openai", baseUrl));
    assert.equal(result.text, "openai ok");
    assert.equal(calls, 1);
  });
});

await test("live GMI route runs only when GMI_API_KEY is present", async () => {
  if (!process.env.GMI_API_KEY) {
    console.log("  SKIP: GMI_API_KEY absent; live GMI route not run");
    return;
  }
  assert.ok(process.env.GMI_BASE_URL, "GMI_BASE_URL must be set with GMI_API_KEY");
  const gmi = provider("openai", process.env.GMI_BASE_URL, {
    name: "gmi",
    key_env: "GMI_API_KEY",
    model: process.env.GMI_MODEL ?? "gmi-model",
  });
  const result = await callApiProvider(gmi, {
    messages: [{ role: "user", content: "Reply with: gmi ok" }],
    temperature: 0.1,
    max_tokens: 16,
  });
  assert.equal(typeof result.text, "string");
  assert.ok(result.text.length > 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
