import { existsSync, readFileSync } from "node:fs";
import { stripJsoncComments } from "./concurrency.js";

export type JsonObj = Record<string, any>;

export function jsonErrorWithLine(text: string, message: string): string {
  const pos = /position (\d+)/.exec(message)?.[1];
  if (!pos) return message;
  const n = Number(pos);
  const lineNo = stripJsoncComments(text).slice(0, n).split(/\r?\n/).length;
  return `${message}; line ${lineNo}`;
}

export function parseJsoncFile(file: string): { ok: true; json: JsonObj } | { ok: false; error: string } {
  if (!existsSync(file)) return { ok: false, error: `missing ${file}` };
  const text = readFileSync(file, "utf8");
  try {
    const json = JSON.parse(stripJsoncComments(text));
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { ok: false, error: "expected JSON object" };
    }
    return { ok: true, json: json as JsonObj };
  } catch (e) {
    const error = e instanceof SyntaxError
      ? jsonErrorWithLine(text, e.message)
      : e instanceof Error ? e.message : String(e);
    return { ok: false, error };
  }
}
