#!/usr/bin/env node
// `subagent-mcp doctor` — read-only health check for the installed addon.
//
// Diagnoses install completeness, vendor presence, and whether each vendor's
// wiring (MCP server + hooks/statusLine) points at THIS install. Doctor self-repairs
// missing MCP registrations via vendor CLIs; use `subagent-mcp setup` for
// config-file and hook repairs.
//
// Exit code: 0 = everything healthy, 1 = at least one check failed.

import { verifyWiring } from "./setup.js";

export async function runDoctor(): Promise<number> {
  console.log("subagent-mcp doctor (checks wiring, including Claude statusLine; repairs missing MCP registrations via vendor CLIs)\n");

  const major = Number(process.versions.node.split(".")[0]);
  console.log(
    `  ${major >= 18 ? "PASS" : "FAIL"}  node version — ${process.versions.node}` +
      (major >= 18 ? "" : " (Node >= 18 required)")
  );
  let failed = major < 18 ? 1 : 0;

  for (const r of verifyWiring(undefined, true)) {
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
