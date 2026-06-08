/**
 * Schema-gate tests for scripts/validate_seed_sites.mjs (the 3rd persisted
 * artifact, research-seed-sites.json).
 *
 * The validator IS the gate, so these tests drive the REAL script as a child
 * process (mirroring how validate_provider.mjs is wired into `npm test`) and
 * assert its exit code against known-good and known-bad seed files supplied via
 * SEED_SITES_PATH. Each known-bad case isolates ONE invariant the validator must
 * enforce (Rule 9: the test encodes WHY each rule exists — a regression that
 * drops any single check makes exactly one case go green-when-it-should-fail).
 *
 * It spawns the script (never imports it): validate_seed_sites.mjs is a
 * top-level `process.exit()` program, not an exported function, so the contract
 * under test IS "exit 0 on valid / absent, exit 1 on any schema violation."
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validator = join(repoRoot, "scripts", "validate_seed_sites.mjs");

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

// Run the validator with SEED_SITES_PATH pointed at an absolute path. The script
// resolves SEED_SITES_PATH via resolve(ROOT, ...), and resolve() returns an
// absolute second arg unchanged, so an absolute temp path is honoured verbatim.
function runValidator(seedPath) {
  const result = spawnSync(process.execPath, [validator], {
    cwd: repoRoot,
    env: { ...process.env, SEED_SITES_PATH: seedPath },
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

// A minimal, fully-valid seed file. Each known-bad case below mutates exactly one
// thing off this baseline so the failing invariant is unambiguous.
function goodSeed() {
  return {
    metadata: {
      author: "Lexi Blackburn",
      author_url: "https://github.com/Heretyc/",
      schema_version: "1",
      generated: "2026-06",
      last_run_at: "2026-06-04T00:00:00Z",
      run_id: "run-2026-06-04-test",
      site_count: 2,
    },
    sites: [
      {
        url: "https://epoch.ai/benchmarks",
        domain: "epoch.ai",
        tier: 2,
        categories: ["math_proof"],
        benchmarks: [],
        first_seen: "2026-06-03",
        last_seen: "2026-06-04",
        times_seen: 3,
        label: "[T2]",
      },
      {
        url: "https://lmarena.ai/leaderboard",
        domain: "lmarena.ai",
        tier: 2,
        categories: ["coding"],
        first_seen: "2026-06-04",
        last_seen: "2026-06-04",
        times_seen: 1,
      },
    ],
  };
}

// Per-test scratch dir under %TEMP%; each writeSeed gets a fresh file.
const scratch = mkdtempSync(join(tmpdir(), "seed-sites-test-"));
let counter = 0;
function writeSeed(obj) {
  const p = join(scratch, `seed-${counter++}.json`);
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
  return p;
}

// ---------------------------------------------------------------------------
// Known-good — the validator must accept a well-formed file (exit 0).
// WHY: a false FAIL here would block every legitimate profiling run from
// committing its 3rd artifact.
// ---------------------------------------------------------------------------
test("known-good seed file passes (exit 0)", () => {
  const r = runValidator(writeSeed(goodSeed()));
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stdout, /PASS \(2 sites\)/, "should report PASS with the site count");
});

// ---------------------------------------------------------------------------
// Fresh-clone tolerance — an ABSENT file is a NOTICE-skip, not a failure, so
// `npm test` stays green before the first profiling run ever (§C.5).
// WHY: this is the deliberate split from the run-level §1c existence gate; if it
// regressed to a hard FAIL, a fresh clone could never go green.
// ---------------------------------------------------------------------------
test("absent seed file is a NOTICE-skip (exit 0)", () => {
  const r = runValidator(join(scratch, "does-not-exist.json"));
  assert.equal(r.status, 0, `absent file must exit 0, got ${r.status}. stderr: ${r.stderr}`);
  assert.match(r.stdout, /NOTICE/, "absent file should print a NOTICE");
});

// ---------------------------------------------------------------------------
// Known-bad cases — each isolates ONE schema invariant. The validator must
// reject with exit 1. WHY per case is in the test name.
// ---------------------------------------------------------------------------

test("missing metadata key fails (exit 1) — every provenance key is required", () => {
  const bad = goodSeed();
  delete bad.metadata.author_url;
  const r = runValidator(writeSeed(bad));
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
});

test("site_count != sites.length fails (exit 1) — denormalized count must stay honest", () => {
  const bad = goodSeed();
  bad.metadata.site_count = 99;
  const r = runValidator(writeSeed(bad));
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
});

test("duplicate url fails (exit 1) — url is the dedupe key, must be unique", () => {
  const bad = goodSeed();
  bad.sites[1].url = bad.sites[0].url;
  bad.sites[1].domain = bad.sites[0].domain;
  // keep count honest so we isolate the duplicate-url check, not the count check
  const r = runValidator(writeSeed(bad));
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
});

test("sites not sorted by url fails (exit 1) — sorted order guarantees stable diffs", () => {
  const bad = goodSeed();
  bad.sites.reverse(); // lmarena before epoch => descending
  const r = runValidator(writeSeed(bad));
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
});

test("tier out of 0..5 range fails (exit 1) — tier is the [T<n>] band, bounded", () => {
  const bad = goodSeed();
  bad.sites[0].tier = 9;
  const r = runValidator(writeSeed(bad));
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
});

test("times_seen < 1 fails (exit 1) — a listed site was seen at least once", () => {
  const bad = goodSeed();
  bad.sites[0].times_seen = 0;
  const r = runValidator(writeSeed(bad));
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
});

test("missing required site key fails (exit 1) — domain is required provenance", () => {
  const bad = goodSeed();
  delete bad.sites[0].domain;
  const r = runValidator(writeSeed(bad));
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
});

test("malformed first_seen date fails (exit 1) — dates must be YYYY-MM-DD", () => {
  const bad = goodSeed();
  bad.sites[0].first_seen = "June 3 2026";
  const r = runValidator(writeSeed(bad));
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
});

test("unparseable JSON fails (exit 1) — a corrupt artifact must never pass", () => {
  const p = join(scratch, `corrupt-${counter++}.json`);
  writeFileSync(p, "{ not valid json ", "utf8");
  const r = runValidator(p);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stdout: ${r.stdout}`);
});

// ---------------------------------------------------------------------------
// Cleanup + summary
// ---------------------------------------------------------------------------
rmSync(scratch, { recursive: true, force: true });
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
