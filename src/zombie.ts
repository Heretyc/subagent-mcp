import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { basename, dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

export const ZOMBIE_LIVE_IDLE_MS = 6 * 60 * 1000;
export const ZOMBIE_TERMINAL_IDLE_MS = 30 * 1000;
export const ZOMBIE_FORCE_GRACE_MS = 20 * 1000;

export const ZOMBIE_INTENTS_FILENAME = "zombie-intents.jsonl";
export const ZOMBIE_REPORTS_FILENAME = "zombie-reports.jsonl";

export interface SlotMetadata {
  schema_version: 1;
  agent_id: string;
  server_pid: number | null;
  child_pid: number | null;
  cwd: string | null;
  started_at: string | null;
  started_at_ms: number | null;
  last_activity_ms: number | null;
  status?: string | null;
}

export interface ZombieRecord {
  kind: "zombie_killed";
  agent_id: string;
  child_pid: number | null;
  server_pid: number | null;
  slot_path: string;
  reason: "stale_live" | "terminal_but_alive";
  detected_at_ms: number;
  last_activity_ms: number | null;
  message: string;
}

export interface KillCommand {
  command: string;
  args: string[];
}

export interface CullDeps {
  now?: () => number;
  platform?: NodeJS.Platform;
  runCommand?: (command: string, args: string[]) => void;
  sleepMs?: (ms: number) => void;
  isProcessAlive?: (pid: number) => boolean;
  forceGraceMs?: () => number;
  scheduleForceKill?: (ms: number, kill: () => void) => void;
}

function numberOrNull(v: unknown): number | null {
  return Number.isFinite(v) ? (v as number) : null;
}

function parseTimeMs(v: unknown): number | null {
  if (Number.isFinite(v)) return v as number;
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function slotPathForAgent(dir: string, agentId: string): string {
  return join(dir, `slot-${agentId}.json`);
}

export function parseSlotMetadata(text: string, slotPath = ""): SlotMetadata | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const baseAgentId = basename(slotPath).replace(/^slot-/, "").replace(/\.json$/, "");
  const agent_id = typeof raw.agent_id === "string" ? raw.agent_id : baseAgentId;
  const started_at = typeof raw.started_at === "string"
    ? raw.started_at
    : typeof raw.startedAt === "string"
      ? raw.startedAt
      : null;
  const started_at_ms = parseTimeMs(raw.started_at_ms ?? raw.started_at ?? raw.startedAt);
  return {
    schema_version: 1,
    agent_id,
    server_pid: numberOrNull(raw.server_pid ?? raw.pid),
    child_pid: numberOrNull(raw.child_pid),
    cwd: typeof raw.cwd === "string" ? raw.cwd : null,
    started_at,
    started_at_ms,
    last_activity_ms: parseTimeMs(raw.last_activity_ms ?? raw.lastActivity ?? raw.started_at_ms ?? raw.startedAt),
    status: typeof raw.status === "string" ? raw.status : null,
  };
}

export function readSlotMetadata(slotPath: string): SlotMetadata | null {
  try {
    return parseSlotMetadata(readFileSync(slotPath, "utf8"), slotPath);
  } catch {
    return null;
  }
}

export function writeSlotMetadata(slotPath: string, metadata: Partial<SlotMetadata> & { agent_id: string }): void {
  const now = Date.now();
  const full: SlotMetadata = {
    schema_version: 1,
    agent_id: metadata.agent_id,
    server_pid: metadata.server_pid ?? process.pid,
    child_pid: metadata.child_pid ?? null,
    cwd: metadata.cwd ?? process.cwd(),
    started_at: metadata.started_at ?? new Date(now).toISOString(),
    started_at_ms: metadata.started_at_ms ?? now,
    last_activity_ms: metadata.last_activity_ms ?? now,
    status: metadata.status ?? null,
  };
  writeFileSync(slotPath, JSON.stringify(full), { mode: 0o600 });
}

function drainJsonl(path: string): ZombieRecord[] {
  if (!existsSync(path)) return [];
  const claim = join(dirname(path), `${basename(path)}.${process.pid}.drain`);
  try {
    renameSync(path, claim);
  } catch {
    return [];
  }
  try {
    return readFileSync(claim, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ZombieRecord);
  } finally {
    try {
      unlinkSync(claim);
    } catch {}
  }
}

export function buildProcessTreeKillCommands(pid: number, p: NodeJS.Platform = platform()): {
  graceful: KillCommand;
  force: KillCommand;
} {
  if (p === "win32") {
    return {
      graceful: { command: "taskkill", args: ["/PID", String(pid), "/T"] },
      force: { command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] },
    };
  }
  return {
    graceful: { command: "kill", args: ["-TERM", `-${pid}`] },
    force: { command: "kill", args: ["-KILL", `-${pid}`] },
  };
}

export function appendZombieRecord(dir: string, record: ZombieRecord): void {
  mkdirSync(dir, { recursive: true, mode: 0o1777 });
  const line = `${JSON.stringify(record)}\n`;
  writeFileSync(join(dir, ZOMBIE_INTENTS_FILENAME), line, { flag: "a", mode: 0o600 });
  writeFileSync(join(dir, ZOMBIE_REPORTS_FILENAME), line, { flag: "a", mode: 0o600 });
}

export function drainZombieReports(dir: string): ZombieRecord[] {
  return drainJsonl(join(dir, ZOMBIE_REPORTS_FILENAME));
}

export function drainZombieIntents(dir: string): ZombieRecord[] {
  return drainJsonl(join(dir, ZOMBIE_INTENTS_FILENAME));
}

function defaultRunCommand(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: "ignore" });
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function livePid(pid: number | null): pid is number {
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0;
}

function defaultSleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function cullStaleSlots(dir: string, deps: CullDeps = {}): ZombieRecord[] {
  const now = deps.now?.() ?? Date.now();
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const sleepMs = deps.sleepMs ?? defaultSleepMs;
  const forceGraceMs = deps.forceGraceMs?.() ?? ZOMBIE_FORCE_GRACE_MS;
  const isProcessAlive = deps.isProcessAlive ?? defaultIsProcessAlive;
  const p = deps.platform ?? platform();
  const records: ZombieRecord[] = [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.startsWith("slot-") && f.endsWith(".json"));
  } catch {
    return records;
  }
  for (const file of files) {
    const slotPath = join(dir, file);
    const meta = readSlotMetadata(slotPath);
    if (!meta?.last_activity_ms) continue;
    if (now - meta.last_activity_ms <= ZOMBIE_LIVE_IDLE_MS) continue;
    const ownerPid = livePid(meta.server_pid) ? meta.server_pid : null;
    if (ownerPid !== null) {
      try {
        if (isProcessAlive(ownerPid)) continue;
      } catch {}
    }
    const pid = meta.child_pid;
    if (ownerPid !== null && livePid(pid) && pid !== process.pid) {
      const commands = buildProcessTreeKillCommands(pid, p);
      try {
        runCommand(commands.graceful.command, commands.graceful.args);
      } catch {}
      const forceKill = () => {
        try {
          runCommand(commands.force.command, commands.force.args);
        } catch {}
      };
      if (deps.scheduleForceKill) {
        deps.scheduleForceKill(forceGraceMs, forceKill);
      } else {
        sleepMs(forceGraceMs);
        forceKill();
      }
    }
    const record: ZombieRecord = {
      kind: "zombie_killed",
      agent_id: meta.agent_id,
      child_pid: meta.child_pid,
      server_pid: meta.server_pid,
      slot_path: slotPath,
      reason: "stale_live",
      detected_at_ms: now,
      last_activity_ms: meta.last_activity_ms,
      message: `zombies: culled stale subagent ${meta.agent_id}`,
    };
    appendZombieRecord(dir, record);
    try {
      unlinkSync(slotPath);
    } catch {}
    records.push(record);
  }
  return records;
}
