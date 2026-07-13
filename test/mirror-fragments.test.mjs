/**
 * Mirror-fragments byte-identity test (S4/D25/D7) — GATING.
 *
 * Two governance fragments are duplicated across source files by design and
 * MUST never drift:
 *
 *   A2 — the READ-ESCALATION LADDER paragraph. It is carried verbatim in BOTH
 *        the INIT_BLOCK template (src/init.ts, upserted into the host
 *        instruction files) AND the MCP `instructions` string
 *        (ORCHESTRATION_INSTRUCTIONS in src/index.ts, read once at connect).
 *        These two copies must be BYTE-IDENTICAL.
 *
 *   A4 — the jointly binding precedence clause. It lives inside the
 *        single shared INIT_BLOCK, so all three host files (CLAUDE.md /
 *        AGENTS.md / GEMINI.md) are identical by construction once it is
 *        present verbatim in that one block.
 *
 * Strategy: read the two source files as TEXT and assert the exact A2 paragraph
 * is a substring of BOTH (byte-identity by shared-substring), and that the A4
 * clause is a substring of src/init.ts. Reading source text (rather than
 * importing dist) keeps the assertion at the literal-bytes level, which is what
 * "byte-identical" means here. A failure means real drift exists — the diff of
 * the two A2 copies is printed so it can be fixed.
 *
 * This test IS wired into `npm test` (see package.json) and therefore gates
 * CI: it documents/guards the invariant and reports drift, and a failure
 * fails the required test run rather than merely warning.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const initSrc = readFileSync(join(repoRoot, "src", "init.ts"), "utf8");
const indexSrc = readFileSync(join(repoRoot, "src", "index.ts"), "utf8");
const handoffSpec = readFileSync(
  join(repoRoot, "docs", "spec", "dev-loop", "orchestration-directive-architecture", "handoff.md"),
  "utf8"
);
const appendixA1A4 = readFileSync(
  join(repoRoot, "docs", "spec", "dev-loop", "orchestration-directive-architecture", "appendix-a1-a4.md"),
  "utf8"
);

// --- A2: the exact READ-ESCALATION LADDER paragraph (verbatim) -------------
// This is the single source of truth for the expected fragment. It must match,
// byte-for-byte, the literal text embedded in both src/init.ts and src/index.ts.
const A2_LADDER =
  "READ-ESCALATION LADDER (the orchestrator's only read channels, in order): (1) subagent-mcp `poll_agent` TAIL; (2) if the tail is insufficient, dispatch ONE sub-agent to return a single summary of <=100 lines, trusted as-is (no separate verification step); (3) anything larger: the USER reads the document directly. No reads or writes occur outside these channels. An empty or stalled tail means the agent is ALIVE, not dead — do NOT busy-loop poll_agent; learn completion via `wait`. Large inter-agent data: the orchestrator assigns scratch-file paths (%TEMP% on Windows, /tmp on POSIX) in prompts; the producing sub-agent writes, the consuming sub-agent reads; the orchestrator NEVER reads those files.";

// --- A4: the jointly binding precedence clause (verbatim) ------------------
// Jointly binding top-tier precedence clause; lives in the shared INIT_BLOCK.
const A4_JOINTLY_BINDING =
  "PRECEDENCE (jointly binding top tier): <subagent-mcp> hook tags and repo/system safety-scope rules are both binding at the same priority — neither is read as outranking the other. If they genuinely conflict, stop and escalate to the user via the structured-question tool rather than picking one side or averaging them silently; this is intentionally not the agent's call to make alone. Hook tags otherwise take precedence over ordinary user requests, because they reflect harness-verified state rather than a request that could be mistaken or out of date.";

// Extract the actual ladder paragraph as it appears in each source file, so a
// failing run can print the concrete drift rather than a bare boolean.
function extractLadder(src) {
  const start = src.indexOf("READ-ESCALATION LADDER");
  if (start < 0) return null;
  // The paragraph ends at "NEVER reads those files." — capture through that.
  const endMarker = "NEVER reads those files.";
  const end = src.indexOf(endMarker, start);
  if (end < 0) return src.slice(start, start + A2_LADDER.length);
  return src.slice(start, end + endMarker.length);
}

function diff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return {
    firstDivergenceIndex: i,
    initFragment: a.slice(Math.max(0, i - 20), i + 40),
    indexFragment: b.slice(Math.max(0, i - 20), i + 40),
    initLen: a.length,
    indexLen: b.length,
  };
}

function extractStringConstant(source, name) {
  const re = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*("(?:(?:\\\\.)|[^"\\\\])*")`, "s");
  const match = source.match(re);
  assert.ok(match, `${name} must be defined as a top-level string constant`);
  return JSON.parse(match[1]);
}

// Extract the A3 fenced `text` block (the mirrored MCP `instructions` string)
// from appendix-a1-a4.md, tolerant of CRLF so a stray line-ending does not read
// as byte drift.
function extractA3Block(source) {
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const start = normalized.indexOf("## A3");
  assert.notEqual(start, -1, "appendix-a1-a4.md must contain the A3 section");
  const match = normalized.slice(start).match(/```text\n([\s\S]*?)\n```/);
  assert.ok(match, "A3 section must open a fenced text block");
  return match[1];
}

function extractPostWriteResponse(source) {
  const heading = "## Post-write response (exact, byte-for-byte)";
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, "handoff.md must contain the post-write response section");
  const fenceStart = source.indexOf("```", start);
  assert.notEqual(fenceStart, -1, "post-write response section must open a fenced block");
  const textStart = source.indexOf("\n", fenceStart) + 1;
  const fenceEnd = source.indexOf("```", textStart);
  assert.notEqual(fenceEnd, -1, "post-write response section must close its fenced block");
  return source.slice(textStart, fenceEnd).replace(/\r?\n$/, "");
}

test("A2 read-escalation ladder is byte-identical in init.ts and index.ts", () => {
  const inInit = initSrc.includes(A2_LADDER);
  const inIndex = indexSrc.includes(A2_LADDER);

  if (!inInit || !inIndex) {
    const fromInit = extractLadder(initSrc);
    const fromIndex = extractLadder(indexSrc);
    const d =
      fromInit && fromIndex
        ? diff(fromInit, fromIndex)
        : { note: "ladder paragraph not found in one of the files" };
    assert.fail(
      "A2 read-escalation ladder DRIFTED between src/init.ts and src/index.ts.\n" +
        `present in init.ts (vs canonical): ${inInit}\n` +
        `present in index.ts (vs canonical): ${inIndex}\n` +
        `drift detail: ${JSON.stringify(d, null, 2)}\n` +
        `--- init.ts copy ---\n${fromInit}\n` +
        `--- index.ts copy ---\n${fromIndex}`
    );
  }

  assert.ok(inInit, "A2 ladder must appear verbatim in src/init.ts");
  assert.ok(inIndex, "A2 ladder must appear verbatim in src/index.ts");
});

test("A4 jointly binding clause is present verbatim in INIT_BLOCK (src/init.ts)", () => {
  assert.ok(
    initSrc.includes(A4_JOINTLY_BINDING),
    "A4 jointly binding precedence clause must appear verbatim in the INIT_BLOCK so all three host files are identical by construction"
  );
});

test("A3 MCP instructions string is byte-identical in index.ts and appendix-a1-a4.md", () => {
  const live = extractStringConstant(indexSrc, "ORCHESTRATION_INSTRUCTIONS");
  const mirror = extractA3Block(appendixA1A4);
  if (live !== mirror) {
    const d = diff(live, mirror);
    assert.fail(
      "A3 MCP instructions DRIFTED between src/index.ts and appendix-a1-a4.md.\n" +
        `drift detail: ${JSON.stringify(d, null, 2)}\n` +
        `--- index.ts copy ---\n${live}\n` +
        `--- appendix A3 copy ---\n${mirror}`
    );
  }
  assert.equal(mirror, live);
});

test("handoff-write success message is byte-identical in index.ts and handoff.md", () => {
  const sourceMessage = extractStringConstant(indexSrc, "HANDOFF_WRITE_SUCCESS_MESSAGE");
  const specMessage = extractPostWriteResponse(handoffSpec);
  assert.equal(sourceMessage, specMessage);
});
