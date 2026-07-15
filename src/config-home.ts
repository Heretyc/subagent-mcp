import { homedir } from "node:os";
import { join } from "node:path";

export function getConfigHome(): string {
  return join(homedir(), ".subagent-mcp");
}
