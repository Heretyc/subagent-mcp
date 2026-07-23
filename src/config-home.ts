import { homedir } from "node:os";
import { join } from "node:path";

export function getConfigHome(): string {
  if (process.env.SUBAGENT_CONFIG_HOME) return process.env.SUBAGENT_CONFIG_HOME;
  return join(homedir(), ".subagent-mcp");
}
