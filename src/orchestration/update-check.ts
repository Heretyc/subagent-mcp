import {
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readCheckForUpdates } from "../concurrency.js";
import { atomicWriteJson } from "./atomic-write.js";
import { stateDir } from "./marker.js";

export const UPDATE_NOTICE_TEXT =
  "Notice: An improved version of subagent-mcp is available via the CLI command `subagent-mcp update` and can then be fully installed with `subagent-mcp setup`. This may include security and user experience improvements.";
export const UPDATE_CHECK_TIMEOUT_MS = 2500;
export const UPDATE_NOTICE_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AUTO_UPDATE_MIN_AGE_MS = 48 * 60 * 60 * 1000;

export interface PackageInfo {
  name: string;
  version: string;
}

export interface PendingUpdateNotice {
  latest_version: string;
  checked_at: string;
}

export interface UpdateCheckStatus {
  checked_at: string;
}

export interface UpdateNoticeEmitRecord {
  notified_at: number;
  session_id?: string;
}

export interface UpdateCheckDeps {
  fetch?: typeof fetch;
  now?: () => number;
  registryBaseUrl?: string;
  packageInfo?: () => PackageInfo;
  timeoutMs?: number;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  spawn?: typeof spawn;
}

function pendingNoticePath(): string {
  return join(stateDir, "update-notice.json");
}

function checkStatusPath(): string {
  return join(stateDir, "update-status.json");
}

function emitRecordPath(): string {
  return join(stateDir, "update-notice-emitted.json");
}

function autoUpdateNoticePath(): string {
  return join(stateDir, "auto-update-notice.json");
}

function autoUpdateSkipNoticePath(): string {
  return join(stateDir, "auto-update-skip-notice.json");
}

function writeStateJson(path: string, value: unknown): void {
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    atomicWriteJson(path, value, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Fail-safe: update notices must never affect the host turn or MCP channel.
  }
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function removeFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Fail-safe.
  }
}

export function clearUpdateNoticeState(): void {
  removeFile(pendingNoticePath());
  removeFile(checkStatusPath());
  removeFile(emitRecordPath());
  removeFile(autoUpdateNoticePath());
  removeFile(autoUpdateSkipNoticePath());
}

export function writePendingUpdateNotice(latestVersion: string, now: number = Date.now()): void {
  writeStateJson(pendingNoticePath(), {
    latest_version: latestVersion,
    checked_at: new Date(now).toISOString(),
  });
}

export function readPendingUpdateNotice(): PendingUpdateNotice | undefined {
  const parsed = readJson<Partial<PendingUpdateNotice>>(pendingNoticePath());
  if (
    parsed &&
    typeof parsed.latest_version === "string" &&
    typeof parsed.checked_at === "string"
  ) {
    return { latest_version: parsed.latest_version, checked_at: parsed.checked_at };
  }
  return undefined;
}

export function readUpdateCheckStatus(): UpdateCheckStatus | undefined {
  const parsed = readJson<Partial<UpdateCheckStatus>>(checkStatusPath());
  return parsed && typeof parsed.checked_at === "string" ? { checked_at: parsed.checked_at } : undefined;
}

function writeUpdateCheckStatus(now: number): void {
  writeStateJson(checkStatusPath(), { checked_at: new Date(now).toISOString() });
}

function readAutoUpdateNotice(): { from: string; to: string } | undefined {
  const parsed = readJson<{ from?: unknown; to?: unknown }>(autoUpdateNoticePath());
  return parsed && typeof parsed.from === "string" && typeof parsed.to === "string"
    ? { from: parsed.from, to: parsed.to }
    : undefined;
}

function writeAutoUpdateNotice(from: string, to: string): void {
  writeStateJson(autoUpdateNoticePath(), { from, to });
}

function readAutoUpdateSkipNotice(): string | undefined {
  const parsed = readJson<{ reason?: unknown }>(autoUpdateSkipNoticePath());
  return typeof parsed?.reason === "string" ? parsed.reason : undefined;
}

function writeAutoUpdateSkipNotice(reason: string): void {
  writeStateJson(autoUpdateSkipNoticePath(), { reason });
}

export function readUpdateNoticeEmitRecord(): UpdateNoticeEmitRecord | undefined {
  const parsed = readJson<Partial<UpdateNoticeEmitRecord>>(emitRecordPath());
  if (!parsed || typeof parsed.notified_at !== "number") return undefined;
  return {
    notified_at: parsed.notified_at,
    ...(typeof parsed.session_id === "string" ? { session_id: parsed.session_id } : {}),
  };
}

function writeUpdateNoticeEmitRecord(record: UpdateNoticeEmitRecord): void {
  writeStateJson(emitRecordPath(), record);
}

export function updateCheckEnvDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_UPDATE_NOTIFIER !== undefined || env.CI !== undefined || env.NODE_ENV === "test") return true;
  const raw = env.SUBAGENT_UPDATE_CHECK;
  return typeof raw === "string" && /^(?:0|false)$/i.test(raw.trim());
}

export function shouldCheckForUpdates(
  env: NodeJS.ProcessEnv = process.env,
  configPath?: string
): boolean {
  if (updateCheckEnvDisabled(env)) return false;
  return readCheckForUpdates(configPath);
}

export function compareNumericVersions(a: string, b: string): number {
  const parse = (value: string): number[] | undefined => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:$|[^\d])/.exec(value.trim());
    return match ? match.slice(1, 4).map((part) => Number.parseInt(part, 10)) : undefined;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

export function isVersionNewer(latest: string, installed: string): boolean {
  return compareNumericVersions(installed, latest) < 0;
}

export function readInstalledPackageInfo(): PackageInfo {
  return JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as PackageInfo;
}

function registryPackageUrl(packageName: string, registryBaseUrl: string): string {
  const base = registryBaseUrl.replace(/\/+$/, "");
  return `${base}/${packageName.replace("/", "%2F")}`;
}

export async function fetchLatestVersion(
  packageName: string,
  deps: Required<Pick<UpdateCheckDeps, "fetch" | "registryBaseUrl" | "timeoutMs">>
): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const response = await deps.fetch(registryPackageUrl(packageName, deps.registryBaseUrl), {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const metadata = (await response.json()) as { "dist-tags"?: { latest?: unknown } };
    return typeof metadata?.["dist-tags"]?.latest === "string"
      ? metadata["dist-tags"].latest
      : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPackageMetadata(
  packageName: string,
  deps: Required<Pick<UpdateCheckDeps, "fetch" | "registryBaseUrl" | "timeoutMs">>
): Promise<{ latest: string; publishedAt?: string; provenance: boolean } | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const response = await deps.fetch(registryPackageUrl(packageName, deps.registryBaseUrl), {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const metadata = (await response.json()) as {
      "dist-tags"?: { latest?: unknown };
      time?: Record<string, unknown>;
      versions?: Record<string, { dist?: Record<string, unknown> }>;
      dist?: Record<string, unknown>;
    };
    const latest = metadata?.["dist-tags"]?.latest;
    if (typeof latest !== "string") return undefined;
    const publishedAt = metadata.time && typeof metadata.time[latest] === "string"
      ? metadata.time[latest]
      : undefined;
    return { latest, publishedAt, provenance: hasNpmProvenance(metadata, latest) };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function hasItems(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return !!value && typeof value === "object";
}

export function hasNpmProvenance(
  metadata: { versions?: Record<string, { dist?: Record<string, unknown> }>; dist?: Record<string, unknown> },
  version: string
): boolean {
  // ponytail: metadata presence check only; switch to npm audit signatures if npm exposes a stable library API.
  const dist = metadata.versions?.[version]?.dist ?? metadata.dist;
  return hasItems(dist?.attestations) || hasItems(dist?.signatures);
}

function autoUpdateEnabled(home = homedir()): boolean {
  try {
    const raw = JSON.parse(readFileSync(join(home, ".subagent-mcp", "init-registry.json"), "utf8")) as { autoUpdate?: unknown };
    return raw.autoUpdate === true;
  } catch {
    return false;
  }
}

function isOldEnoughToInstall(publishedAt: string | undefined, now: number): boolean {
  if (!publishedAt) return false;
  const published = Date.parse(publishedAt);
  return Number.isFinite(published) && now - published >= AUTO_UPDATE_MIN_AGE_MS;
}

function spawnSelfUpdate(deps: UpdateCheckDeps, from: string, to: string): void {
  const child = (deps.spawn ?? spawn)(
    process.execPath,
    [fileURLToPath(new URL("../index.js", import.meta.url)), "update", "--quiet"],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, SUBAGENT_AUTO_UPDATE: "1" },
    }
  );
  child.on("exit", (code) => {
    if (code === 0) writeAutoUpdateNotice(from, to);
  });
  child.unref();
}

export async function checkForNpmUpdate(deps: UpdateCheckDeps = {}): Promise<void> {
  try {
    const env = deps.env ?? process.env;
    if (!shouldCheckForUpdates(env, deps.configPath)) return;
    const now = deps.now?.() ?? Date.now();
    const last = readUpdateCheckStatus();
    if (last && now - Date.parse(last.checked_at) < UPDATE_CHECK_INTERVAL_MS) return;
    const pkg = (deps.packageInfo ?? readInstalledPackageInfo)();
    const metadata = await fetchPackageMetadata(pkg.name, {
      fetch: deps.fetch ?? fetch,
      registryBaseUrl: deps.registryBaseUrl ?? "https://registry.npmjs.org",
      timeoutMs: deps.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS,
    });
    writeUpdateCheckStatus(now);
    const latest = metadata?.latest;
    if (latest && isVersionNewer(latest, pkg.version)) {
      writePendingUpdateNotice(latest, now);
      if (autoUpdateEnabled(deps.home) && isOldEnoughToInstall(metadata?.publishedAt, now)) {
        if (metadata.provenance) spawnSelfUpdate(deps, pkg.version, latest);
        else writeAutoUpdateSkipNotice("no provenance");
      }
    }
  } catch {
    // Silent skip: never throw and never log to MCP stdio.
  }
}

export function appendUpdateNotice(
  out: string,
  installedVersion: string,
  sessionId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
  configPath?: string
): string {
  try {
    if (!out || !shouldCheckForUpdates(env, configPath)) return out;
    const autoUpdated = readAutoUpdateNotice();
    if (autoUpdated) {
      removeFile(autoUpdateNoticePath());
      out = `${out}\nNotice: subagent-mcp auto-updated ${autoUpdated.from}->${autoUpdated.to}. Restart CLI sessions to use the new build.`;
    }
    const autoUpdateSkip = readAutoUpdateSkipNotice();
    if (autoUpdateSkip) {
      removeFile(autoUpdateSkipNoticePath());
      out = `${out}\nNotice: skipped auto-update: ${autoUpdateSkip}.`;
    }
    const pending = readPendingUpdateNotice();
    if (!pending) return out;
    if (!isVersionNewer(pending.latest_version, installedVersion)) {
      removeFile(pendingNoticePath());
      return out;
    }
    const emitted = readUpdateNoticeEmitRecord();
    if (emitted?.session_id && sessionId && emitted.session_id === sessionId) return out;
    if (emitted && now - emitted.notified_at < UPDATE_NOTICE_INTERVAL_MS) return out;
    writeUpdateNoticeEmitRecord({
      notified_at: now,
      ...(sessionId ? { session_id: sessionId } : {}),
    });
    // Injection invariant: NEVER interpolate registry-sourced strings into injected text.
    return `${out}\n${UPDATE_NOTICE_TEXT}`;
  } catch {
    return out;
  }
}
