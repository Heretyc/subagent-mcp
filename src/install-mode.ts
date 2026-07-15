import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { findOnPath, resolveCmdShimNodeScript } from "./setup.js";

type JsonObj = Record<string, any>;

export type InstallMode = "npm-global" | "marketplace" | "dual-mode" | "none";

export interface InstallModeInfo {
  mode: InstallMode;
  npmGlobalDist: string | null;
  marketplaceDists: string[];
}

function readJson(file: string): JsonObj | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as JsonObj;
}

export function existingDist(pathValue: string | null): string | null {
  if (!pathValue) return null;
  try {
    const p = realpathSync(pathValue);
    return existsSync(p) && p.replace(/\\/g, "/").endsWith("/dist/index.js") ? p : null;
  } catch {
    return null;
  }
}

export function resolveCommandPath(command: string, env: NodeJS.ProcessEnv): string | null {
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

export function npmGlobalDist(env: NodeJS.ProcessEnv = process.env): string | null {
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

export function scanPluginDists(home: string = homedir()): string[] {
  const root = join(home, ".claude", "plugins");
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 5 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (!e.isDirectory()) continue;
      const manifest = join(p, ".claude-plugin", "plugin.json");
      const dist = join(p, "dist", "index.js");
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

export function detectInstallMode(opts: { home?: string; env?: NodeJS.ProcessEnv } = {}): InstallModeInfo {
  const npm = npmGlobalDist(opts.env ?? process.env);
  const marketplace = scanPluginDists(opts.home ?? homedir());
  return {
    mode: npm && marketplace.length ? "dual-mode" : npm ? "npm-global" : marketplace.length ? "marketplace" : "none",
    npmGlobalDist: npm,
    marketplaceDists: marketplace,
  };
}
