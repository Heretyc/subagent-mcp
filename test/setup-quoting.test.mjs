/**
 * setup-quoting.test.mjs — Unit tests for the CLI-output matcher and the
 * Windows command-line safety helpers in dist/setup.js.
 *
 * WHY (Rule 9):
 *   - outputListsServer: a bare includes() check false-positived on sibling
 *     server names (subagent-mcp-dev, my-subagent-mcp), making setup/doctor
 *     report "registered" when only a sibling was. The matcher must accept the
 *     exact name in every vendor list/get format and reject all siblings.
 *   - quoteWinShellArg/Exe: cmd.exe metachars (& | < > ^ ( ) % !) in
 *     filesystem-derived paths were passed live to cmd.exe, and \" escaping is
 *     wrong at the cmd parse stage ("" doubling is the quote-state-safe form).
 *   - resolveCmdShimNodeScript: the primary fix bypasses cmd.exe entirely by
 *     spawning node on the npm shim's JS entry; the parser must handle modern
 *     and legacy shim forms and fail closed (null) on anything else.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SERVER_NAME,
  outputListsServer,
  quoteWinShellArg,
  quoteWinShellExe,
  resolveCmdShimNodeScript,
} from "../dist/setup.js";
import {
  quoteWinCmdArg,
  run as runDeployCommand,
  validatePackageMetadata,
} from "../skills/subagent-mcp-installer/scripts/deploy.mjs";

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
// outputListsServer
// ---------------------------------------------------------------------------
test("outputListsServer: claude `mcp list` line format -> true", () => {
  assert.equal(outputListsServer("subagent-mcp: subagent-mcp  - ✓ Connected"), true);
});

test("outputListsServer: codex table row -> true", () => {
  assert.equal(outputListsServer("subagent-mcp  node C:\\x\\dist\\index.js  enabled"), true);
});

test("outputListsServer: name alone / at start / at end -> true", () => {
  assert.equal(outputListsServer("subagent-mcp"), true);
  assert.equal(outputListsServer("subagent-mcp is configured"), true);
  assert.equal(outputListsServer("Name: subagent-mcp"), true);
});

test("outputListsServer: sibling suffix name -> false", () => {
  assert.equal(outputListsServer("subagent-mcp-dev: node x - ✓ Connected"), false);
});

test("outputListsServer: sibling prefix name -> false", () => {
  assert.equal(outputListsServer("my-subagent-mcp: node x - ✓ Connected"), false);
});

test("outputListsServer: multiline output with only siblings -> false", () => {
  const out = "subagent-mcp-dev: node a.js - ok\nmy-subagent-mcp: node b.js - ok\n";
  assert.equal(outputListsServer(out), false);
});

test("outputListsServer: sibling + exact name on different lines -> true", () => {
  const out = "subagent-mcp-dev: node a.js - ok\nsubagent-mcp: subagent-mcp - ok\n";
  assert.equal(outputListsServer(out), true);
});

test("outputListsServer: 'No MCP servers configured' -> false", () => {
  assert.equal(outputListsServer("No MCP servers configured"), false);
});

test("outputListsServer: custom name argument is honored", () => {
  const out = `submcp-itest-123: node - ok\n`;
  assert.equal(outputListsServer(out, "submcp-itest-123"), true);
  assert.equal(outputListsServer(out, "submcp-itest-123-dev"), false);
  assert.equal(outputListsServer(out, SERVER_NAME), false);
});

// ---------------------------------------------------------------------------
// quoteWinShellArg
// ---------------------------------------------------------------------------
test("quoteWinShellArg: safe tokens pass through unchanged", () => {
  assert.equal(quoteWinShellArg("mcp"), "mcp");
  assert.equal(quoteWinShellArg("C:\\Users\\x\\dist\\index.js"), "C:\\Users\\x\\dist\\index.js");
  assert.equal(quoteWinShellArg("C:/a/b.js"), "C:/a/b.js");
});

test("quoteWinShellArg: space and tab are quoted", () => {
  assert.equal(quoteWinShellArg("a b"), '"a b"');
  assert.equal(quoteWinShellArg("a\tb"), '"a\tb"');
});

test("quoteWinShellArg: every cmd.exe metachar is quoted", () => {
  for (const ch of ["&", "|", "<", ">", "^", "(", ")", "%", "!"]) {
    assert.equal(quoteWinShellArg(`a${ch}b`), `"a${ch}b"`, `metachar ${ch} must force quoting`);
  }
});

test('quoteWinShellArg: embedded quote -> "" doubling (not \\")', () => {
  assert.equal(quoteWinShellArg('a"b'), '"a""b"');
});

test('quoteWinShellArg: empty string -> ""', () => {
  assert.equal(quoteWinShellArg(""), '""');
});

// ---------------------------------------------------------------------------
// deploy.mjs Windows command fallback and package metadata validation
// ---------------------------------------------------------------------------
test("deploy quoteWinCmdArg: always quotes and escapes cmd metachars", () => {
  assert.equal(quoteWinCmdArg('a"&|^<>%b'), '"a""^&^|^^^<^>^%b"');
});

if (process.platform === "win32") {
  test("deploy run: .cmd shim args with embedded quotes and cmd metachars round-trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "deploy-quote-"));
    try {
      const rel = "node_modules\\fake-cli\\cli.js";
      mkdirSync(join(dir, "node_modules", "fake-cli"), { recursive: true });
      const script = join(dir, rel);
      const arg = 'a"&|^<>%b';
      writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2)));\n");
      writeFileSync(join(dir, "fake.cmd"), `@echo off\r\nnode "%~dp0\\${rel}" %*\r\n`);
      const out = runDeployCommand(join(dir, "fake.cmd"), [arg], dir);
      assert.deepEqual(JSON.parse(out), [arg]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("deploy validatePackageMetadata: accepts expected package metadata", () => {
  assert.doesNotThrow(() => validatePackageMetadata({ name: "@heretyc/subagent-mcp", version: "2.12.16" }));
});

test("deploy validatePackageMetadata: rejects unsafe package names", () => {
  const out = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    'import { validatePackageMetadata } from "./skills/subagent-mcp-installer/scripts/deploy.mjs"; validatePackageMetadata({ name: "bad&name", version: "1.0.0" });',
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /invalid package name: bad&name/);
});

test("deploy validatePackageMetadata: rejects unsafe package versions", () => {
  const out = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    'import { validatePackageMetadata } from "./skills/subagent-mcp-installer/scripts/deploy.mjs"; validatePackageMetadata({ name: "@heretyc/subagent-mcp", version: "1.0.0&calc" });',
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /invalid package version: 1\.0\.0&calc/);
});

// ---------------------------------------------------------------------------
// quoteWinShellExe
// ---------------------------------------------------------------------------
test("quoteWinShellExe: always quoted, even when safe", () => {
  assert.equal(quoteWinShellExe("C:\\bin\\claude.cmd"), '"C:\\bin\\claude.cmd"');
});

test('quoteWinShellExe: embedded quote -> "" doubling', () => {
  assert.equal(quoteWinShellExe('C:\\we"ird.cmd'), '"C:\\we""ird.cmd"');
});

// ---------------------------------------------------------------------------
// resolveCmdShimNodeScript
// (positive cases are win32-only: the resolved JS path joins the shim's
//  backslash-relative segment, which only maps onto the filesystem on Windows —
//  mirrors the posix-only gating precedent in setup-repair.test.mjs)
// ---------------------------------------------------------------------------
const MODERN_SHIM = (rel) =>
  `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\n` +
  `CALL :find_dp0\r\n"%dp0%\\node.exe"  "%dp0%\\${rel}" %*\r\n`;

const LEGACY_SHIM = (rel) =>
  `@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\${rel}" %*\r\n) ELSE (\r\n  node  "%~dp0\\${rel}" %*\r\n)\r\n`;

if (process.platform === "win32") {
  test("resolveCmdShimNodeScript: modern %dp0% shim -> absolute JS path", () => {
    const dir = mkdtempSync(join(tmpdir(), "shim-"));
    try {
      const rel = "node_modules\\@anthropic-ai\\claude-code\\cli.js";
      mkdirSync(join(dir, "node_modules", "@anthropic-ai", "claude-code"), { recursive: true });
      writeFileSync(join(dir, rel), "// cli\n");
      writeFileSync(join(dir, "claude.cmd"), MODERN_SHIM(rel));
      assert.equal(resolveCmdShimNodeScript(join(dir, "claude.cmd")), join(dir, rel));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolveCmdShimNodeScript: legacy %~dp0 shim -> absolute JS path", () => {
    const dir = mkdtempSync(join(tmpdir(), "shim-"));
    try {
      const rel = "node_modules\\codex\\bin\\codex.js";
      mkdirSync(join(dir, "node_modules", "codex", "bin"), { recursive: true });
      writeFileSync(join(dir, rel), "// cli\n");
      writeFileSync(join(dir, "codex.cmd"), LEGACY_SHIM(rel));
      assert.equal(resolveCmdShimNodeScript(join(dir, "codex.cmd")), join(dir, rel));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("resolveCmdShimNodeScript: target JS missing -> null", () => {
  const dir = mkdtempSync(join(tmpdir(), "shim-"));
  try {
    writeFileSync(join(dir, "ghost.cmd"), MODERN_SHIM("node_modules\\ghost\\cli.js"));
    assert.equal(resolveCmdShimNodeScript(join(dir, "ghost.cmd")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCmdShimNodeScript: arbitrary non-shim .cmd -> null", () => {
  const dir = mkdtempSync(join(tmpdir(), "shim-"));
  try {
    writeFileSync(join(dir, "plain.cmd"), "@echo off\r\necho hello\r\n");
    assert.equal(resolveCmdShimNodeScript(join(dir, "plain.cmd")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCmdShimNodeScript: unreadable path -> null (never throws)", () => {
  assert.equal(resolveCmdShimNodeScript(join(tmpdir(), "does-not-exist-xyz.cmd")), null);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
