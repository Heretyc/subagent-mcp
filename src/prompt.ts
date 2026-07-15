import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface } from "node:readline/promises";

export interface PromptOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function askYesNo(opts: PromptOptions, prompt: string): Promise<boolean> {
  const answer = await askLine(opts, prompt);
  return answer === "" || answer === "y" || answer === "yes";
}

export async function askLine(opts: PromptOptions, prompt: string): Promise<string> {
  const rl = createInterface({
    input: opts.input ?? defaultInput,
    output: opts.output ?? defaultOutput,
  });
  try {
    return (await rl.question(prompt)).trim().toLowerCase();
  } finally {
    rl.close();
  }
}
