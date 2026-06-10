import { existsSync, readFileSync, readdirSync } from "node:fs";

// Single source of truth for vendor-metadata limits. Extracts the server
// `instructions` string, every MCP tool name + description from src/index.ts,
// and measures the per-turn hook directive assets in directives/. Each of the 5
// constraints below maps to an official limit (sources in
// skills/subagent-mcp-installer/references/compliance.md). Exit 1 on any FAIL.
//
// Constraint limits (HARD = vendor truncation point; TARGET = repo budget with
// margin):
//   C1 server instructions  : HARD 2048 B (Claude Code truncates at 2KB);
//                             TARGET 1950 B for tail-safety margin.
//   C2 tool descriptions     : HARD 2048 B each (same 2KB Claude Code cap).
//   C3 tool names            : ^[a-zA-Z0-9_-]{1,128}$ (Anthropic/OpenAI fn-name
//                             charset everyone downstream enforces).
//   C4 hook additionalContext: < 10000 chars (Claude Code UserPromptSubmit cap)
//                             for each directive asset AND each provider's
//                             carryover+full combined injection.
//   C5 directive asset budget: orchestration-*.md <= 1250 B, carryover-*.md <=
//                             800 B — keep the caveman-compressed per-turn
//                             injection lean (limits set just above current
//                             sizes with headroom; current max codex 1151 B /
//                             carryover 704 B).

const indexPath = new URL("../src/index.ts", import.meta.url);
const directivesDir = new URL("../directives/", import.meta.url);

const INSTRUCTIONS_HARD = 2048;
const INSTRUCTIONS_TARGET = 1950;
const DESCRIPTION_HARD = 2048;
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const ADDITIONAL_CONTEXT_CAP = 10000;
const ORCHESTRATION_ASSET_MAX = 1250;
const CARRYOVER_ASSET_MAX = 800;

const bytes = (s) => Buffer.byteLength(s, "utf8");

// Parse one JS/TS string literal (double, single, or backtick) starting at the
// quote char at `i`. Returns { value, end } where end is index AFTER the closing
// quote. Handles backslash escapes; backtick literals here carry no
// interpolation (descriptions use backticks as literal chars).
function parseLiteral(src, i) {
  const quote = src[i];
  let out = "";
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      const n = src[j + 1];
      const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'", "`": "`" };
      out += Object.hasOwn(map, n) ? map[n] : n;
      j += 2;
      continue;
    }
    if (c === quote) return { value: out, end: j + 1 };
    out += c;
    j += 1;
  }
  throw new Error(`unterminated string literal at offset ${i}`);
}

// Parse one or more string literals joined by `+` (TS concatenation), starting
// at the first non-space char from `i`. Returns { value, end }.
function parseConcatenated(src, i) {
  let value = "";
  let j = i;
  for (;;) {
    while (j < src.length && /\s/.test(src[j])) j += 1;
    const c = src[j];
    if (c !== '"' && c !== "'" && c !== "`") {
      if (value === "") throw new Error(`expected string literal at offset ${j}`);
      return { value, end: j };
    }
    const lit = parseLiteral(src, j);
    value += lit.value;
    j = lit.end;
    while (j < src.length && /\s/.test(src[j])) j += 1;
    if (src[j] === "+") {
      j += 1;
      continue;
    }
    return { value, end: j };
  }
}

function extractInstructions(src) {
  const m = src.match(/const\s+ORCHESTRATION_INSTRUCTIONS\s*=/);
  if (!m) throw new Error("ORCHESTRATION_INSTRUCTIONS declaration not found in src/index.ts");
  return parseConcatenated(src, m.index + m[0].length).value;
}

// Each `server.tool(` call: first concatenated string = name, then `,`, then
// second concatenated string = description.
function extractTools(src) {
  const tools = [];
  const re = /server\.tool\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    const name = parseConcatenated(src, i);
    i = name.end;
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] !== ",") throw new Error(`expected ',' after tool name at offset ${i}`);
    i += 1;
    const desc = parseConcatenated(src, i);
    tools.push({ name: name.value, description: desc.value });
  }
  return tools;
}

function main() {
  if (!existsSync(indexPath)) {
    console.log("FAIL src/index.ts not found");
    return 1;
  }
  const src = readFileSync(indexPath, "utf8");
  const results = [];

  // C1 — server instructions.
  const instr = extractInstructions(src);
  const instrB = bytes(instr);
  results.push({
    name: `C1 server instructions <= ${INSTRUCTIONS_TARGET} B (hard ${INSTRUCTIONS_HARD} B)`,
    fail: instrB > INSTRUCTIONS_TARGET,
    detail: `${instrB} B`,
  });

  // C2 — tool descriptions, C3 — tool names.
  const tools = extractTools(src);
  if (tools.length === 0) {
    results.push({ name: "tool extraction", fail: true, detail: "no server.tool() calls parsed" });
  }
  for (const t of tools) {
    const dB = bytes(t.description);
    results.push({
      name: `C2 desc[${t.name}] <= ${DESCRIPTION_HARD} B`,
      fail: dB > DESCRIPTION_HARD,
      detail: `${dB} B`,
    });
    results.push({
      name: `C3 name[${t.name}] matches ${TOOL_NAME_RE.source}`,
      fail: !TOOL_NAME_RE.test(t.name),
      detail: TOOL_NAME_RE.test(t.name) ? "ok" : "invalid charset/length",
    });
  }

  // C4 + C5 — directive assets.
  const dirFiles = readdirSync(directivesDir).filter((f) => f.endsWith(".md"));
  const read = (f) => readFileSync(new URL(f, directivesDir), "utf8");
  for (const f of dirFiles) {
    const content = read(f);
    const len = content.length; // chars (additionalContext cap is char-based)
    const b = bytes(content);
    results.push({
      name: `C4 asset[${f}] < ${ADDITIONAL_CONTEXT_CAP} chars`,
      fail: len >= ADDITIONAL_CONTEXT_CAP,
      detail: `${len} chars`,
    });
    if (f.startsWith("orchestration-")) {
      results.push({
        name: `C5 asset[${f}] <= ${ORCHESTRATION_ASSET_MAX} B`,
        fail: b > ORCHESTRATION_ASSET_MAX,
        detail: `${b} B`,
      });
    } else if (f.startsWith("carryover-")) {
      results.push({
        name: `C5 asset[${f}] <= ${CARRYOVER_ASSET_MAX} B`,
        fail: b > CARRYOVER_ASSET_MAX,
        detail: `${b} B`,
      });
    }
  }

  // C4 — combined carryover+full injection per provider (hook prepends the
  // carryover notice to the full directive once per marker).
  for (const provider of ["claude", "codex"]) {
    const cf = `carryover-${provider}.md`;
    const of = `orchestration-${provider}.md`;
    if (dirFiles.includes(cf) && dirFiles.includes(of)) {
      const combinedLen = (read(cf) + read(of)).length;
      results.push({
        name: `C4 combined[${provider} carryover+full] < ${ADDITIONAL_CONTEXT_CAP} chars`,
        fail: combinedLen >= ADDITIONAL_CONTEXT_CAP,
        detail: `${combinedLen} chars`,
      });
    }
  }

  const failures = results.filter((r) => r.fail);
  for (const r of results) {
    console.log(`${r.fail ? "FAIL" : "PASS"} ${r.name} (${r.detail})`);
  }
  if (failures.length > 0) {
    console.log(`\nFAIL MCP metadata compliance: ${failures.length} constraint(s) breached`);
    return 1;
  }
  console.log(`\nPASS MCP metadata compliance: ${results.length} constraints`);
  return 0;
}

process.exit(main());
