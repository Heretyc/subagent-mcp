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
import { INIT_BLOCK, extractManagedBlock } from "../dist/init.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const initSrc = readFileSync(join(repoRoot, "src", "init.ts"), "utf8");
const indexSrc = readFileSync(join(repoRoot, "src", "index.ts"), "utf8");
const repoAgents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
const repoClaude = readFileSync(join(repoRoot, "CLAUDE.md"), "utf8");
const repoGemini = readFileSync(join(repoRoot, "GEMINI.md"), "utf8");
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

const TASK_TRACKING_DIRECTIVE =
  "TASK TRACKING: track multi-step work with the harness-native task tracking tool (if one exists), keeping statuses current as work progresses.";
const WAIT_ON_AGENTS_DIRECTIVE =
  "WAIT-ON-AGENTS: When waiting for agents to finish processing, utilize the SMCP (Subagent-MCP) wait tool on loop rather than less efficient harness native methods";

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

// Extract the A1 fenced `text` block (the canonical INIT_BLOCK body) from
// appendix-a1-a4.md, CRLF-tolerant so a stray line-ending is not read as drift.
function extractA1Block(source) {
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const start = normalized.indexOf("## A1");
  assert.notEqual(start, -1, "appendix-a1-a4.md must contain the A1 section");
  const match = normalized.slice(start).match(/```text\n([\s\S]*?)\n```/);
  assert.ok(match, "A1 section must open a fenced text block");
  return match[1];
}

// Extract the first fenced `text` block that follows a heading (e.g. "## A2",
// "## A4"), CRLF-tolerant so a stray line-ending is not read as content drift.
function extractFenceAfter(source, heading) {
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const start = normalized.indexOf(heading);
  assert.notEqual(start, -1, `appendix-a1-a4.md must contain the ${heading} section`);
  const match = normalized.slice(start).match(/```text\n([\s\S]*?)\n```/);
  assert.ok(match, `${heading} section must open a fenced text block`);
  return match[1];
}

// Host instruction files carry their own EOL (CRLF here); normalize so the
// managed-block comparison is about CONTENT, not line-ending, drift.
function normalizeEol(s) {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

test("A2/A4 standalone fences are the dash-to-colon mirror of their A1/host canonical", () => {
  // The standalone A2/A4 fences sit OUTSIDE the managed block, so the ASCII
  // prose gate forbids the em dash and they render it as a colon. That
  // dash-to-colon substitution (plus EOL) is the ONLY documented transform:
  // assert exact parity against the canonical A1/host content so the fences
  // stay semantic mirrors and cannot silently drift on anything else.
  const dashToColon = (s) => s.replace(/—/g, ":");
  const sliceCanonical = (block, startMarker, endMarker) => {
    const start = block.indexOf(startMarker);
    const end = block.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `INIT_BLOCK must contain "${startMarker}"`);
    return block.slice(start, end + endMarker.length);
  };

  const ladderCanonical = sliceCanonical(
    INIT_BLOCK, "READ-ESCALATION LADDER", "NEVER reads those files."
  );
  const a4Canonical = sliceCanonical(
    INIT_BLOCK, "HARNESS-HOOK STATE:", "mistaken or out of date."
  );

  assert.equal(
    normalizeEol(extractFenceAfter(appendixA1A4, "## A2")),
    normalizeEol(dashToColon(ladderCanonical)),
    "A2 fence must equal the A1/index.ts read-ladder after only dash->colon + EOL normalization"
  );
  assert.equal(
    normalizeEol(extractFenceAfter(appendixA1A4, "## A4")),
    normalizeEol(dashToColon(a4Canonical)),
    "A4 fence must equal the A1/host HARNESS-HOOK STATE + PRECEDENCE clause after only dash->colon + EOL normalization"
  );
});

test("task tracking directive is present in INIT_BLOCK and repo mirrors", () => {
  for (const [name, body] of [
    ["src/init.ts", initSrc],
    ["AGENTS.md", repoAgents],
    ["CLAUDE.md", repoClaude],
    ["GEMINI.md", repoGemini],
  ]) {
    assert.ok(
      body.includes(TASK_TRACKING_DIRECTIVE),
      `${name} must include the harness-native task tracking directive`
    );
    assert.ok(
      body.includes(WAIT_ON_AGENTS_DIRECTIVE),
      `${name} must include the SMCP wait-loop directive`
    );
  }
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

// --- Schema-5 canonical/mirror invariants ----------------------------------

test("A1 canonical INIT_BLOCK is byte-identical in dist/init.js and appendix-a1-a4.md", () => {
  const mirror = extractA1Block(appendixA1A4);
  if (INIT_BLOCK !== mirror) {
    const d = diff(INIT_BLOCK, mirror);
    assert.fail(
      "A1 INIT_BLOCK DRIFTED between src/init.ts (INIT_BLOCK) and appendix-a1-a4.md.\n" +
        `drift detail: ${JSON.stringify(d, null, 2)}\n` +
        `--- INIT_BLOCK (canonical) ---\n${INIT_BLOCK}\n` +
        `--- appendix A1 copy ---\n${mirror}`
    );
  }
  assert.equal(mirror, INIT_BLOCK);
});

test("all three repo managed blocks match the canonical INIT_BLOCK (mod EOL)", () => {
  for (const [name, body] of [
    ["AGENTS.md", repoAgents],
    ["CLAUDE.md", repoClaude],
    ["GEMINI.md", repoGemini],
  ]) {
    const block = extractManagedBlock(body);
    assert.ok(block, `${name} must contain a subagent-mcp managed block`);
    assert.equal(
      normalizeEol(block),
      normalizeEol(INIT_BLOCK),
      `${name} managed block must be byte-identical (mod EOL) to the canonical INIT_BLOCK`
    );
  }
});

test("SOLE CHANNEL binds in BOTH orchestration states across canonical + mirrors + MCP instructions", () => {
  const instructions = extractStringConstant(indexSrc, "ORCHESTRATION_INSTRUCTIONS");
  assert.ok(INIT_BLOCK.includes("SOLE CHANNEL — BOTH ORCHESTRATION STATES"),
    "INIT_BLOCK must carry the both-states sole-channel directive");
  assert.match(INIT_BLOCK, /whether orchestration is ON or OFF/,
    "INIT_BLOCK sole channel must apply in BOTH the ON and OFF states");
  assert.ok(instructions.includes("SOLE CHANNEL - BOTH STATES"),
    "MCP instructions must carry the both-states sole-channel directive");
  for (const [name, body] of [["AGENTS.md", repoAgents], ["CLAUDE.md", repoClaude], ["GEMINI.md", repoGemini]]) {
    assert.ok(body.includes("SOLE CHANNEL — BOTH ORCHESTRATION STATES"),
      `${name} must carry the both-states sole-channel directive`);
  }
});

test("MODEL SELECTION smart/automatic default is present in canonical + MCP instructions", () => {
  const instructions = extractStringConstant(indexSrc, "ORCHESTRATION_INSTRUCTIONS");
  assert.ok(INIT_BLOCK.includes("MODEL SELECTION: defaults to smart/automatic"),
    "INIT_BLOCK must state the smart/automatic model-selection default");
  assert.match(instructions, /MODEL\. Unset = smart auto-selection/,
    "MCP instructions must state the smart auto-selection default");
});

test("stale disable polarity wording is absent from canonical + mirrors + MCP instructions", () => {
  const instructions = extractStringConstant(indexSrc, "ORCHESTRATION_INSTRUCTIONS");
  const surfaces = [
    ["INIT_BLOCK", INIT_BLOCK],
    ["ORCHESTRATION_INSTRUCTIONS", instructions],
    ["AGENTS.md managed block", extractManagedBlock(repoAgents) ?? ""],
    ["CLAUDE.md managed block", extractManagedBlock(repoClaude) ?? ""],
    ["GEMINI.md managed block", extractManagedBlock(repoGemini) ?? ""],
  ];
  for (const [name, body] of surfaces) {
    assert.ok(!/resumes ON/.test(body),
      `${name} must not keep the stale "resumes ON next new session" polarity`);
    assert.ok(!/no mid-session re-enable/.test(body),
      `${name} must not keep the stale "no mid-session re-enable" polarity`);
  }
});

// Stale carryover polarity must also be rejected in the SHIPPED/EMITTED carryover
// directive bodies AND their A5 spec mirror — not only the managed blocks / MCP
// instructions covered above. The carryover carrier describes a current-session
// state/latch event; it must not claim cross-session persistence.
test("stale carryover polarity is absent from carryover directives + A5 mirror", () => {
  const directivesDir = join(repoRoot, "directives");
  const carryoverClaude = readFileSync(join(directivesDir, "carryover-claude.md"), "utf8");
  const carryoverCodex = readFileSync(join(directivesDir, "carryover-codex.md"), "utf8");
  const appendixA5 = readFileSync(
    join(repoRoot, "docs", "spec", "dev-loop", "orchestration-directive-architecture", "appendix-a5-directives.md"),
    "utf8"
  );
  const STALE = [
    [/resumes ON/, "resumes ON next new session"],
    [/no mid-session re-enable/i, "no mid-session re-enable"],
    [/carried over from a PRIOR session/i, "carried over from a PRIOR session"],
  ];
  const carryoverSurfaces = [
    ["directives/carryover-claude.md", carryoverClaude],
    ["directives/carryover-codex.md", carryoverCodex],
    ["appendix-a5-directives.md", appendixA5],
  ];
  for (const [name, body] of carryoverSurfaces) {
    for (const [re, label] of STALE) {
      assert.ok(!re.test(body),
        `${name} must not keep the stale "${label}" carryover polarity`);
    }
  }
  // New schema=5 model must be stated in the carryover bodies (A5 mirrors them):
  // THIS-session-only disable + user-approved mid-session re-enable.
  for (const [name, body] of carryoverSurfaces.slice(0, 2)) {
    assert.match(body, /THIS session only/i,
      `${name} must scope the disable to THIS session only`);
    assert.match(body, /re-enable mid-session/i,
      `${name} must allow user-approved enabled:true mid-session re-enable`);
  }
});
