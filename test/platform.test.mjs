/**
 * platform.test.mjs — Unit tests for resolveExeFor with injected platform/deps.
 *
 * NOTE: This host is Windows. The darwin and linux branches cannot be executed
 * live. They are validated here via the injected-platform parameter only.
 */
import assert from "node:assert/strict";
import { resolveExeFor } from "../dist/platform.js";
import { join } from "node:path";

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps({ existPaths = [], prefix = "C:\\npm-global", arch = undefined } = {}) {
  return {
    existsSync: (p) => existPaths.includes(p),
    npmPrefix: () => prefix,
    ...(arch ? { arch: () => arch } : {}),
  };
}

// ---------------------------------------------------------------------------
// win32 — claude
// ---------------------------------------------------------------------------

test("win32 + claude.exe exists -> returns full .exe path", () => {
  const prefix = "C:\\npm-global";
  const exePath = join(prefix, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  const deps = makeDeps({ existPaths: [exePath], prefix });
  assert.equal(resolveExeFor("claude", "win32", deps), exePath);
});

test("win32 + claude.exe absent -> bare 'claude'", () => {
  const deps = makeDeps({ existPaths: [], prefix: "C:\\npm-global" });
  assert.equal(resolveExeFor("claude", "win32", deps), "claude");
});

// ---------------------------------------------------------------------------
// win32 — codex
// ---------------------------------------------------------------------------

test("win32 + codex vendor exe exists -> returns full vendor .exe path", () => {
  const prefix = "C:\\npm-global";
  const exePath = join(
    prefix,
    "node_modules", "@openai", "codex",
    "node_modules", "@openai", "codex-win32-x64",
    "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"
  );
  const deps = makeDeps({ existPaths: [exePath], prefix });
  assert.equal(resolveExeFor("codex", "win32", deps), exePath);
});

test("win32 + codex arm64 vendor exe exists -> returns full arm64 vendor .exe path", () => {
  const prefix = "C:\\npm-global";
  const exePath = join(
    prefix,
    "node_modules", "@openai", "codex",
    "node_modules", "@openai", "codex-win32-arm64",
    "vendor", "aarch64-pc-windows-msvc", "bin", "codex.exe"
  );
  const deps = makeDeps({ existPaths: [exePath], prefix, arch: "arm64" });
  assert.equal(resolveExeFor("codex", "win32", deps), exePath);
});

test("win32 + codex vendor exe absent -> bare 'codex'", () => {
  const deps = makeDeps({ existPaths: [], prefix: "C:\\npm-global" });
  assert.equal(resolveExeFor("codex", "win32", deps), "codex");
});

// ---------------------------------------------------------------------------
// darwin — claude
// ---------------------------------------------------------------------------

test("darwin + /opt/homebrew/bin/claude exists (npm-prefix absent) -> homebrew path", () => {
  const prefix = "/usr/local/lib/node_modules";
  const deps = makeDeps({
    existPaths: ["/opt/homebrew/bin/claude"],
    prefix,
  });
  assert.equal(resolveExeFor("claude", "darwin", deps), "/opt/homebrew/bin/claude");
});

test("darwin + npmPrefix/bin/claude exists -> npm-prefix path wins (checked first)", () => {
  const prefix = "/usr/local/lib";
  const npmCandidate = prefix + "/bin/claude";
  const deps = makeDeps({
    existPaths: [npmCandidate, "/opt/homebrew/bin/claude"],
    prefix,
  });
  assert.equal(resolveExeFor("claude", "darwin", deps), npmCandidate);
});

test("darwin + none exist -> bare 'claude'", () => {
  const deps = makeDeps({ existPaths: [], prefix: "/usr/local/lib" });
  assert.equal(resolveExeFor("claude", "darwin", deps), "claude");
});

// ---------------------------------------------------------------------------
// darwin — codex
// ---------------------------------------------------------------------------

test("darwin + npmPrefix/bin/codex exists -> npm-prefix path", () => {
  const prefix = "/home/user/.npm-global";
  const npmCandidate = prefix + "/bin/codex";
  const deps = makeDeps({ existPaths: [npmCandidate], prefix });
  assert.equal(resolveExeFor("codex", "darwin", deps), npmCandidate);
});

test("darwin + none exist -> bare 'codex'", () => {
  const deps = makeDeps({ existPaths: [], prefix: "/usr/local/lib" });
  assert.equal(resolveExeFor("codex", "darwin", deps), "codex");
});

// ---------------------------------------------------------------------------
// linux — claude
// ---------------------------------------------------------------------------

test("linux + /usr/local/bin/claude exists -> that path", () => {
  const deps = makeDeps({
    existPaths: ["/usr/local/bin/claude"],
    prefix: "/usr/lib",
  });
  assert.equal(resolveExeFor("claude", "linux", deps), "/usr/local/bin/claude");
});

test("linux + none exist -> bare 'claude'", () => {
  const deps = makeDeps({ existPaths: [], prefix: "/usr/lib" });
  assert.equal(resolveExeFor("claude", "linux", deps), "claude");
});

// ---------------------------------------------------------------------------
// linux — codex
// ---------------------------------------------------------------------------

test("linux + /usr/local/bin/codex exists -> that path", () => {
  const deps = makeDeps({
    existPaths: ["/usr/local/bin/codex"],
    prefix: "/usr/lib",
  });
  assert.equal(resolveExeFor("codex", "linux", deps), "/usr/local/bin/codex");
});

test("linux + none exist -> bare 'codex'", () => {
  const deps = makeDeps({ existPaths: [], prefix: "/usr/lib" });
  assert.equal(resolveExeFor("codex", "linux", deps), "codex");
});

// ---------------------------------------------------------------------------
// Candidate priority: npmPrefix before homebrew before usr-local (darwin)
// ---------------------------------------------------------------------------

test("darwin: candidate priority — homebrew wins over usr-local when npm-prefix absent", () => {
  const deps = makeDeps({
    existPaths: ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"],
    prefix: "/no/such/prefix",
  });
  assert.equal(resolveExeFor("codex", "darwin", deps), "/opt/homebrew/bin/codex");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
