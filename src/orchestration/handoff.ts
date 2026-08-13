import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { atomicWriteJson } from "./atomic-write.js";
import { cwdHash, stateDir } from "./marker.js";
import {
  HANDOFF_REQUIRED_THRESHOLD_PCT,
  HANDOFF_UNLOCK_THRESHOLD_PCT,
} from "./metering.js";
import { modelModeKey } from "./model-mode.js";

export const HANDOFF_THRESHOLD_PCT = HANDOFF_UNLOCK_THRESHOLD_PCT;
export const HANDOFF_CONTENT_LIMIT = 4000;
export const HANDOFF_OVERFLOW_LIMIT = 8000;

/**
 * Current handoff record format version. A fresh handoff-write stamps this and,
 * when written at or above the mandatory-write line, the eligible
 * lifecycle/generation fields. Unversioned records remain readable but are not
 * lifecycle-eligible and are not promoted on read.
 */
export const HANDOFF_RECORD_VERSION = 2;

/**
 * Versioned handoff lifecycle. A fresh write at/above the mandatory-write line
 * is `prepared`; detected auto-compaction moves the writer's own prepared
 * record to `session_handoff_required`, which mandates exactly one hook-injected
 * read; that claim moves it to `resuming`; a completed read moves it to
 * `working`. Only `prepared` may transition on compaction, and only
 * `session_handoff_required` may be claimed, so the read injection fires exactly
 * once per generation.
 */
export type HandoffLifecycle =
  | "prepared"
  | "session_handoff_required"
  | "resuming"
  | "working";

export const UNAVAILABLE_NO_METERING =
  "handoff-write is not available due to missing context size data. It will become available once context usage can be measured for this session.";
/**
 * Compile-time lock between the unlock CONSTANT and the unlock WORDING. The
 * literal below must spell the same number as HANDOFF_UNLOCK_THRESHOLD_PCT or
 * this file fails to typecheck, so the 20% goal-context unlock can never be
 * changed in one place and left stale in the other.
 */
type UnlockUnavailableWording =
  `handoff-write is not available until this session reaches ${typeof HANDOFF_UNLOCK_THRESHOLD_PCT}% context utilization (currently below threshold).`;

export const UNAVAILABLE_BELOW_UNLOCK: UnlockUnavailableWording =
  "handoff-write is not available until this session reaches 20% context utilization (currently below threshold).";

/**
 * Compatibility export for consumers of the threshold-bearing name.
 */
export const UNAVAILABLE_BELOW_40 = UNAVAILABLE_BELOW_UNLOCK;
export const OVERSIZE_CONTENT =
  "handoff content exceeds the 4000-character limit; shorten it, or move the excess (up to 8000 additional characters) into a separate file and reference its full path inside the 4000-character content.";
export const OVERSIZE_OVERFLOW =
  "handoff overflow content exceeds the 8000-character limit; shorten the overflow file content and retry.";
export const NO_HANDOFF_FOUND =
  "No handoff found for this directory. Resume the previous session and ask it to write one via handoff-write.";

export const HANDOFF_WRITE_SUCCESS =
  "Handoff saved. Keep working in the current session. If the handoff is prepared, automatic compaction will require `handoff-read` for one turn before work resumes.";

export interface HandoffRecord {
  content: string;
  overflow_path: string | null;
  created_at: number;
  created_by_session: string;
  read_by_session: string | null;
  read_at: number | null;
  /**
   * Version 2 fields. Unversioned records stay byte-semantically readable and
   * generation-ineligible; fresh writes stamp all three fields.
   */
  version?: number;
  lifecycle?: HandoffLifecycle | null;
  generation?: string | null;
}

export interface HandoffMetering {
  used_percentage: number | null;
}

export interface WriteHandoffInput {
  content: string;
  overflowContent?: string | null;
  createdBySession: string;
  /**
   * The writing session's current utilization. A fresh write at/above the
   * mandatory-write line produces an eligible `prepared` record with a fresh
   * generation UUID; anything lower is readable but generation-ineligible.
   */
  usedPercentage?: number | null;
}

export type HandoffError =
  | typeof UNAVAILABLE_NO_METERING
  | typeof UNAVAILABLE_BELOW_40
  | typeof OVERSIZE_CONTENT
  | typeof OVERSIZE_OVERFLOW;

export type HandoffResult =
  | { ok: true; record: HandoffRecord }
  | { ok: false; error: HandoffError };

export type HandoffGateResult =
  | { ok: true }
  | { ok: false; error: typeof UNAVAILABLE_NO_METERING | typeof UNAVAILABLE_BELOW_40 };

export function handoffPath(cwd: string): string {
  return join(stateDir, "handoff-" + modelModeKey(cwd) + ".json");
}

export function handoffOverflowPath(cwd: string, now = Date.now()): string {
  return join(stateDir, "handoff-overflow-" + modelModeKey(cwd) + "-" + now + ".md");
}

export function checkHandoffWriteAvailable(metering: HandoffMetering | null | undefined): HandoffGateResult {
  const used = metering?.used_percentage;
  if (typeof used !== "number" || !Number.isFinite(used)) {
    return { ok: false, error: UNAVAILABLE_NO_METERING };
  }
  if (used < HANDOFF_THRESHOLD_PCT) {
    return { ok: false, error: UNAVAILABLE_BELOW_UNLOCK };
  }
  return { ok: true };
}

export function readHandoff(cwd: string): HandoffRecord | null {
  return readHandoffWithPath(cwd)?.record ?? null;
}

/**
 * Read the handoff along with the path it came from, preferring the current
 * path over the cwd-hash compatibility path. Lifecycle transitions and markRead
 * write back to the source path, so reads never relocate records.
 */
function readHandoffWithPath(
  cwd: string,
): { record: HandoffRecord; path: string } | null {
  const primary = handoffPath(cwd);
  const current = readHandoffAt(primary);
  if (current !== null) return { record: current, path: primary };
  const compatibilityPath = cwdHashHandoffPath(cwd);
  const compatibilityRecord = readHandoffAt(compatibilityPath);
  if (compatibilityRecord !== null) {
    return { record: compatibilityRecord, path: compatibilityPath };
  }
  return null;
}

function readHandoffAt(path: string): HandoffRecord | null {
  try {
    const raw = readFileSync(path, "utf8");
    return validateHandoffRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * A record is an eligible prepared handoff for `sessionKey` when a fresh write
 * stamped it: current version, `prepared` lifecycle, a real generation UUID,
 * and (when a session is given) authorship by that session. Unversioned records
 * never qualify.
 */
export function isEligiblePrepared(
  record: HandoffRecord | null | undefined,
  sessionKey?: string,
): boolean {
  if (!record) return false;
  if (record.version !== HANDOFF_RECORD_VERSION) return false;
  if (record.lifecycle !== "prepared") return false;
  if (typeof record.generation !== "string" || record.generation.length === 0) return false;
  if (sessionKey !== undefined && record.created_by_session !== sessionKey) return false;
  return true;
}

/**
 * Whether `sessionKey`'s own record is awaiting the one mandated post-compaction
 * read injection.
 */
export function isSessionHandoffRequired(
  record: HandoffRecord | null | undefined,
  sessionKey: string,
): boolean {
  return (
    !!record &&
    record.version === HANDOFF_RECORD_VERSION &&
    record.lifecycle === "session_handoff_required" &&
    record.created_by_session === sessionKey
  );
}

/**
 * Derive `write_required`: at/above the mandatory-write line with no eligible
 * prepared record for this session, a fresh handoff write is owed. Pure read;
 * no state file of its own.
 */
export function isWriteRequired(
  cwd: string,
  sessionKey: string,
  usedPercentage: number | null | undefined,
): boolean {
  if (typeof usedPercentage !== "number" || !Number.isFinite(usedPercentage)) {
    return false;
  }
  if (usedPercentage < HANDOFF_REQUIRED_THRESHOLD_PCT) return false;
  return !isEligiblePrepared(readHandoff(cwd), sessionKey);
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

  // A fresh write at/above the mandatory-write line is the ONLY producer of an
  // eligible prepared record (lifecycle + generation). Lower writes are versioned but
  // carry no lifecycle/generation, so they stay readable yet ineligible.
  const used = input.usedPercentage;
  const eligible =
    typeof used === "number" &&
    Number.isFinite(used) &&
    used >= HANDOFF_REQUIRED_THRESHOLD_PCT;
  const record: HandoffRecord = {
    content: input.content,
    overflow_path: overflowPath,
    created_at: Date.now(),
    created_by_session: input.createdBySession,
    read_by_session: null,
    read_at: null,
    version: HANDOFF_RECORD_VERSION,
    lifecycle: eligible ? "prepared" : null,
    generation: eligible ? randomUUID() : null,
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
  return writeHandoff(cwd, {
    ...input,
    usedPercentage: input.usedPercentage ?? metering?.used_percentage ?? null,
  });
}

export function markRead(cwd: string, sessionKey: string): HandoffRecord | null {
  const found = readHandoffWithPath(cwd);
  if (found === null) return null;

  const next: HandoffRecord = {
    ...found.record,
    read_by_session: sessionKey,
    read_at: Date.now(),
  };
  // Only a current-version record advances lifecycle. Other readable records
  // retain their schema and source path.
  if (found.record.version === HANDOFF_RECORD_VERSION) {
    next.lifecycle = "working";
  }
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    atomicWriteJson(found.path, next, { encoding: "utf8", mode: 0o600 });
    return next;
  } catch {
    return null;
  }
}

/**
 * On detected auto-compaction, move the writer's OWN prepared record to
 * `session_handoff_required`. Only a prepared current-version record authored
 * by this session may transition; every other record is left untouched.
 */
export function markSessionHandoffRequired(
  cwd: string,
  sessionKey: string,
): HandoffRecord | null {
  const found = readHandoffWithPath(cwd);
  if (found === null) return null;
  if (!isEligiblePrepared(found.record, sessionKey)) return null;
  const next: HandoffRecord = { ...found.record, lifecycle: "session_handoff_required" };
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    atomicWriteJson(found.path, next, { encoding: "utf8", mode: 0o600 });
    return next;
  } catch {
    return null;
  }
}

/**
 * Claim the one mandated post-compaction read for this generation, moving
 * `session_handoff_required` -> `resuming`. Returns the transitioned record on
 * the single claiming turn and null thereafter, so the read injection fires
 * exactly once per record UUID.
 */
export function claimSessionHandoffRead(
  cwd: string,
  sessionKey: string,
): HandoffRecord | null {
  const found = readHandoffWithPath(cwd);
  if (found === null) return null;
  if (!isSessionHandoffRequired(found.record, sessionKey)) return null;
  const next: HandoffRecord = { ...found.record, lifecycle: "resuming" };
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    atomicWriteJson(found.path, next, { encoding: "utf8", mode: 0o600 });
    return next;
  } catch {
    return null;
  }
}

export function clearHandoff(cwd: string): void {
  const records = [handoffPath(cwd), cwdHashHandoffPath(cwd)].map(readHandoffAt);
  unlinkIfPresent(handoffPath(cwd));
  unlinkIfPresent(cwdHashHandoffPath(cwd));
  for (const record of records) {
    if (record?.overflow_path) {
      unlinkIfPresent(record.overflow_path);
    }
  }
}

function cwdHashHandoffPath(cwd: string): string {
  return join(stateDir, "handoff-" + cwdHash(cwd) + ".json");
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

  // Version fields are optional so unversioned records remain readable. When
  // present they must be well-formed.
  const version = record.version;
  if (version !== undefined && !isFiniteNumber(version)) return null;
  const lifecycle = record.lifecycle;
  if (
    lifecycle !== undefined &&
    lifecycle !== null &&
    !isHandoffLifecycle(lifecycle)
  ) {
    return null;
  }
  const generation = record.generation;
  if (generation !== undefined && generation !== null && typeof generation !== "string") {
    return null;
  }

  const result: HandoffRecord = {
    content,
    overflow_path: overflowPath,
    created_at: createdAt,
    created_by_session: createdBySession,
    read_by_session: readBySession,
    read_at: readAt,
  };
  // Attach only present version keys so compatibility records retain their
  // schema when serialized.
  if (version !== undefined) result.version = version;
  if (lifecycle !== undefined) result.lifecycle = lifecycle;
  if (generation !== undefined) result.generation = generation;
  return result;
}

function isHandoffLifecycle(value: unknown): value is HandoffLifecycle {
  return (
    value === "prepared" ||
    value === "session_handoff_required" ||
    value === "resuming" ||
    value === "working"
  );
}

function isValidOverflowPath(path: unknown): path is string | null {
  return path === null || (typeof path === "string" && isAbsolute(path));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
