import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface } from "node:readline";
import { createInterface as createQuestionInterface } from "node:readline/promises";

export interface PromptOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function askYesNo(opts: PromptOptions, prompt: string): Promise<boolean> {
  const answer = await askLine(opts, prompt);
  return answer === "" || answer === "y" || answer === "yes";
}

export interface PromptSession {
  ask(prompt: string): Promise<string>;
  close(): void;
}

/**
 * One readline interface held open across several questions.
 *
 * askLine opens and closes an interface per question, which is fine for a
 * single question on a live TTY but loses everything readline has already
 * buffered when the next question opens a fresh interface. Any flow that asks
 * more than once - a re-prompt after bad input, or a pair of settings - must
 * share ONE session so piped and mocked stdin behave like a terminal.
 */
export function openPromptSession(opts: PromptOptions): PromptSession {
  const rl = createInterface({
    input: opts.input ?? defaultInput,
    crlfDelay: Infinity,
  });
  const output = opts.output ?? defaultOutput;
  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let closed = false;

  const push = (line: string) => {
    const answer = line.trim().toLowerCase();
    const waiter = waiters.shift();
    if (waiter) waiter(answer);
    else lines.push(answer);
  };
  rl.on("line", push);
  rl.on("close", () => {
    closed = true;
    for (const waiter of waiters.splice(0)) waiter("");
  });

  return {
    async ask(prompt: string): Promise<string> {
      output.write(prompt);
      const buffered = lines.shift();
      if (buffered !== undefined) return buffered;
      if (closed) return "";
      return new Promise((resolve) => waiters.push(resolve));
    },
    close(): void {
      rl.close();
    },
  };
}

export interface RetryPromptOptions extends PromptOptions {
  log?: (line: string) => void;
  /** Reuse an open session; omit to open one interface per question. */
  session?: PromptSession;
}

function askerFor(opts: RetryPromptOptions): (prompt: string) => Promise<string> {
  const session = opts.session;
  return session ? (prompt) => session.ask(prompt) : (prompt) => askLine(opts, prompt);
}

/**
 * Yes/no question that RE-ASKS until the answer is recognized. Empty input takes
 * `fallback`. Unlike askYesNo (which treats anything unrecognized as "no"), a
 * typo here never silently flips a setting.
 */
export async function askYesNoStrict(
  opts: RetryPromptOptions,
  prompt: string,
  fallback: boolean
): Promise<boolean> {
  const ask = askerFor(opts);
  for (;;) {
    const answer = await ask(prompt);
    if (answer === "") return fallback;
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    opts.log?.("Enter y or n.");
  }
}

/**
 * Whole-number question bounded to [min, max], re-asking until valid. Empty
 * input takes `fallback`.
 */
export async function askIntegerInRange(
  opts: RetryPromptOptions,
  prompt: string,
  min: number,
  max: number,
  fallback: number
): Promise<number> {
  const ask = askerFor(opts);
  for (;;) {
    const answer = await ask(prompt);
    if (answer === "") return fallback;
    const value = /^[+-]?\d+$/.test(answer) ? Number(answer) : Number.NaN;
    if (Number.isInteger(value) && value >= min && value <= max) return value;
    opts.log?.(`Enter a whole number from ${min} to ${max}.`);
  }
}

export async function askLine(opts: PromptOptions, prompt: string): Promise<string> {
  const rl = createQuestionInterface({
    input: opts.input ?? defaultInput,
    output: opts.output ?? defaultOutput,
  });
  try {
    return (await rl.question(prompt)).trim().toLowerCase();
  } finally {
    rl.close();
  }
}
