/**
 * Entry/handler integration tests for src/index.ts.
 *
 * These spawn the compiled MCP server as a child process and talk newline JSON-RPC
 * over stdio. They cover behaviors that pure routing tests cannot see: the
 * entrypoint gate, the executable fast-fail gate, and handler-only fallback text.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  delimiter,
  dirname,
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distIndex = join(repoRoot, "dist", "index.js");

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
      clientInfo: { name: "index-handler-test", version: "0.0.0" },
    });
    notify("notifications/initialized");
    return response;
  }

  async function close() {
    child.kill();
    await withTimeout(
      new Promise((resolveClose) => child.once("exit", resolveClose)),
      2000,
      "server close",
      () => `stderr=${stderr}`
    ).catch(() => {});
  }

  return { request, initialize, close };
}

function writeFakePathTools(fakeBin) {
  if (process.platform === "win32") {
    writeFileSync(join(fakeBin, "npm.cmd"), "@echo off\r\necho %FAKE_NPM_PREFIX%\r\n");
    copyFileSync(process.execPath, join(fakeBin, "claude.exe"));
    return;
  }

  const npmPath = join(fakeBin, "npm");
  const claudePath = join(fakeBin, "claude");
  writeFileSync(npmPath, "#!/bin/sh\nprintf '%s\\n' \"$FAKE_NPM_PREFIX\"\n");
  writeFileSync(claudePath, "#!/bin/sh\nexit 0\n");
  chmodSync(npmPath, 0o755);
  chmodSync(claudePath, 0o755);
}

await test("symlinked dist/index.js connects as the main entrypoint", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-index-symlink-"));
  let linkPath;
  if (process.platform === "win32") {
    const linkedDist = join(tempRoot, "dist-link");
    symlinkSync(dirname(distIndex), linkedDist, "junction");
    linkPath = join(linkedDist, "index.js");
  } else {
    linkPath = join(tempRoot, "linked-index.js");
    symlinkSync(distIndex, linkPath, "file");
  }

  const session = createMcpSession(linkPath);
  try {
    const response = await session.initialize();
    assert.equal(response.result.serverInfo.name, "subagent-mcp");
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("bare PATH executable is not rejected before spawn", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "subagent-index-path-"));
  const fakeBin = join(tempRoot, "bin");
  const workDir = join(tempRoot, "work");
  const fakePrefix = join(tempRoot, "empty-prefix");
  mkdirSync(fakeBin);
  mkdirSync(workDir);
  mkdirSync(fakePrefix);
  writeFakePathTools(fakeBin);

  const env = prependPath({
    ...process.env,
    FAKE_NPM_PREFIX: fakePrefix,
  }, fakeBin);

  const session = createMcpSession(distIndex, { cwd: workDir, env });
  try {
    await session.initialize();
    const response = await session.request("tools/call", {
      name: "launch_agent",
      arguments: {
        task_category: "coding",
        provider: "claude",
        model: "sonnet",
        prompt: "return compact JSON only",
      },
    });

    const text = response.result.content[0].text;
    assert.equal(response.error, undefined, text);
    assert.equal(response.result.isError, undefined, text);
    assert.doesNotMatch(text, /CLI executable not found: claude/);
    const payload = JSON.parse(text);
    assert.equal(payload.provider, "claude");
    assert.equal(payload.model, "sonnet");
    assert.equal(payload.candidates_skipped, 0);
  } finally {
    await session.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

await test("fallback_default handler returns SPLIT_HINT, not profiler guidance", async () => {
  const session = createMcpSession(distIndex);
  try {
    await session.initialize();
    const response = await session.request("tools/call", {
      name: "launch_agent",
      arguments: {
        task_category: "fallback_default",
        prompt: "mixed underspecified work",
      },
    });

    assert.equal(response.error, undefined);
    assert.equal(response.result.isError, true);
    const text = response.result.content[0].text;
    assert.match(text, /break the work into smaller atomic steps/);
    assert.doesNotMatch(text, /model-profiler/);
    assert.doesNotMatch(text, /routing table not populated/);
  } finally {
    await session.close();
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
