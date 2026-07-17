import { askLine, type PromptOptions } from "./prompt.js";
import { runInit } from "./init.js";

type InitScope = "project" | "global";

export interface SetupInitMenuOptions extends PromptOptions {
  isTTY?: boolean;
  unattended?: boolean;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export async function chooseSetupInitScope(
  opts: SetupInitMenuOptions = {}
): Promise<InitScope> {
  if (opts.unattended) {
    opts.log?.("Init scope: unattended setup, defaulting to global.");
    return "global";
  }

  const tty = opts.isTTY ?? process.stdin.isTTY;
  if (!tty) {
    opts.log?.("Init scope: non-TTY setup, defaulting to global.");
    return "global";
  }

  opts.log?.("Choose init scope for first run:");
  opts.log?.("  1. Project - upsert instruction blocks in this repository.");
  opts.log?.("  2. Global  - upsert home instructions for Claude, Codex, and Gemini. (Recommended)");
  for (;;) {
    const answer = await askLine(opts, "Select [1-2, default 2 Global]: ");
    if (answer === "" || answer === "2" || answer === "g" || answer === "global") return "global";
    if (answer === "1" || answer === "p" || answer === "project") return "project";
    opts.log?.("Enter 1 or 2.");
  }
}

export async function runSetupInitMenu(
  opts: SetupInitMenuOptions & { init?: (args: string[]) => Promise<number> } = {}
): Promise<number> {
  const scope = await chooseSetupInitScope(opts);
  return (opts.init ?? runInit)([
    ...(opts.dryRun ? ["--dry-run"] : []),
    ...(scope === "global" ? ["--global"] : []),
  ]);
}
