import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { atomicWriteJson } from "./atomic-write.js";
import { cwdHash, stateDir } from "./marker.js";

export const HANDOFF_THRESHOLD_PCT = 50;
export const HANDOFF_CONTENT_LIMIT = 4000;
export const HANDOFF_OVERFLOW_LIMIT = 8000;

export const UNAVAILABLE_NO_METERING =
  "handoff-write is not available due to missing context size data. It will become available once context usage can be measured for this session.";
export const UNAVAILABLE_BELOW_50 =
  "handoff-write is not available until this session reaches 50% context utilization (currently below threshold).";
export const OVERSIZE_CONTENT =
  "handoff content exceeds the 4000-character limit; shorten it, or move the excess (up to 8000 additional characters) into a separate file and reference its full path inside the 4000-character content.";
export const OVERSIZE_OVERFLOW =
  "handoff overflow content exceeds the 8000-character limit; shorten the overflow file content and retry.";
export const NO_HANDOFF_FOUND =
  "No handoff found for this directory. Resume the previous session and ask it to write one via handoff-write.";

export const HANDOFF_WRITE_SUCCESS =
  "We are ready to start a new session, to avoid wasting tokens, use the structured question tool to confirm that the user is ready to use the `handoff-resume skill` in the next new session to resume work and has cleared the current /goal (if present) - or you will be compelled to keep working on a potential /goal that needs to be halted for a new session.";

export interface HandoffRecord {
  content: string;
  overflow_path: string | null;
  created_at: number;
  created_by_session: string;
  read_by_session: string | null;
  read_at: number | null;
}

export interface HandoffMetering {
  used_percentage: number | null;
}

export interface WriteHandoffInput {
  content: string;
  overflowContent?: string | null;
  createdBySession: string;
}

export type HandoffError =
  | typeof UNAVAILABLE_NO_METERING
  | typeof UNAVAILABLE_BELOW_50
  | typeof OVERSIZE_CONTENT
  | typeof OVERSIZE_OVERFLOW;

export type HandoffResult =
  | { ok: true; record: HandoffRecord }
  | { ok: false; error: HandoffError };

export type HandoffGateResult =
  | { ok: true }
  | { ok: false; error: typeof UNAVAILABLE_NO_METERING | typeof UNAVAILABLE_BELOW_50 };

export function handoffPath(cwd: string): string {
  return join(stateDir, "handoff-" + cwdHash(cwd) + ".json");
}

export function handoffOverflowPath(cwd: string, now = Date.now()): string {
  return join(stateDir, "handoff-overflow-" + cwdHash(cwd) + "-" + now + ".md");
}

export function checkHandoffWriteAvailable(metering: HandoffMetering | null | undefined): HandoffGateResult {
  const used = metering?.used_percentage;
  if (typeof used !== "number" || !Number.isFinite(used)) {
    return { ok: false, error: UNAVAILABLE_NO_METERING };
  }
  if (used < HANDOFF_THRESHOLD_PCT) {
    return { ok: false, error: UNAVAILABLE_BELOW_50 };
  }
  return { ok: true };
}

export function readHandoff(cwd: string): HandoffRecord | null {
  try {
    const raw = readFileSync(handoffPath(cwd), "utf8");
    return validateHandoffRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeHandoff(cwd: string, input: WriteHandoffInput): HandoffResult {
  if (input.content.length > HANDOFF_CONTENT_LIMIT) {
    return { ok: false, error: OVERSIZE_CONTENT };
  }
  const overflowContent = input.overflowContent ?? "";
  if (overflowContent.length > HANDOFF_OVERFLOW_LIMIT) {
    return { ok: false, error: OVERSIZE_OVERFLOW };
  }

  mkdirSync(stateDir, { recursive: true, mode: 0o700 });

  const overflowPath = overflowContent.length > 0 ? handoffOverflowPath(cwd) : null;
  if (overflowPath !== null) {
    writeFileSync(overflowPath, overflowContent, { encoding: "utf8", mode: 0o600 });
  }

  const record: HandoffRecord = {
    content: input.content,
    overflow_path: overflowPath,
    created_at: Date.now(),
    created_by_session: input.createdBySession,
    read_by_session: null,
    read_at: null,
  };
  atomicWriteJson(handoffPath(cwd), record, { encoding: "utf8", mode: 0o600 });
  return { ok: true, record };
}

export function writeHandoffIfAvailable(
  cwd: string,
  input: WriteHandoffInput,
  metering: HandoffMetering | null | undefined,
): HandoffResult {
  const gate = checkHandoffWriteAvailable(metering);
  if (!gate.ok) return gate;
  return writeHandoff(cwd, input);
}

export function markRead(cwd: string, sessionKey: string): HandoffRecord | null {
  const record = readHandoff(cwd);
  if (record === null) return null;

  const next: HandoffRecord = {
    ...record,
    read_by_session: sessionKey,
    read_at: Date.now(),
  };
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    atomicWriteJson(handoffPath(cwd), next, { encoding: "utf8", mode: 0o600 });
    return next;
  } catch {
    return null;
  }
}

export function clearHandoff(cwd: string): void {
  const record = readHandoff(cwd);
  unlinkIfPresent(handoffPath(cwd));
  if (record?.overflow_path) {
    unlinkIfPresent(record.overflow_path);
  }
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw e;
    }
  }
}

function validateHandoffRecord(value: unknown): HandoffRecord | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Partial<HandoffRecord>;
  const content = record.content;
  const overflowPath = record.overflow_path;
  const createdAt = record.created_at;
  const createdBySession = record.created_by_session;
  const readBySession = record.read_by_session;
  const readAt = record.read_at;

  if (typeof content !== "string") return null;
  if (content.length > HANDOFF_CONTENT_LIMIT) return null;
  if (!isValidOverflowPath(overflowPath)) return null;
  if (!isFiniteNumber(createdAt)) return null;
  if (typeof createdBySession !== "string") return null;
  if (readBySession !== null && typeof readBySession !== "string") return null;
  if (readAt !== null && !isFiniteNumber(readAt)) return null;

  return {
    content,
    overflow_path: overflowPath,
    created_at: createdAt,
    created_by_session: createdBySession,
    read_by_session: readBySession,
    read_at: readAt,
  };
}

function isValidOverflowPath(path: unknown): path is string | null {
  return path === null || (typeof path === "string" && isAbsolute(path));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
