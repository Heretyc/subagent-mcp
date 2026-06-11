#!/usr/bin/env node
// `subagent-mcp doctor` — read-only health check for the installed addon.
//
// Diagnoses without touching any file: install completeness, vendor presence,
// and whether each vendor's wiring (MCP server + hooks) points at THIS install.
// The fixer is always `subagent-mcp setup` (idempotent, self-repairing); doctor
// just tells you whether you need it and what exactly is wrong.
//
// Exit code: 0 = everything healthy, 1 = at least one check failed.

import { verifyWiring } from "./setup.js";

export async function runDoctor(): Promise<number> {
  console.log("subagent-mcp doctor (read-only — changes nothing)\n");

  const major = Number(process.versions.node.split(".")[0]);
  console.log(
    `  ${major >= 18 ? "PASS" : "FAIL"}  node version — ${process.versions.node}` +
      (major >= 18 ? "" : " (Node >= 18 required)")
  );
  let failed = major < 18 ? 1 : 0;

  for (const r of verifyWiring()) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label} — ${r.detail}`);
    if (!r.ok) failed++;
  }

  if (failed === 0) {
    console.log(
      "\nAll checks passed. If tools still don't appear in a session:\n" +
        "  - Claude Code: restart the session, run /mcp\n" +
        "  - Codex CLI:   restart the session, run /hooks (the hook must be TRUSTED)"
    );
    return 0;
  }
  console.log(
    `\n${failed} check(s) failed. Fix automatically with:  subagent-mcp setup\n` +
      "(setup is idempotent: it repairs stale paths and re-adds missing wiring,\n" +
      " backing up each config file before its first edit.)"
  );
  return 1;
}
