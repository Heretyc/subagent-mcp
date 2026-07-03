import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONCURRENCY_SCAFFOLD } from "./config-scaffold.js";
import {
  cullStaleSlots,
  ZOMBIE_FORCE_GRACE_MS,
  ZOMBIE_LIVE_IDLE_MS,
  ZOMBIE_TERMINAL_IDLE_MS,
  buildProcessTreeKillCommands,
  drainZombieIntents,
  drainZombieReports,
  parseSlotMetadata,
  readSlotMetadata,
  slotPathForAgent,
  writeSlotMetadata,
  type CullDeps,
  type ZombieRecord,
} from "./zombie.js";

export const DEFAULT_CAP: number = 20;
export const MIN_CAP: number = 10;
export const DEFAULT_CHECK_FOR_UPDATES: boolean = true;
export const CONFIG_FILENAME: string = "global-concurrency.jsonc";

export interface ReservedSlot {
  ok: true;
  slotPath: string | null;
  current: number;
  max: number;
}

export interface RejectedSlot {
  ok: false;
  current: number;
  max: number;
  error?: string;
}

export type SlotReservation = ReservedSlot | RejectedSlot;

export {
  cullStaleSlots,
  ZOMBIE_FORCE_GRACE_MS,
  ZOMBIE_LIVE_IDLE_MS,
  ZOMBIE_TERMINAL_IDLE_MS,
  buildProcessTreeKillCommands,
  drainZombieIntents,
  drainZombieReports,
  parseSlotMetadata,
  readSlotMetadata,
  slotPathForAgent,
  writeSlotMetadata,
  type CullDeps,
  type ZombieRecord,
};

export function clampCap(raw: unknown): number {
  if (!Number.isInteger(raw)) return DEFAULT_CAP;
  const v = raw as number;
  if (v <= 0) return DEFAULT_CAP;
  if (v < MIN_CAP) return MIN_CAP;
  return v;
}

export function stripJsoncComments(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, "");
}

export function parseConcurrencyConfig(text: string): number {
  let raw: unknown;
  try {
    raw = (JSON.parse(stripJsoncComments(text)) as Record<string, unknown> | null)?.globalConcurrentSubagents;
  } catch {
    raw = undefined;
  }
  return clampCap(raw);
}

export function parseCheckForUpdatesConfig(text: string): boolean {
  try {
    const raw = (JSON.parse(stripJsoncComments(text)) as Record<string, unknown> | null)
      ?.checkForUpdates;
    return typeof raw === "boolean" ? raw : DEFAULT_CHECK_FOR_UPDATES;
  } catch {
    return DEFAULT_CHECK_FOR_UPDATES;
  }
}

export function defaultConfigPath(): string {
  return fileURLToPath(new URL("./" + CONFIG_FILENAME, import.meta.url));
}

export function ensureConcurrencyConfig(path: string = defaultConfigPath()): void {
  try {
    if (existsSync(path)) return;
    writeFileSync(path, CONCURRENCY_SCAFFOLD);
  } catch {}
}

export function readGlobalCap(path: string = defaultConfigPath()): number {
  try {
    ensureConcurrencyConfig(path);
    return parseConcurrencyConfig(readFileSync(path, "utf8"));
  } catch {
    return DEFAULT_CAP;
  }
}

export function readCheckForUpdates(path: string = defaultConfigPath()): boolean {
  try {
    ensureConcurrencyConfig(path);
    return parseCheckForUpdatesConfig(readFileSync(path, "utf8"));
  } catch {
    return DEFAULT_CHECK_FOR_UPDATES;
  }
}

export function slotDir(): string {
  if (process.env.SUBAGENT_SLOT_DIR) return process.env.SUBAGENT_SLOT_DIR;
  if (platform() === "win32") {
    return join(
      process.env.ProgramData || process.env.ALLUSERSPROFILE || "C:\\ProgramData",
      "subagent-mcp",
      "slots"
    );
  }
  return "/tmp/subagent-mcp/slots";
}

export function countSlots(dir: string = slotDir()): number {
  try {
    return readdirSync(dir).filter((f) => f.startsWith("slot-")).length;
  } catch {
    return 0;
  }
}

export function scheduleForceKill(ms: number, kill: () => void): void {
  const timer = setTimeout(kill, ms);
  timer.unref();
}

export const NONBLOCKING_CULL_DEPS: CullDeps = {
  scheduleForceKill,
};

export function reserveSlot(
  agentId: string,
  max: number,
  dir: string = slotDir(),
  cullDeps?: CullDeps
): SlotReservation {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o1777 });
    cullStaleSlots(dir, cullDeps);
    const slotPath = slotPathForAgent(dir, agentId);
    const before = countSlots(dir);
    if (before >= max) {
      return { ok: false, current: before, max };
    }
    // ponytail: count->write->recount narrows the TOCTOU; a cross-process lock would close it fully.
    writeSlotMetadata(slotPath, { agent_id: agentId });
    const after = countSlots(dir);
    if (after > max) {
      try {
        unlinkSync(slotPath);
      } catch {}
      return { ok: false, current: countSlots(dir), max };
    }
    return { ok: true, slotPath, current: after, max };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[concurrency] reserve failed, rejecting launch: ${error}`);
    return { ok: false, current: -1, max, error };
  }
}

export function releaseSlot(slotPath: string | null): void {
  if (!slotPath) return;
  try {
    unlinkSync(slotPath);
  } catch {}
}

export function globalCapMessage(
  current: number,
  max: number,
  configPath: string = defaultConfigPath()
): string {
  return `Global concurrent-subagent limit reached: ${current} of ${max} live subagents are already running across all sessions on this machine. This global count includes agents started by OTHER active agentic sessions and the ENTIRE recursive descendant tree, not just this session's direct children. launch_agent was REJECTED — this cap never queues or blocks; no slot frees itself by waiting. Free a slot manually first: call list_agents to see live agents, then kill_agent to terminate ones you no longer need, and retry. The limit is "globalConcurrentSubagents" in ${configPath} (default 20, minimum 10).`;
}
