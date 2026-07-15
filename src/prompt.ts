import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface } from "node:readline/promises";

export interface PromptOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function askYesNo(opts: PromptOptions, prompt: string): Promise<boolean> {
  const rl = createInterface({
    input: opts.input ?? defaultInput,
    output: opts.output ?? defaultOutput,
  });
  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
