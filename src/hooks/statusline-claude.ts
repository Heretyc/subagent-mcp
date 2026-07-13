import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import {
  statuslineRecordFromPayload,
  writeStatuslineRecord,
  type StatuslinePayload,
} from "../orchestration/statusline-state.js";

function readStdinBuffer(): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    process.stdin.on("end", () => resolve(Buffer.concat(chunks)));
    process.stdin.on("error", () => resolve(Buffer.concat(chunks)));
  });
}

function parsePayload(raw: Buffer): StatuslinePayload {
  try {
    const text = raw.toString("utf8");
    if (!text.trim()) return {};
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as StatuslinePayload
      : {};
  } catch {
    return {};
  }
}

function defaultLine(payload: StatuslinePayload): string {
  const model =
    payload.model && typeof payload.model === "object" && !Array.isArray(payload.model)
      ? (payload.model as { display_name?: unknown }).display_name
      : null;
  const contextWindow =
    payload.context_window &&
    typeof payload.context_window === "object" &&
    !Array.isArray(payload.context_window)
      ? payload.context_window as { used_percentage?: unknown }
      : {};
  const label = typeof model === "string" && model.trim()
    ? model.trim()
    : "Claude";
  const pct = typeof contextWindow.used_percentage === "number" &&
    Number.isFinite(contextWindow.used_percentage)
      ? ` Ctx:${Math.round(contextWindow.used_percentage)}%`
      : "";
  return `${label}${pct}\n`;
}

function writeSideChannel(payload: StatuslinePayload): void {
  try {
    const record = statuslineRecordFromPayload(payload);
    if (record !== null) writeStatuslineRecord(payload, record);
  } catch {
    // Status lines must never fail rendering.
  }
}

const MAX_INNER_STDOUT_BYTES = 64 * 1024;

function delegate(command: string, raw: Buffer, fallback: string): Promise<void> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let buffered = 0;
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      const output = Buffer.concat(chunks, buffered);
      process.stdout.write(output.toString("utf8").trim() ? output : fallback);
      resolve();
    };
    try {
      const child = spawn(command, {
        shell: true,
        stdio: ["pipe", "pipe", "inherit"],
      });
      child.stdout.on("data", (chunk) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        if (buffered >= MAX_INNER_STDOUT_BYTES) return;
        const remaining = MAX_INNER_STDOUT_BYTES - buffered;
        const stored = data.byteLength <= remaining
          ? data
          : data.subarray(0, remaining);
        chunks.push(stored);
        buffered += stored.byteLength;
      });
      child.on("error", () => {
        if (resolved) return;
        resolved = true;
        process.stdout.write(fallback);
        resolve();
      });
      child.on("close", () => {
        finish();
      });
      child.stdin.end(raw);
    } catch {
      process.stdout.write(fallback);
      resolve();
    }
  });
}

export async function runStatusline(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const raw = await readStdinBuffer();
  const payload = parsePayload(raw);
  const fallback = defaultLine(payload);
  writeSideChannel(payload);
  const inner = (argv.length === 1 ? argv[0] : argv.join(" ")).trim();
  if (inner) {
    await delegate(inner, raw, fallback);
  } else {
    process.stdout.write(fallback);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  runStatusline()
    .catch(() => {
      process.stdout.write("Claude\n");
    })
    .finally(() => process.exit(0));
}
