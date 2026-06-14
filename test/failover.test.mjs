/**
 * Integration tests for the post-spawn grace window in tryLaunchCandidate
 * (src/index.ts): a provider binary that spawns and then dies immediately
 * (codex installed but not logged in, expired auth, instant crash) must
 * silently advance the attempt loop — ERR_ALL_FAILED only when EVERY
 * candidate has been tried.
 *
 * Fake CLIs: node copies named claude/codex on a fake PATH. The claude
 * fixture always dies instantly on its own (win32: node rejects the
 * claude-style argv as a bad option; POSIX: the script exits 1). The codex
 * fixture's behavior is selected per test ("die" = exit 1 instantly, "stall" =
 * stay alive past the window) — via the NODE_OPTIONS preload keyed on
 * basename(process.execPath) on win32, via script content on POSIX.
 *
 * SUBAGENT_SPAWN_GRACE_MS is the documented test seam (0 disables detection =
 * legacy behavior); the deterministic 2-candidate fixture table rides in a
 * private dist/ copy, and the ruleset gate runs ok-disabled so it stays out
 * of the way.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preloadPath = join(repoRoot, "test", "fixtures", "fake-ruleset-preload.cjs");
const fixtureTablePath = join(repoRoot, "test", "fixtures", "ruleset-routing-table.fixture.json");

// Verbatim duplicate (house convention) — ERR_ALL_FAILED always carries it.
const AUTO_HINT =
  "Tip: omit provider/model/effort entirely and the server auto-selects the best provider/model/effort for this task_category, with automatic silent fallback.";

// Must comfortably exceed fake-CLI death latency (node startup + arg parse)
// while staying far under the 4s request timeout and the 30s stall keepalive.
const GRACE_MS = 600;

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

function withTimeout(promise, ms, label, getDetails) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const details = getDetails ? ` ${getDetails()}` : "";
        reject(new Error(`${label} timed out after ${ms}ms.${details}`));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function prependPath(env, dir) {
  const next = { ...env };
  const pathKey = Object.keys(next).find((key) => key.toLowerCase() === "path") || "PATH";
  next[pathKey] = `${dir}${delimiter}${next[pathKey] || ""}`;
  if (process.platform === "win32") {
    next.PATHEXT = next.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  }
  return next;
}

function createMcpSession(entrypoint, options = {}) {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let nextId = 1;
  let stdout = "";
  let stderr = "";
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    while (true) {
      const newline = stdout.indexOf("\n");
      if (newline === -1) break;
      const line = stdout.slice(0, newline).replace(/\r$/, "");
      stdout = stdout.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id).resolve(message);
        pending.delete(message.id);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.on("exit", (code, signal) => {
    for (const { reject } of pending.values()) {
      reject(new Error(`server exited before response (code=${code}, signal=${signal}, stderr=${stderr})`));
    }
    pending.clear();
  });

  function request(method, params) {
    const id = nextId++;
    const response = new Promise((resolveResponse, rejectResponse) => {
      pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return withTimeout(response, 4000, `${method} response`, () => `stderr=${stderr}`);
  }

  function notify(method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async function initialize() {
    const response = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "failover-test", version: "0.0.0" },
    });
    notify("notifications/initialized");
    return response;
  }

  async function close() {
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill();
    }
    await withTimeout(
      new Promise((resolveClose) => child.once("exit", resolveClose)),
      2000,
      "server close",
      () => `stderr=${stderr}`
    ).catch(() => {});
  }

  return { request, initialize, close };
}

// claude always dies instantly; codex behavior is per-test ("die" | "stall").
function writeFailoverPathTools(fakeBin, codexMode) {
  if (process.platform === "win32") {
    writeFileSync(join(fakeBin, "npm.cmd"), "@echo off\r\necho %FAKE_NPM_PREFIX%\r\n");
    // node copies: claude dies on its own (bad option), codex obeys
    // FAKE_CLI_CODEX_MODE through the preload.
    copyFileSync(process.execPath, join(fakeBin, "claude.exe"));
    copyFileSync(process.execPath, join(fakeBin, "codex.exe"));
    return;
  }

  const npmPath = join(fakeBin, "npm");
  const claudePath = join(fakeBin, "claude");
  const codexPath = join(fakeBin, "codex");
  writeFileSync(npmPath, "#!/bin/sh\nprintf '%s\\n' \"$FAKE_NPM_PREFIX\"\n");
  writeFileSync(claudePath, "#!/bin/sh\nexit 1\n");
  writeFileSync(codexPath, codexMode === "stall" ? "#!/bin/sh\nexec sleep 30\n" : "#!/bin/sh\nexit 1\n");
  chmodSync(npmPath, 0o755);
  chmodSync(claudePath, 0o755);
  chmodSync(codexPath, 0o755);
}

// Private dist/ copy carrying the 2-candidate fixture table (see
// ruleset-handler.test.mjs for the resolution rationale).
function makeFixtureDist(tempRoot) {
  const distCopy = join(tempRoot, "dist");
  cpSync(join(repoRoot, "dist"), distCopy, { recursive: true });
  copyFileSync(fixtureTablePath, join(distCopy, "routing-table.json"));
  symlinkSync(
    join(repoRoot, "node_modules"),
    join(tempRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );
  return join(distCopy, "index.js");
}

function makeFailoverEnv(codexMode, graceMs) {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-failover-"));
  const fakeBin = join(tempRoot, "bin");
  const workDir = join(tempRoot, "work");
  const fakePrefix = join(tempRoot, "empty-prefix");
  mkdirSync(fakeBin);
  mkdirSync(workDir);
  mkdirSync(fakePrefix);
  writeFailoverPathTools(fakeBin, codexMode);
  const entrypoint = makeFixtureDist(tempRoot);
  const modeFile = join(tempRoot, "ruleset-mode.txt");
  writeFileSync(modeFile, "ok-disabled");
  const env = prependPath(
    {
      ...process.env,
      FAKE_NPM_PREFIX: fakePrefix,
      SUBAGENT_SPAWN_GRACE_MS: String(graceMs),
      SUBAGENT_MOCK_CLAUDE_DRIVER: "jsonl",
      SUBAGENT_MOCK_CODEX_DRIVER: "jsonl",
      // Ruleset stays out of the way: disabled fake interpreter.
      SUBAGENT_RULESET_PYTHON: process.execPath,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require "${preloadPath.replace(/\\/g, "/")}"`]
        .filter(Boolean)
        .join(" "),
      FAKE_RULESET_MODE_FILE: modeFile,
      FAKE_CLI_CLAUDE_MODE: "die",
      FAKE_CLI_CODEX_MODE: codexMode,
    },
    fakeBin
  );
  return { tempRoot, workDir, env, entrypoint };
}

// ---------------------------------------------------------------------------
// 1. Spawn-then-instant-death advances to the next candidate.
//    WHY: this is the goal's failover fix — a binary that spawns and dies
//    within the grace window (codex-not-logged-in class) must NOT be reported
//    as a successful launch; the loop silently advances to the survivor.
// ---------------------------------------------------------------------------
await test("silent advance: candidate 1 dies within the window, candidate 2 survives and is reported", async () => {
  const { tempRoot, workDir, env, entrypoint } = makeFailoverEnv("stall", GRACE_MS);
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    const response = await session.request("tools/call", {
      name: "launch_agent",
      arguments: { task_category: "coding", prompt: "failover advance launch" },
    });
    const text = response.result.content[0].text;
    assert.notEqual(response.result.isError, true,
      `a surviving candidate 2 must make the launch succeed: ${text}`);
    const payload = JSON.parse(text);
    assert.equal(payload.provider, "codex",
      "the success payload must report the SURVIVING candidate, not the rank-1 corpse");
    assert.equal(payload.model, "gpt-5.5");
    assert.equal(payload.effort, "xhigh");
    assert.equal(payload.ruleset_applied, undefined,
      "failover is not a ruleset alteration — visibility fields stay absent");

    // Clean up the stalled survivor.
    const killResp = await session.request("tools/call", {
      name: "kill_agent",
      arguments: { agent_id: payload.agent_id },
    });
    assert.notEqual(killResp.result?.isError, true, "cleanup kill must succeed");
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. ERR_ALL_FAILED only on exhaustion, with per-candidate early-exit reasons
//    (including the exit code).
//    WHY: a not-installed, not-logged-in, or otherwise dying provider must
//    never abort the cycle early — the numbered list proves every candidate
//    was actually tried and tells the operator WHY each one died.
// ---------------------------------------------------------------------------
await test("exhaustion: ALL candidates die in the window → ERR_ALL_FAILED with exit-code reasons", async () => {
  const { tempRoot, workDir, env, entrypoint } = makeFailoverEnv("die", GRACE_MS);
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    const response = await session.request("tools/call", {
      name: "launch_agent",
      arguments: { task_category: "coding", prompt: "exhaustion launch" },
    });
    assert.equal(response.result.isError, true,
      "only full exhaustion may fail the launch");
    const text = response.result.content[0].text;
    assert.ok(text.startsWith("Error: all 2 candidate launches failed for task_category coding:"),
      `ERR_ALL_FAILED must count BOTH candidates (none skipped early): ${text}`);
    assert.match(text,
      new RegExp(`  1\\. sonnet@medium \\(claude\\): process exited \\(code \\d+\\) within ${GRACE_MS}ms of spawn`),
      "candidate 1's reason must carry the early-exit code");
    assert.match(text,
      new RegExp(`  2\\. gpt-5\\.5@xhigh \\(codex\\): process exited \\(code \\d+\\) within ${GRACE_MS}ms of spawn`),
      "candidate 2's reason must carry the early-exit code — proof the loop advanced past candidate 1");
    assert.ok(text.includes(AUTO_HINT), "ERR_ALL_FAILED keeps the standard hints");
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. SUBAGENT_SPAWN_GRACE_MS=0 disables post-start early-exit detection.
//    WHY: documents the test seam legacy suites rely on; if the startup write
//    wins the race, the rank-1 candidate can still be reported as launched.
// ---------------------------------------------------------------------------
await test("grace 0: detection disabled, startup-write winner is reported as launched", async () => {
  const { tempRoot, workDir, env, entrypoint } = makeFailoverEnv("die", 0);
  const session = createMcpSession(entrypoint, { cwd: workDir, env });
  try {
    await session.initialize();
    const response = await session.request("tools/call", {
      name: "launch_agent",
      arguments: { task_category: "coding", prompt: "legacy grace-off launch" },
    });
    const text = response.result.content[0].text;
    assert.notEqual(response.result.isError, true,
      `grace 0 must preserve the startup-write race seam: ${text}`);
    const payload = JSON.parse(text);
    assert.equal(payload.provider, "claude",
      "with detection off, the rank-1 startup-write winner is reported as launched");
    assert.equal(payload.model, "sonnet");
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
