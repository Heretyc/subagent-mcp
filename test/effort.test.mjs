import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { mapModel, resolveEffort, buildCommand } from "../dist/effort.js";

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

// 1. mapModel: generic opus tracks Opus 5.5; explicit version aliases pinned
test("mapModel opus -> claude-opus-5-5", () => {
  assert.equal(mapModel("claude", "opus"), "claude-opus-5-5");
});
test("mapModel opus-5-5 -> claude-opus-5-5", () => {
  assert.equal(mapModel("claude", "opus-5-5"), "claude-opus-5-5");
});
test("mapModel opus-4-8 -> claude-opus-4-8", () => {
  assert.equal(mapModel("claude", "opus-4-8"), "claude-opus-4-8");
});
test("mapModel fable -> claude-fable-5-1", () => {
  assert.equal(mapModel("claude", "fable"), "claude-fable-5-1");
});
test("mapModel fable-5-1 -> claude-fable-5-1", () => {
  assert.equal(mapModel("claude", "fable-5-1"), "claude-fable-5-1");
});
test("mapModel fable-5 -> claude-fable-5", () => {
  assert.equal(mapModel("claude", "fable-5"), "claude-fable-5");
});
test("mapModel sonnet -> claude-sonnet-5-5 (generic tracks GA Sonnet 5.5)", () => {
  assert.equal(mapModel("claude", "sonnet"), "claude-sonnet-5-5");
});
test("mapModel sonnet-5-5 -> claude-sonnet-5-5", () => {
  assert.equal(mapModel("claude", "sonnet-5-5"), "claude-sonnet-5-5");
});
test("mapModel sonnet-4-6 -> claude-sonnet-4-6 (legacy pin, never advanced to 5.5)", () => {
  assert.equal(mapModel("claude", "sonnet-4-6"), "claude-sonnet-4-6");
});
test("mapModel haiku -> claude-haiku-4-5", () => {
  assert.equal(mapModel("claude", "haiku"), "claude-haiku-4-5");
});
test("mapModel codex gpt-5.6 -> gpt-5.6-sol", () => {
  assert.equal(mapModel("codex", "gpt-5.6"), "gpt-5.6-sol");
});
test("mapModel codex gpt-6-astra -> gpt-6-astra", () => {
  assert.equal(mapModel("codex", "gpt-6-astra"), "gpt-6-astra");
});
test("mapModel codex gpt-6-sol -> gpt-6-sol (exact id, passthrough)", () => {
  assert.equal(mapModel("codex", "gpt-6-sol"), "gpt-6-sol");
});
test("mapModel codex gpt-6-luna -> gpt-6-luna (exact id, passthrough)", () => {
  assert.equal(mapModel("codex", "gpt-6-luna"), "gpt-6-luna");
});

// 2. generic opus resolves to Opus 5.5, which is not verified for ultracode -> throws
test("(claude,opus,ultracode) throws because generic opus is not the ultracode-verified model", () => {
  assert.throws(() => buildCommand("claude", "opus", "ultracode", "test", process.cwd()));
});

// 2b. opus-5-5 explicit: ultracode not enabled without CLI verification -> throws
test("(claude,opus-5-5,ultracode) throws", () => {
  assert.throws(() => buildCommand("claude", "opus-5-5", "ultracode", "test", process.cwd()));
});

// 3. (claude, opus-4-8, ultracode): same as #2
test("(claude,opus-4-8,ultracode) buildCommand has --settings, no --effort, file contains ultracode:true", () => {
  const result = buildCommand("claude", "opus-4-8", "ultracode", "test", process.cwd());
  assert.ok(result.ucSettingsPath, "ucSettingsPath should be set");
  const settingsIdx = result.args.indexOf("--settings");
  assert.ok(settingsIdx !== -1, "args should include --settings");
  assert.ok(existsSync(result.ucSettingsPath), "temp settings file should exist");
  const contents = JSON.parse(readFileSync(result.ucSettingsPath, "utf-8"));
  assert.deepEqual(contents, { ultracode: true }, "file should contain {ultracode:true}");
  assert.ok(!result.args.includes("--effort"), "args should NOT include --effort");
  unlinkSync(result.ucSettingsPath);
});

// 4. (codex, gpt-5.5, ultracode): throws, message contains "Opus 4.8"
test("(codex,gpt-5.5,ultracode) throws with 'Opus 4.8' in message", () => {
  assert.throws(
    () => buildCommand("codex", "gpt-5.5", "ultracode", "test", process.cwd()),
    (err) => {
      assert.ok(err.message.includes("Opus 4.8"), `Expected 'Opus 4.8' in: ${err.message}`);
      return true;
    }
  );
});

// 5. (claude, haiku, ultracode): throws
test("(claude,haiku,ultracode) throws", () => {
  assert.throws(() => buildCommand("claude", "haiku", "ultracode", "test", process.cwd()));
});

// 6. (claude, sonnet, ultracode): throws
test("(claude,sonnet,ultracode) throws", () => {
  assert.throws(() => buildCommand("claude", "sonnet", "ultracode", "test", process.cwd()));
});

test("(claude,fable,ultracode) throws", () => {
  assert.throws(() => buildCommand("claude", "fable", "ultracode", "test", process.cwd()));
});

// 7. (claude, opus, max): args include "--effort","max"
test("(claude,opus,max) args include --effort max", () => {
  const result = buildCommand("claude", "opus", "max", "test", process.cwd());
  const effortIdx = result.args.indexOf("--effort");
  assert.ok(effortIdx !== -1, "args should include --effort");
  assert.equal(result.args[effortIdx + 1], "max", "--effort value should be max");
});

// 7b. Generic `opus` --model resolves to the latest verified GA Opus (5.5),
// while the pinned `opus-4-8` alias stays on Opus 4.8. This guards the normal
// (non-ultracode) launch path from silently drifting back to an older id.
test("(claude,opus,high) --model is claude-opus-5-5 (generic tracks latest GA)", () => {
  const result = buildCommand("claude", "opus", "high", "test", process.cwd());
  const modelIdx = result.args.indexOf("--model");
  assert.equal(result.args[modelIdx + 1], "claude-opus-5-5", "--model should be claude-opus-5-5");
  const effortIdx = result.args.indexOf("--effort");
  assert.equal(result.args[effortIdx + 1], "high", "--effort value should be high");
});

// 8. (codex, gpt-5.5, max): throws, message contains "not valid for gpt-5.5"
test("(codex,gpt-5.5,max) throws with 'not valid for gpt-5.5' in message", () => {
  assert.throws(
    () => buildCommand("codex", "gpt-5.5", "max", "test", process.cwd()),
    (err) => {
      assert.ok(err.message.includes("not valid for gpt-5.5"), `Expected 'not valid for gpt-5.5' in: ${err.message}`);
      return true;
    }
  );
});

// 8b. (codex, gpt-5.6, max): the generic gpt-5.6 alias is EXPLICITLY pinned by
// mapModel to gpt-5.6-sol, and the driver sends that resolved canonical id, so
// gpt-5.6@max runs end-to-end as the catalogue-supported gpt-5.6-sol@max. The
// alias therefore inherits its target's max tier (like generic opus -> Opus 5.5)
// and must be ACCEPTED — only gpt-5.5 (test 8) tops out at xhigh.
test("(codex,gpt-5.6,max) resolveEffort returns flag max (alias inherits its pin's max)", () => {
  assert.deepEqual(resolveEffort("codex", "gpt-5.6", "max"), { kind: "flag", value: "max" });
});
test("(codex,gpt-5.6,max) buildCommand uses app-server stdio and does not throw", () => {
  const result = buildCommand("codex", "gpt-5.6", "max", "test", process.cwd());
  assert.deepEqual(result.args, ["app-server", "--stdio"]);
});

// 8c. The account-verified gpt-5.6 trio (sol/terra/luna) DO carry max (codex-cli
// 0.158.0 model/list). resolveEffort returns the max flag; buildCommand launches
// via app-server stdio without throwing. xhigh still works; low/ultracode throw.
test("(codex,gpt-5.6-sol,max) resolveEffort returns flag max", () => {
  assert.deepEqual(resolveEffort("codex", "gpt-5.6-sol", "max"), { kind: "flag", value: "max" });
});
test("(codex,gpt-5.6-terra,max) resolveEffort returns flag max", () => {
  assert.deepEqual(resolveEffort("codex", "gpt-5.6-terra", "max"), { kind: "flag", value: "max" });
});
test("(codex,gpt-5.6-luna,max) resolveEffort returns flag max", () => {
  assert.deepEqual(resolveEffort("codex", "gpt-5.6-luna", "max"), { kind: "flag", value: "max" });
});
test("(codex,gpt-5.6-sol,xhigh) resolveEffort returns flag xhigh", () => {
  assert.deepEqual(resolveEffort("codex", "gpt-5.6-sol", "xhigh"), { kind: "flag", value: "xhigh" });
});
test("(codex,gpt-5.6-sol,max) buildCommand uses app-server stdio and does not throw", () => {
  const result = buildCommand("codex", "gpt-5.6-sol", "max", "test", process.cwd());
  assert.deepEqual(result.args, ["app-server", "--stdio"]);
});
test("(codex,gpt-5.6-terra,low) throws (low banned)", () => {
  assert.throws(() => buildCommand("codex", "gpt-5.6-terra", "low", "test", process.cwd()));
});
test("(codex,gpt-5.6-luna,ultracode) throws (ultracode is Opus-4-8-only, not on Codex)", () => {
  assert.throws(() => buildCommand("codex", "gpt-5.6-luna", "ultracode", "test", process.cwd()));
});
// Pinned exact ids pass through mapModel unchanged (no guessed remap).
test("mapModel codex gpt-5.6-sol/terra/luna -> themselves (exact id passthrough)", () => {
  assert.equal(mapModel("codex", "gpt-5.6-sol"), "gpt-5.6-sol");
  assert.equal(mapModel("codex", "gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(mapModel("codex", "gpt-5.6-luna"), "gpt-5.6-luna");
});

// 9. (codex, gpt-5.5, xhigh): app-server launch validates effort but carries it later in turn/start
test("(codex,gpt-5.5,xhigh) uses app-server stdio, not exec prompt args", () => {
  const result = buildCommand("codex", "gpt-5.5", "xhigh", "test", process.cwd());
  assert.deepEqual(result.args, ["app-server", "--stdio"]);
  assert.ok(!result.args.includes("exec"), "codex must not use one-shot exec");
  assert.ok(!result.args.includes("--json"), "codex prompt must not be passed as a CLI arg");
});

// 10. (claude, sonnet, xhigh): args include "--effort","xhigh"
test("(claude,sonnet,xhigh) args include --effort xhigh", () => {
  const result = buildCommand("claude", "sonnet", "xhigh", "test", process.cwd());
  const effortIdx = result.args.indexOf("--effort");
  assert.ok(effortIdx !== -1, "args should include --effort");
  assert.equal(result.args[effortIdx + 1], "xhigh", "--effort value should be xhigh");
});

test("(claude,fable,max) maps model and args include --effort max", () => {
  const result = buildCommand("claude", "fable", "max", "test", process.cwd());
  const modelIdx = result.args.indexOf("--model");
  const effortIdx = result.args.indexOf("--effort");
  assert.equal(result.args[modelIdx + 1], "claude-fable-5-1", "--model should be claude-fable-5-1");
  assert.equal(result.args[effortIdx + 1], "max", "--effort value should be max");
});

test("(claude,fable-5-1,xhigh) maps model and args include --effort xhigh", () => {
  const result = buildCommand("claude", "fable-5-1", "xhigh", "test", process.cwd());
  const modelIdx = result.args.indexOf("--model");
  const effortIdx = result.args.indexOf("--effort");
  assert.equal(result.args[modelIdx + 1], "claude-fable-5-1", "--model should be claude-fable-5-1");
  assert.equal(result.args[effortIdx + 1], "xhigh", "--effort value should be xhigh");
});

test("(claude,opus-5-5,max) maps model and args include --effort max", () => {
  const result = buildCommand("claude", "opus-5-5", "max", "test", process.cwd());
  const modelIdx = result.args.indexOf("--model");
  const effortIdx = result.args.indexOf("--effort");
  assert.equal(result.args[modelIdx + 1], "claude-opus-5-5", "--model should be claude-opus-5-5");
  assert.equal(result.args[effortIdx + 1], "max", "--effort value should be max");
});

// GPT-6 Astra (Codex) supports medium/high/xhigh/max; low is banned.
test("(codex,gpt-6-astra,max) resolveEffort returns flag max (max is valid for Astra)", () => {
  assert.deepEqual(resolveEffort("codex", "gpt-6-astra", "max"), { kind: "flag", value: "max" });
});
test("(codex,gpt-6-astra,xhigh) resolveEffort returns flag xhigh", () => {
  assert.deepEqual(resolveEffort("codex", "gpt-6-astra", "xhigh"), { kind: "flag", value: "xhigh" });
});
test("(codex,gpt-6-astra,max) buildCommand uses app-server stdio and does not throw", () => {
  const result = buildCommand("codex", "gpt-6-astra", "max", "test", process.cwd());
  assert.deepEqual(result.args, ["app-server", "--stdio"]);
});
test("(codex,gpt-6-astra,low) throws (low banned)", () => {
  assert.throws(() => buildCommand("codex", "gpt-6-astra", "low", "test", process.cwd()));
});
test("(codex,gpt-6-astra,ultracode) throws (ultracode not on Astra)", () => {
  assert.throws(() => buildCommand("codex", "gpt-6-astra", "ultracode", "test", process.cwd()));
});

// GPT-6 Sol/Luna (Codex 0.158.0) support medium/high/xhigh/max; low is banned.
test("(codex,gpt-6-sol,max) resolveEffort returns flag max", () => {
  assert.deepEqual(resolveEffort("codex", "gpt-6-sol", "max"), { kind: "flag", value: "max" });
});
test("(codex,gpt-6-luna,max) resolveEffort returns flag max", () => {
  assert.deepEqual(resolveEffort("codex", "gpt-6-luna", "max"), { kind: "flag", value: "max" });
});
test("(codex,gpt-6-sol,xhigh) resolveEffort returns flag xhigh", () => {
  assert.deepEqual(resolveEffort("codex", "gpt-6-sol", "xhigh"), { kind: "flag", value: "xhigh" });
});
test("(codex,gpt-6-sol,low) throws (low banned)", () => {
  assert.throws(() => buildCommand("codex", "gpt-6-sol", "low", "test", process.cwd()));
});
test("(codex,gpt-6-luna,ultracode) throws (ultracode not on Codex)", () => {
  assert.throws(() => buildCommand("codex", "gpt-6-luna", "ultracode", "test", process.cwd()));
});

// Sonnet 5.5 (GA) and the pinned 4-6 legacy id resolve max like other Claude models.
test("(claude,sonnet-5-5,max) --model is claude-sonnet-5-5 with --effort max", () => {
  const result = buildCommand("claude", "sonnet-5-5", "max", "test", process.cwd());
  const modelIdx = result.args.indexOf("--model");
  const effortIdx = result.args.indexOf("--effort");
  assert.equal(result.args[modelIdx + 1], "claude-sonnet-5-5");
  assert.equal(result.args[effortIdx + 1], "max");
});
test("(claude,sonnet-4-6,high) --model is claude-sonnet-4-6 (legacy pin preserved)", () => {
  const result = buildCommand("claude", "sonnet-4-6", "high", "test", process.cwd());
  const modelIdx = result.args.indexOf("--model");
  assert.equal(result.args[modelIdx + 1], "claude-sonnet-4-6");
});
test("(claude,sonnet-4-6,ultracode) throws (ultracode is Opus 4.8 only)", () => {
  assert.throws(() => buildCommand("claude", "sonnet-4-6", "ultracode", "test", process.cwd()));
});

// 11. (claude, haiku, high): args do NOT include "--effort"
test("(claude,haiku,high) args do NOT include --effort", () => {
  const result = buildCommand("claude", "haiku", "high", "test", process.cwd());
  assert.ok(!result.args.includes("--effort"), "args should NOT include --effort for haiku");
});

// 11b. Unknown/unsupported model/effort pair fails loudly, never silently
// falls back to a default effort. Guards the final no-silent-fallback throw.
test("(claude,unknown-model,high) throws unsupported combination", () => {
  assert.throws(
    () => resolveEffort("claude", "unknown-model", "high"),
    (err) => {
      assert.ok(
        err.message.includes("unsupported model/effort combination"),
        `Expected unsupported-combination throw in: ${err.message}`
      );
      return true;
    }
  );
});

// --- Interactive-only launch args ---
// WHY: provider drivers own the conversation protocol. buildCommand must never
// construct the old one-shot Claude print-mode or Codex exec prompt paths.

function assertInteractiveClaudeArgs(args, label) {
  assert.ok(args.includes("--model"), `${label}: args should include --model`);
  assert.ok(!args.includes("--permission-mode"), `${label}: SDK options own permissions`);
  assert.ok(!args.includes("--tools"), `${label}: SDK options own tools`);
  assert.ok(!args.includes("--max-turns"), `${label}: SDK options own max turns`);
  assert.ok(!args.includes("-p"), `${label}: Claude must not use one-shot print mode`);
  assert.ok(!args.includes("--output-format"), `${label}: Claude SDK owns stream transport`);
  assert.ok(!args.includes("stream-json"), `${label}: raw CLI stream-json path is superseded`);
  assert.ok(!args.includes("--verbose"), `${label}: raw print-mode verbose flag is superseded`);
}

// 12. (claude, sonnet, high): normal path is SDK-compatible, not print mode
test("(claude,sonnet,high) uses interactive SDK-compatible args", () => {
  const result = buildCommand("claude", "sonnet", "high", "test", process.cwd());
  assertInteractiveClaudeArgs(result.args, "normal");
});

// 13. (claude, opus-4-8, ultracode): ultracode path is also not print mode
test("(claude,opus-4-8,ultracode) uses interactive SDK-compatible args", () => {
  const result = buildCommand("claude", "opus-4-8", "ultracode", "test", process.cwd());
  assertInteractiveClaudeArgs(result.args, "ultracode");
  unlinkSync(result.ucSettingsPath);
});

// ---------------------------------------------------------------------------
// Full-GA refresh: pinned Active-GA selectors map to their EXACT canonical CLI
// ids. opus-4-5 / sonnet-4-5 stay pinned to their DATED snapshot ids (verified
// via the claude-api models reference). A generic alias must never advance one.
// ---------------------------------------------------------------------------
test("mapModel opus-5 -> claude-opus-5", () => {
  assert.equal(mapModel("claude", "opus-5"), "claude-opus-5");
});
test("mapModel sonnet-5 -> claude-sonnet-5", () => {
  assert.equal(mapModel("claude", "sonnet-5"), "claude-sonnet-5");
});
test("mapModel opus-4-7 -> claude-opus-4-7", () => {
  assert.equal(mapModel("claude", "opus-4-7"), "claude-opus-4-7");
});
test("mapModel opus-4-6 -> claude-opus-4-6", () => {
  assert.equal(mapModel("claude", "opus-4-6"), "claude-opus-4-6");
});
test("mapModel opus-4-5 -> claude-opus-4-5-20251101 (dated pin stays pinned)", () => {
  assert.equal(mapModel("claude", "opus-4-5"), "claude-opus-4-5-20251101");
});
test("mapModel sonnet-4-5 -> claude-sonnet-4-5-20250929 (dated pin stays pinned)", () => {
  assert.equal(mapModel("claude", "sonnet-4-5"), "claude-sonnet-4-5-20250929");
});

// The silent-downgrade fix: Sonnet 4.6 has NO xhigh (has max). Requesting xhigh
// must THROW with the supported tiers — never emit `--effort xhigh` (which the
// CLI silently downgrades to `high`, below the supported `max`).
test("(claude,sonnet-4-6,xhigh) THROWS — no silent downgrade (Sonnet 4.6 has no xhigh)", () => {
  assert.throws(
    () => resolveEffort("claude", "sonnet-4-6", "xhigh"),
    (err) => {
      assert.ok(/not supported by claude\/sonnet-4-6/.test(err.message), err.message);
      const supported = err.message.split("Supported:")[1] ?? "";
      assert.ok(supported.includes("medium, high, max"), `must list ladder: ${err.message}`);
      assert.ok(!supported.includes("xhigh"), `supported list must not offer xhigh: ${err.message}`);
      assert.ok(err.message.includes("No silent downgrade"), err.message);
      return true;
    }
  );
});
test("(claude,sonnet-4-6,max) resolveEffort returns flag max (its top tier)", () => {
  assert.deepEqual(resolveEffort("claude", "sonnet-4-6", "max"), { kind: "flag", value: "max" });
});

// Opus 4.6: same ladder as Sonnet 4.6 — no xhigh, has max.
test("(claude,opus-4-6,xhigh) THROWS (Opus 4.6 has no xhigh)", () => {
  assert.throws(() => resolveEffort("claude", "opus-4-6", "xhigh"));
});
test("(claude,opus-4-6,max) returns flag max", () => {
  assert.deepEqual(resolveEffort("claude", "opus-4-6", "max"), { kind: "flag", value: "max" });
});

// Opus 4.5: extended-thinking pin — medium/high ONLY (no xhigh, no max).
test("(claude,opus-4-5,high) returns flag high", () => {
  assert.deepEqual(resolveEffort("claude", "opus-4-5", "high"), { kind: "flag", value: "high" });
});
test("(claude,opus-4-5,xhigh) THROWS (Opus 4.5 has no xhigh)", () => {
  assert.throws(() => resolveEffort("claude", "opus-4-5", "xhigh"));
});
test("(claude,opus-4-5,max) THROWS (Opus 4.5 has no max)", () => {
  assert.throws(() => resolveEffort("claude", "opus-4-5", "max"));
});

// Sonnet 4.5: NO selectable effort — resolves to kind:none, buildCommand emits
// no --effort (any effort value is ignored, exactly like Haiku).
test("(claude,sonnet-4-5,high) resolveEffort returns kind:none", () => {
  assert.deepEqual(resolveEffort("claude", "sonnet-4-5", "high"), { kind: "none" });
});
test("(claude,sonnet-4-5,high) buildCommand emits dated --model and NO --effort", () => {
  const result = buildCommand("claude", "sonnet-4-5", "high", "test", process.cwd());
  const modelIdx = result.args.indexOf("--model");
  assert.equal(result.args[modelIdx + 1], "claude-sonnet-4-5-20250929");
  assert.ok(!result.args.includes("--effort"), "Sonnet 4.5 must not carry an --effort flag");
});

// Opus 4.7 / Opus 5 / Sonnet 5: full xhigh+max ladder.
test("(claude,opus-4-7,xhigh) returns flag xhigh", () => {
  assert.deepEqual(resolveEffort("claude", "opus-4-7", "xhigh"), { kind: "flag", value: "xhigh" });
});
test("(claude,opus-5,max) returns flag max", () => {
  assert.deepEqual(resolveEffort("claude", "opus-5", "max"), { kind: "flag", value: "max" });
});
test("(claude,sonnet-5,xhigh) returns flag xhigh", () => {
  assert.deepEqual(resolveEffort("claude", "sonnet-5", "xhigh"), { kind: "flag", value: "xhigh" });
});
// The new pinned selectors are NOT ultracode-capable (Opus 4.8 only).
test("(claude,opus-5,ultracode) THROWS (ultracode is Opus 4.8 only)", () => {
  assert.throws(() => buildCommand("claude", "opus-5", "ultracode", "test", process.cwd()));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
