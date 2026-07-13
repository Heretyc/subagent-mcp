import {
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { atomicWriteJson } from "./atomic-write.js";
import { cwdHash, hashKey, stateDir } from "./marker.js";

export const STATUSLINE_TTL_MS = 24 * 60 * 60 * 1000;

export interface StatuslineUsage {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
}

export interface StatuslineRecord {
  session_id?: string | null;
  used_percentage?: number | null;
  context_window_size?: number | null;
  usage: StatuslineUsage;
  updated_at: number;
  source: "statusline";
}

export interface StatuslinePayload {
  cwd?: unknown;
  session_id?: unknown;
  transcript_path?: unknown;
  [key: string]: unknown;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePathKey(pathValue: string): string {
  let p = resolve(pathValue);
  p = p.replace(/\\/g, "/");
  if (process.platform === "win32") {
    p = p.toLowerCase();
  }
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

export function statuslineSessionKey(payload: StatuslinePayload): string | undefined {
  if (typeof payload.session_id === "string" && payload.session_id.length > 0) {
    return payload.session_id;
  }
  if (
    typeof payload.transcript_path === "string" &&
    payload.transcript_path.length > 0
  ) {
    return "tp-" + hashKey(normalizePathKey(payload.transcript_path));
  }
  return undefined;
}

export function statuslinePathForSession(
  sessionKey: string,
  stateDirOverride = stateDir,
): string {
  return join(stateDirOverride, "sl-" + hashKey(sessionKey) + ".json");
}

export function statuslinePathForCwd(
  cwd: string,
  stateDirOverride = stateDir,
): string {
  return join(stateDirOverride, "sl-cwd-" + cwdHash(cwd) + ".json");
}

function pathForPayload(
  payload: StatuslinePayload,
  stateDirOverride = stateDir,
): string | null {
  const key = statuslineSessionKey(payload);
  if (key !== undefined) return statuslinePathForSession(key, stateDirOverride);
  return typeof payload.cwd === "string" && payload.cwd.length > 0
    ? statuslinePathForCwd(payload.cwd, stateDirOverride)
    : null;
}

function isStatuslineRecord(value: unknown): value is StatuslineRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StatuslineRecord>;
  return record.source === "statusline" && finiteNumber(record.updated_at);
}

export function writeStatuslineRecord(
  payload: StatuslinePayload,
  record: StatuslineRecord,
  stateDirOverride = stateDir,
): boolean {
  try {
    const path = pathForPayload(payload, stateDirOverride);
    if (path === null) return false;
    mkdirSync(stateDirOverride, { recursive: true, mode: 0o700 });
    atomicWriteJson(path, record, { encoding: "utf8", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function readFresh(path: string, now: number): StatuslineRecord | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isStatuslineRecord(parsed)) return null;
    if (now - parsed.updated_at > STATUSLINE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readStatuslineRecord(
  sessionKey: string | undefined,
  cwd: string | undefined,
  stateDirOverride = stateDir,
  now = Date.now(),
): StatuslineRecord | null {
  if (sessionKey !== undefined) {
    const keyed = readFresh(statuslinePathForSession(sessionKey, stateDirOverride), now);
    if (keyed !== null) return keyed;
  }
  if (cwd !== undefined && cwd.length > 0) {
    return readFresh(statuslinePathForCwd(cwd, stateDirOverride), now);
  }
  return null;
}

export function statuslineRecordFromPayload(
  payload: StatuslinePayload,
  now = Date.now(),
): StatuslineRecord | null {
  const contextWindow =
    payload.context_window &&
    typeof payload.context_window === "object" &&
    !Array.isArray(payload.context_window)
      ? payload.context_window as Record<string, unknown>
      : {};
  const currentUsage =
    contextWindow.current_usage &&
    typeof contextWindow.current_usage === "object" &&
    !Array.isArray(contextWindow.current_usage)
      ? contextWindow.current_usage as Record<string, unknown>
      : {};
  const used = contextWindow.used_percentage;
  const size = contextWindow.context_window_size;
  if (!finiteNumber(used) && !finiteNumber(size)) return null;
  return {
    session_id: typeof payload.session_id === "string" ? payload.session_id : null,
    used_percentage: finiteNumber(used) ? used : null,
    context_window_size: finiteNumber(size) ? size : null,
    usage: {
      input: finiteNumber(currentUsage.input_tokens)
        ? currentUsage.input_tokens
        : 0,
      output: finiteNumber(currentUsage.output_tokens)
        ? currentUsage.output_tokens
        : 0,
      cache_creation: finiteNumber(currentUsage.cache_creation_input_tokens)
        ? currentUsage.cache_creation_input_tokens
        : 0,
      cache_read: finiteNumber(currentUsage.cache_read_input_tokens)
        ? currentUsage.cache_read_input_tokens
        : 0,
    },
    updated_at: now,
    source: "statusline",
  };
}
