#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createBackup } from "./backup.js";
import { findOnPath, resolveCmdShimNodeScript } from "./setup.js";

type Status = "PASS" | "WARN" | "FAIL";
type JsonObj = Record<string, any>;

interface DoctorLine {
  status: Status;
  id: number;
  name: string;
  detail: string;
}

interface DoctorOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

function line(r: DoctorLine): string {
  return `[${r.status}] ${r.id} ${r.name}: ${r.detail}`;
}

function readJson(file: string): JsonObj | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as JsonObj;
}

function distIndex(root: string): string {
  return join(root, "dist", "index.js");
}

function existingDist(pathValue: string | null): string | null {
  if (!pathValue) return null;
  try {
    const p = realpathSync(pathValue);
    return existsSync(p) && p.replace(/\\/g, "/").endsWith("/dist/index.js") ? p : null;
  } catch {
    return null;
  }
}

function npmGlobalDist(env: NodeJS.ProcessEnv): string | null {
  const npm = findOnPath("npm", env) ?? "npm";
  const isCmd = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(npm);
  const shimJs = isCmd ? resolveCmdShimNodeScript(npm) : null;
  const r = shimJs
    ? spawnSync(process.execPath, [shimJs, "root", "-g"], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "ignore"],
      })
    : isCmd
      ? { status: 1, stdout: "" }
      : spawnSync(npm, ["root", "-g"], {
          encoding: "utf8",
          env,
          stdio: ["ignore", "pipe", "ignore"],
        });
  const rooted =
    r.status === 0
      ? existingDist(join(r.stdout.trim(), "@heretyc", "subagent-mcp", "dist", "index.js"))
      : null;
  return rooted ?? existingDist(resolveCommandPath("subagent-mcp", env));
}

function scanPluginDists(home: string): string[] {
  const root = join(home, ".claude", "plugins");
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 5 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (!e.isDirectory()) continue;
      const manifest = join(p, ".claude-plugin", "plugin.json");
      const dist = distIndex(p);
      if (existsSync(manifest) && existsSync(dist)) {
        try {
          if (readJson(manifest)?.name === "subagent-mcp") found.push(realpathSync(dist));
        } catch {}
      }
      walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return [...new Set(found)];
}

export function checkInstallMode(opts: DoctorOptions = {}): DoctorLine {
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const global = npmGlobalDist(env);
  const plugins = scanPluginDists(home);
  const parts = [
    global ? `npm-global=${global}` : null,
    ...plugins.map((p) => `marketplace=${p}`),
  ].filter((p): p is string => p !== null);
  return {
    status: parts.length ? "PASS" : "FAIL",
    id: 1,
    name: "install-mode",
    detail: parts.length ? parts.join("; ") : "no npm-global or marketplace install found",
  };
}

function resolveCommandPath(command: string, env: NodeJS.ProcessEnv): string | null {
  const direct = existsSync(command) ? command : findOnPath(command, env);
  if (!direct) return null;
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(direct)) {
    return resolveCmdShimNodeScript(direct) ?? direct;
  }
  try {
    return realpathSync(direct);
  } catch {
    return direct;
  }
}

function resolveEntry(entry: JsonObj | undefined, env: NodeJS.ProcessEnv): string | null {
  if (!entry || typeof entry.command !== "string") return null;
  const args = Array.isArray(entry.args) ? entry.args : [];
  if (entry.command === "node" && typeof args[0] === "string") {
    return resolve(args[0]);
  }
  if (entry.command === "subagent-mcp") return npmGlobalDist(env) ?? resolveCommandPath("subagent-mcp", env);
  return resolveCommandPath(entry.command, env);
}

function canonicalEntry(): JsonObj {
  return { type: "stdio", command: "subagent-mcp", args: [], env: {} };
}

async function askFix(opts: DoctorOptions): Promise<boolean> {
  const rl = createInterface({
    input: opts.input ?? defaultInput,
    output: opts.output ?? defaultOutput,
  });
  try {
    const answer = (await rl.question("Fix MCP registration? [Y/n] ")).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function checkMcpRegistration(opts: DoctorOptions = {}): Promise<DoctorLine> {
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const liveFile = join(home, ".claude.json");
  const staleFile = join(home, ".claude", "mcp.json");
  const liveEntry = readJson(liveFile)?.mcpServers?.["subagent-mcp"];
  const staleJson = readJson(staleFile);
  const staleEntry = staleJson?.mcpServers?.["subagent-mcp"];
  const liveTarget = resolveEntry(liveEntry, env);
  const staleTarget = resolveEntry(staleEntry, env);
  const liveOk = existingDist(liveTarget) !== null;
  const staleDangling = staleEntry !== undefined && existingDist(staleTarget) === null;

  if (staleDangling) {
    const staleDetail = `${staleFile} points at ${staleTarget ?? "unresolved command"} (missing); live ${liveFile} points at ${liveTarget ?? "unresolved command"}`;
    if (opts.isTTY ?? process.stdin.isTTY) {
      if (await askFix(opts)) {
        createBackup();
        mkdirSync(dirname(staleFile), { recursive: true });
        staleJson!.mcpServers = staleJson!.mcpServers ?? {};
        staleJson!.mcpServers["subagent-mcp"] = canonicalEntry();
        writeFileSync(staleFile, `${JSON.stringify(staleJson, null, 2)}\n`, "utf8");
        return {
          status: liveOk ? "WARN" : "FAIL",
          id: 2,
          name: "mcp-registration",
          detail: `${staleDetail}; repaired stale file after backup`,
        };
      }
      return { status: liveOk ? "WARN" : "FAIL", id: 2, name: "mcp-registration", detail: `${staleDetail}; repair skipped` };
    }
    return { status: liveOk ? "WARN" : "FAIL", id: 2, name: "mcp-registration", detail: `${staleDetail}; non-TTY: no changes made` };
  }

  if (liveOk) {
    return { status: "PASS", id: 2, name: "mcp-registration", detail: `${liveFile} resolves to ${existingDist(liveTarget)}` };
  }
  return {
    status: "FAIL",
    id: 2,
    name: "mcp-registration",
    detail: `${liveFile} does not resolve to an existing dist/index.js (${liveTarget ?? "missing entry"})`,
  };
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<number> {
  const results = [checkInstallMode(opts), await checkMcpRegistration(opts)];
  for (const r of results) console.log(line(r));
  const counts = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const r of results) counts[r.status]++;
  const exitCode = counts.FAIL > 0 ? 1 : 0;
  console.log(`Summary: pass=${counts.PASS} warn=${counts.WARN} fail=${counts.FAIL} exit=${exitCode}`);
  return exitCode;
}
