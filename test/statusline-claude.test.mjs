import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  statuslinePathForCwd,
  statuslinePathForSession,
  statuslineSessionKey,
} from "../dist/orchestration/statusline-state.js";

let passed = 0;
let failed = 0;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

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

function runShim(payload, args = []) {
  return spawnSync(
    process.execPath,
    [join("dist", "hooks", "statusline-claude.js"), ...args],
    {
      cwd: REPO,
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      encoding: "utf8",
    }
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("statusline shim writes sl record keyed by session_id", () => {
  const session = `sl-shim-session-${Date.now()}-${Math.random()}`;
  const path = statuslinePathForSession(session);
  try {
    const result = runShim({
      session_id: session,
      model: { display_name: "Sonnet" },
      context_window: {
        used_percentage: 12.4,
        context_window_size: 200000,
        current_usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_creation_input_tokens: 3,
          cache_read_input_tokens: 4,
        },
      },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "Sonnet Ctx:12%");
    assert.deepEqual(readJson(path).usage, {
      input: 10,
      output: 2,
      cache_creation: 3,
      cache_read: 4,
    });
    assert.equal(readJson(path).used_percentage, 12.4);
  } finally {
    rmSync(path, { force: true });
  }
});

test("statusline shim writes transcript-path fallback", () => {
  const transcript = join(tmpdir(), `sl-shim-${Date.now()}.jsonl`);
  const key = statuslineSessionKey({ transcript_path: transcript });
  const path = statuslinePathForSession(key);
  try {
    const result = runShim({
      transcript_path: transcript,
      context_window: { context_window_size: 1000000 },
    });
    assert.equal(result.status, 0);
    assert.equal(readJson(path).context_window_size, 1000000);
  } finally {
    rmSync(path, { force: true });
  }
});

test("statusline shim writes cwd fallback", () => {
  const cwd = mkdtempSync(join(tmpdir(), "sl-shim-cwd-"));
  const path = statuslinePathForCwd(cwd);
  try {
    const result = runShim({
      cwd,
      context_window: { used_percentage: 5 },
    });
    assert.equal(result.status, 0);
    assert.equal(readJson(path).used_percentage, 5);
  } finally {
    rmSync(path, { force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("statusline shim delegates stdin to inner command and forwards stdout", () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-inner-"));
  const inner = join(dir, "inner.mjs");
  writeFileSync(inner, "process.stdin.pipe(process.stdout);\n", "utf8");
  try {
    const payload = {
      context_window: { used_percentage: 7 },
    };
    const result = runShim(payload, [`"${process.execPath}"`, `"${inner}"`]);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).context_window.used_percentage, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("statusline shim prints fallback when inner command writes nothing", () => {
  const result = runShim(
    {
      model: { display_name: "Sonnet" },
      context_window: { used_percentage: 19 },
    },
    [`"${process.execPath}" -e ""`]
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "Sonnet Ctx:19%\n");
});

test("statusline shim prints fallback when inner command writes only whitespace", () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-inner-blank-"));
  const inner = join(dir, "inner.mjs");
  writeFileSync(inner, "process.stdout.write('  \\n   ');\n", "utf8");
  try {
    const result = runShim(
      {
        model: { display_name: "Sonnet" },
        context_window: { used_percentage: 23 },
      },
      [`"${process.execPath}"`, `"${inner}"`]
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "Sonnet Ctx:23%\n");
    assert.ok(result.stdout.trim().length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("statusline shim passes through substantive inner stdout verbatim", () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-inner-content-"));
  const inner = join(dir, "inner.mjs");
  writeFileSync(inner, "process.stdout.write('  custom status  \\n');\n", "utf8");
  try {
    const result = runShim(
      { context_window: { used_percentage: 31 } },
      [`"${process.execPath}"`, `"${inner}"`]
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "  custom status  \n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("statusline shim preserves multi-word quoted args in one inner command argv", () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-inner-argv-"));
  const inner = join(dir, "inner.mjs");
  writeFileSync(inner, "console.log(JSON.stringify(process.argv.slice(2)));\n", "utf8");
  try {
    const result = runShim(
      { context_window: { used_percentage: 3 } },
      [`"${process.execPath}" "${inner}" "value with spaces"`]
    );
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), ["value with spaces"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("statusline shim tolerates malformed stdin and exits 0 with a line", () => {
  const result = runShim("{");
  assert.equal(result.status, 0);
  assert.ok(result.stdout.trim().length > 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
