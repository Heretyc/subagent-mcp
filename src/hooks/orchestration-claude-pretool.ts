import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  runClaudePreTool,
  type PreToolPayload,
} from "../orchestration/pretool.js";

/**
 * Claude Code PreToolUse hook entry. Enforces deterministic subagent-mcp
 * routing only while the server heartbeat is fresh; stale/missing heartbeat is
 * fail-open so a broken MCP server never traps the user.
 */

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

async function main(): Promise<void> {
  let payload: PreToolPayload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) {
      payload = JSON.parse(raw) as PreToolPayload;
    }
  } catch {
    payload = {};
  }
  const result = runClaudePreTool(payload, process.env);
  if (result) {
    process.stdout.write(JSON.stringify(result));
  }
  process.exit(0);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  void main();
}
