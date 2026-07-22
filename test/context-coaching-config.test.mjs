/**
 * context-coaching-config.test.mjs — Mandatory unit coverage for the
 * context-coaching settings surface (LOCKED semantics).
 *
 * Locked contract under test:
 *   - `handoffWarnThreshold` (user-level ONLY, camelCase): default 60, valid
 *     40-90 INCLUSIVE. Anything else — non-numeric, junk, null, out of band —
 *     sanitizes to 60. It must never throw and never yield an out-of-band value.
 *   - `contextCoaching` (user-level ONLY, camelCase): default true. Any
 *     non-boolean sanitizes to true.
 *   - An existing settings file MISSING the keys resolves to silent defaults
 *     (on / 60). A blank file or syntactically broken JSON must NOT crash
 *     metering — it degrades to the same defaults (concurrency.ts parse-failure
 *     precedent).
 *   - The handoff-write/read/clear unlock is a hard-coded 20% and is NEVER
 *     configurable.
 *
 * NOTE (lane L3, written against a concurrently-landing implementation):
 * production symbols are resolved defensively across a candidate list so this
 * file goes green whichever of the plausible names L1/L2 land on. When a
 * capability is absent entirely, this file emits ONE explicit contract failure
 * for that capability rather than one per matrix row, to keep the signal clean.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

async function testAsync(name, fn) {
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

// ---------------------------------------------------------------------------
// Production-surface resolution.
// ---------------------------------------------------------------------------
const CANDIDATE_MODULES = [
  "../dist/orchestration/coaching-config.js",
  "../dist/orchestration/coaching-settings.js",
  "../dist/orchestration/settings.js",
  "../dist/coaching-config.js",
  "../dist/settings.js",
  "../dist/orchestration/metering.js",
  "../dist/concurrency.js",
  "../dist/config-home.js",
];

const loaded = [];
for (const specifier of CANDIDATE_MODULES) {
  try {
    loaded.push([specifier, await import(specifier)]);
  } catch {
    // Module absent in this build; expected for most candidates.
  }
}

function findExport(names) {
  for (const [specifier, mod] of loaded) {
    for (const name of names) {
      if (typeof mod?.[name] === "function") return { fn: mod[name], name, specifier };
    }
  }
  return null;
}

function findConstant(names) {
  for (const [specifier, mod] of loaded) {
    for (const name of names) {
      if (typeof mod?.[name] === "number") return { value: mod[name], name, specifier };
    }
  }
  return null;
}

const sanitize = findExport([
  "sanitizeCoachingSettings",
  "sanitizeContextCoachingSettings",
  "resolveCoachingSettings",
  "normalizeCoachingSettings",
]);

const readSettings = findExport([
  "readCoachingSettings",
  "readContextCoachingSettings",
  "loadCoachingSettings",
]);

const DEFAULT_WARN = 60;
const WARN_MIN = 40;
const WARN_MAX = 90;

const CONTRACT_HINT =
  "expected a user-settings sanitizer exported as sanitizeCoachingSettings(raw) -> " +
  "{ contextCoaching: boolean, handoffWarnThreshold: number } from a dist module " +
  "(e.g. dist/orchestration/coaching-config.js)";

// Normalize whatever shape the resolver returns into the two locked fields.
function fields(result) {
  assert.ok(result && typeof result === "object", "resolver must return an object");
  const threshold =
    result.handoffWarnThreshold ??
    result.warnThreshold ??
    result.handoffWarnThresholdPct;
  const coaching =
    result.contextCoaching ??
    result.coachingEnabled ??
    result.contextCoachingEnabled;
  return { threshold, coaching };
}

// ---------------------------------------------------------------------------
// Locked constants.
// ---------------------------------------------------------------------------
const handoffMod = await import("../dist/orchestration/handoff.js");
const meteringMod = await import("../dist/orchestration/metering.js");

test("locked constants: unlock 20 hard-coded, warn default 60, band 40-90", () => {
  assert.equal(
    meteringMod.HANDOFF_UNLOCK_THRESHOLD_PCT,
    20,
    "handoff unlock must be a hard-coded 20"
  );
  assert.equal(handoffMod.HANDOFF_THRESHOLD_PCT, 20, "handoff module must mirror the 20% unlock");
  assert.equal(meteringMod.PLAN_LATCH_THRESHOLD_PCT, 15, "plan latch stays at 15");
});

test("locked constants: warn threshold default and band are exported", () => {
  const dflt = findConstant([
    "DEFAULT_HANDOFF_WARN_THRESHOLD_PCT",
    "DEFAULT_WARN_THRESHOLD_PCT",
    "DEFAULT_CONTEXT_COACHING_THRESHOLD_PCT",
  ]);
  assert.ok(dflt, "a DEFAULT_HANDOFF_WARN_THRESHOLD_PCT-style constant must be exported");
  assert.equal(dflt.value, DEFAULT_WARN, "warn threshold default must be 60, not 50");

  const min = findConstant(["WARN_THRESHOLD_MIN", "MIN_WARN_THRESHOLD_PCT", "WARN_THRESHOLD_MIN_PCT"]);
  const max = findConstant(["WARN_THRESHOLD_MAX", "MAX_WARN_THRESHOLD_PCT", "WARN_THRESHOLD_MAX_PCT"]);
  assert.ok(min && max, "the valid warn-threshold band must be exported as min/max constants");
  assert.equal(min.value, WARN_MIN, "valid warn threshold band starts at 40 inclusive");
  assert.equal(max.value, WARN_MAX, "valid warn threshold band ends at 90 inclusive");
});

test("the retired hard-coded 50% warn constant is gone", () => {
  assert.equal(
    meteringMod.HANDOFF_WARNING_THRESHOLD_PCT,
    undefined,
    "HANDOFF_WARNING_THRESHOLD_PCT=50 must be retired in favour of the resolved setting"
  );
});

// ---------------------------------------------------------------------------
// Phase boundaries 19 / 20 / 21 (unlock is threshold-independent).
// ---------------------------------------------------------------------------
test("phase boundaries: 19 is plan, 20 and 21 are handoff", () => {
  assert.equal(meteringMod.phaseFor(19), "plan");
  assert.equal(meteringMod.phaseFor(19.99), "plan");
  assert.equal(meteringMod.phaseFor(20), "handoff");
  assert.equal(meteringMod.phaseFor(21), "handoff");
});

test("handoff-write gate boundaries: 19 locked, 20 and 21 unlocked", () => {
  assert.equal(handoffMod.checkHandoffWriteAvailable({ used_percentage: 19 }).ok, false);
  assert.equal(handoffMod.checkHandoffWriteAvailable({ used_percentage: 20 }).ok, true);
  assert.equal(handoffMod.checkHandoffWriteAvailable({ used_percentage: 21 }).ok, true);
});

// ---------------------------------------------------------------------------
// Malformed-config matrix (MANDATORY).
// ---------------------------------------------------------------------------
const ABSENT = Symbol("absent");

const THRESHOLD_CASES = [
  ["absent", ABSENT, DEFAULT_WARN],
  ["40 (lower bound, inclusive)", 40, 40],
  ["60 (default)", 60, 60],
  ["90 (upper bound, inclusive)", 90, 90],
  ["39 (just below band)", 39, DEFAULT_WARN],
  ["91 (just above band)", 91, DEFAULT_WARN],
  ["0", 0, DEFAULT_WARN],
  ["-5", -5, DEFAULT_WARN],
  ["150", 150, DEFAULT_WARN],
  ['"abc"', "abc", DEFAULT_WARN],
  ["null", null, DEFAULT_WARN],
  ["decimal 60.5", 60.5, "in-band"],
];

const COACHING_CASES = [
  ["absent", ABSENT, true],
  ["true", true, true],
  ["false", false, false],
  ['"junk"', "junk", true],
  ["0", 0, true],
];

if (!sanitize) {
  test("MANDATORY malformed-config matrix", () => {
    assert.fail(
      `no context-coaching settings sanitizer found in dist/ — ${CONTRACT_HINT}. ` +
        "This is a production gap, not a test bug: the malformed-config matrix cannot run."
    );
  });
} else {
  console.log(`  (resolved sanitizer ${sanitize.name} from ${sanitize.specifier})`);

  test("malformed-config matrix: handoffWarnThreshold sanitizes into the locked band", () => {
    for (const [label, raw, expected] of THRESHOLD_CASES) {
      const input = raw === ABSENT ? {} : { handoffWarnThreshold: raw };
      const { threshold } = fields(sanitize.fn(input));

      assert.equal(
        typeof threshold,
        "number",
        `handoffWarnThreshold=${label} must sanitize to a number, got ${typeof threshold}`
      );
      assert.ok(
        Number.isFinite(threshold),
        `handoffWarnThreshold=${label} must sanitize to a finite number`
      );
      assert.ok(
        threshold >= WARN_MIN && threshold <= WARN_MAX,
        `handoffWarnThreshold=${label} sanitized to ${threshold}, outside the locked ${WARN_MIN}-${WARN_MAX} band`
      );
      if (expected !== "in-band") {
        assert.equal(
          threshold,
          expected,
          `handoffWarnThreshold=${label} must sanitize to ${expected}, got ${threshold}`
        );
      }
    }
  });

  test("malformed-config matrix: contextCoaching sanitizes to a boolean, non-bool => true", () => {
    for (const [label, raw, expected] of COACHING_CASES) {
      const input = raw === ABSENT ? {} : { contextCoaching: raw };
      const { coaching } = fields(sanitize.fn(input));

      assert.equal(
        typeof coaching,
        "boolean",
        `contextCoaching=${label} must sanitize to a boolean, got ${typeof coaching}`
      );
      assert.equal(
        coaching,
        expected,
        `contextCoaching=${label} must sanitize to ${expected}, got ${coaching}`
      );
    }
  });

  test("malformed-config matrix: every threshold x coaching combination resolves cleanly", () => {
    for (const [tLabel, tRaw, tExpected] of THRESHOLD_CASES) {
      for (const [cLabel, cRaw, cExpected] of COACHING_CASES) {
        const input = {};
        if (tRaw !== ABSENT) input.handoffWarnThreshold = tRaw;
        if (cRaw !== ABSENT) input.contextCoaching = cRaw;

        const { threshold, coaching } = fields(sanitize.fn(input));
        const where = `{handoffWarnThreshold: ${tLabel}, contextCoaching: ${cLabel}}`;

        assert.ok(
          threshold >= WARN_MIN && threshold <= WARN_MAX,
          `${where} produced out-of-band threshold ${threshold}`
        );
        if (tExpected !== "in-band") assert.equal(threshold, tExpected, `${where} threshold`);
        assert.equal(coaching, cExpected, `${where} coaching`);
      }
    }
  });

  test("sanitizer tolerates hostile top-level input without throwing", () => {
    for (const raw of [null, undefined, "", 0, false, [], "a string", { nested: { a: 1 } }]) {
      const { threshold, coaching } = fields(sanitize.fn(raw));
      assert.equal(threshold, DEFAULT_WARN, `top-level ${JSON.stringify(raw)} must default the threshold`);
      assert.equal(coaching, true, `top-level ${JSON.stringify(raw)} must default coaching ON`);
    }
  });

  test("unknown/extra keys are ignored and never widen the band", () => {
    const { threshold, coaching } = fields(
      sanitize.fn({
        handoffWarnThreshold: 75,
        contextCoaching: false,
        permissions: { allow: ["*"] },
        handoffUnlockThreshold: 5,
        bogus: true,
      })
    );
    assert.equal(threshold, 75);
    assert.equal(coaching, false);
  });
}

// ---------------------------------------------------------------------------
// File-level degradation: blank file, broken JSON, existing-file-missing-keys.
// ---------------------------------------------------------------------------
if (!readSettings) {
  test("MANDATORY settings-file degradation (blank / broken JSON / missing keys)", () => {
    assert.fail(
      "no context-coaching settings reader found in dist/ — expected " +
        "readCoachingSettings({ configHome }) (or an equivalent injectable-home reader). " +
        "src/config-home.ts getConfigHome() currently reads homedir() with no override, so " +
        "there is no hermetic seam for this coverage: production must add one."
    );
  });
} else {
  console.log(`  (resolved reader ${readSettings.name} from ${readSettings.specifier})`);

  const homes = [];
  function withSettingsFile(contents) {
    const home = mkdtempSync(join(tmpdir(), "coach-cfg-"));
    homes.push(home);
    if (contents !== null) writeFileSync(join(home, "settings.json"), contents, "utf8");
    const previous = process.env.SUBAGENT_CONFIG_HOME;
    process.env.SUBAGENT_CONFIG_HOME = home;
    try {
      return fields(readSettings.fn({ configHome: home, home }));
    } finally {
      if (previous === undefined) delete process.env.SUBAGENT_CONFIG_HOME;
      else process.env.SUBAGENT_CONFIG_HOME = previous;
    }
  }
  process.on("exit", () => {
    for (const home of homes) rmSync(home, { recursive: true, force: true });
  });

  test("settings file: absent entirely => silent defaults (on / 60)", () => {
    const { threshold, coaching } = withSettingsFile(null);
    assert.equal(threshold, DEFAULT_WARN);
    assert.equal(coaching, true);
  });

  test("settings file: exists but lacks the keys => silent defaults, no prompt", () => {
    const { threshold, coaching } = withSettingsFile(JSON.stringify({ permissions: { allow: [] } }));
    assert.equal(threshold, DEFAULT_WARN);
    assert.equal(coaching, true);
  });

  test("settings file: blank file must not crash metering => defaults", () => {
    for (const blank of ["", "   ", "\n\n"]) {
      const { threshold, coaching } = withSettingsFile(blank);
      assert.equal(threshold, DEFAULT_WARN, `blank content ${JSON.stringify(blank)}`);
      assert.equal(coaching, true, `blank content ${JSON.stringify(blank)}`);
    }
  });

  test("settings file: syntactically broken JSON must not crash metering => defaults", () => {
    for (const broken of ["{", "{ not json", '{"handoffWarnThreshold": }', "[[[", "null"]) {
      const { threshold, coaching } = withSettingsFile(broken);
      assert.equal(threshold, DEFAULT_WARN, `broken content ${JSON.stringify(broken)}`);
      assert.equal(coaching, true, `broken content ${JSON.stringify(broken)}`);
    }
  });

  test("settings file: valid in-band values are honoured", () => {
    const { threshold, coaching } = withSettingsFile(
      JSON.stringify({ handoffWarnThreshold: 45, contextCoaching: false })
    );
    assert.equal(threshold, 45);
    assert.equal(coaching, false);
  });

  test("settings file: out-of-band value falls back to 60 without throwing", () => {
    const { threshold } = withSettingsFile(JSON.stringify({ handoffWarnThreshold: 91 }));
    assert.equal(threshold, DEFAULT_WARN);
  });

  test("settings are user-level ONLY: a project settings file must not override", () => {
    const home = mkdtempSync(join(tmpdir(), "coach-cfg-user-"));
    const project = mkdtempSync(join(tmpdir(), "coach-cfg-proj-"));
    homes.push(home, project);
    writeFileSync(join(home, "settings.json"), JSON.stringify({ handoffWarnThreshold: 80 }), "utf8");
    writeFileSync(join(project, "settings.json"), JSON.stringify({ handoffWarnThreshold: 45 }), "utf8");
    const { threshold } = fields(readSettings.fn({ configHome: home, home, cwd: project }));
    assert.equal(threshold, 80, "the user-level value must win; project files are not consulted");
  });
}

// ---------------------------------------------------------------------------
// Setup prompt behaviour (MANDATORY): re-prompt loop, blank default, non-TTY.
// ---------------------------------------------------------------------------
const setupMod = await import("../dist/setup.js").catch(() => null);
const ensureCoaching =
  setupMod &&
  (setupMod.ensureSetupContextCoaching ??
    setupMod.ensureSetupCoaching ??
    setupMod.ensureSetupContextCoachingPrompts);

if (typeof ensureCoaching !== "function") {
  test("MANDATORY setup prompt coverage (re-prompt, blank default, non-TTY)", () => {
    assert.fail(
      "no ensureSetupContextCoaching(...) helper exported from dist/setup.js — expected a " +
        "helper beside ensureSetupAutoUpdate (src/setup.ts:989) slotted between the auto-update " +
        "prompt and the init-scope prompt, asking BOTH questions and returning " +
        "{ contextCoaching, handoffWarnThreshold }."
    );
  });
} else {
  const { Readable, Writable } = await import("node:stream");
  const sink = () => new Writable({ write(_c, _e, cb) { cb(); } });

  const promptHome = () => {
    const home = mkdtempSync(join(tmpdir(), "coach-setup-"));
    process.on("exit", () => rmSync(home, { recursive: true, force: true }));
    return home;
  };

  await testAsync("setup prompts: non-TTY defaults to on + 60 without asking", async () => {
    const result = await ensureCoaching({
      home: promptHome(),
      isTTY: false,
      log: () => {},
      dryRun: true,
    });
    const { threshold, coaching } = fields(result);
    assert.equal(coaching, true);
    assert.equal(threshold, DEFAULT_WARN);
  });

  await testAsync("setup prompts: --unattended defaults to on + 60 without asking", async () => {
    const result = await ensureCoaching({
      home: promptHome(),
      unattended: true,
      log: () => {},
      dryRun: true,
    });
    const { threshold, coaching } = fields(result);
    assert.equal(coaching, true);
    assert.equal(threshold, DEFAULT_WARN);
  });

  await testAsync("setup prompts: blank answers accept the defaults (on / 60)", async () => {
    const result = await ensureCoaching({
      home: promptHome(),
      isTTY: true,
      input: Readable.from(["\n", "\n"]),
      output: sink(),
      log: () => {},
      dryRun: true,
    });
    const { threshold, coaching } = fields(result);
    assert.equal(coaching, true);
    assert.equal(threshold, DEFAULT_WARN);
  });

  await testAsync("setup prompts: invalid input re-prompts until valid", async () => {
    const lines = [];
    const result = await ensureCoaching({
      home: promptHome(),
      isTTY: true,
      // coaching: junk, junk, then "n"; threshold: junk, out-of-band, then 75.
      input: Readable.from(["maybe\n", "42\n", "n\n", "abc\n", "91\n", "75\n"]),
      output: sink(),
      log: (l) => lines.push(l),
      dryRun: true,
    });
    const { threshold, coaching } = fields(result);
    assert.equal(coaching, false, "the third coaching answer (n) must be taken");
    assert.equal(threshold, 75, "the third threshold answer (75) must be taken");
    assert.ok(lines.length > 0, "invalid input must emit a re-prompt hint");
  });

  await testAsync("setup prompts: ALWAYS asks both questions when triggered", async () => {
    const asked = [];
    await ensureCoaching({
      home: promptHome(),
      isTTY: true,
      input: Readable.from(["y\n", "60\n"]),
      output: new Writable({
        write(chunk, _e, cb) {
          asked.push(String(chunk));
          cb();
        },
      }),
      log: () => {},
      dryRun: true,
    });
    const prose = asked.join("");
    assert.match(prose, /coach/i, "the coaching on/off question must be asked");
    assert.match(prose, /(threshold|%|percent)/i, "the threshold question must be asked");
  });

  await testAsync("setup prompts: band 40-90 is enforced inclusively at the prompt", async () => {
    for (const [answer, expected] of [["40", 40], ["90", 90]]) {
      const result = await ensureCoaching({
        home: promptHome(),
        isTTY: true,
        input: Readable.from(["y\n", `${answer}\n`]),
        output: sink(),
        log: () => {},
        dryRun: true,
      });
      assert.equal(fields(result).threshold, expected, `${answer} is inside the inclusive band`);
    }
  });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
