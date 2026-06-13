import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type InitStatus = "created" | "added" | "updated" | "ok" | "removed" | "absent";

export interface InitResult {
  file: string;
  status: InitStatus;
  changed: boolean;
  target?: string;
  ignored?: boolean;
}

const BEGIN_RE = /<!-- subagent-mcp:begin[^>]*-->[\s\S]*?<!-- subagent-mcp:end -->/;

export const INIT_BLOCK = [
  "<!-- subagent-mcp:begin v1 -->",
  "## subagent-mcp invariant - managed block, do not edit between markers",
  "",
  "BINDING WHILE CONNECTED. While the `subagent-mcp` MCP server is connected",
  "and functioning, follow its MCP `instructions` and injected",
  "`<ORCHESTRATION-INVARIANT>` blocks as binding repo guidance — subordinate to",
  "repo/system safety rules in AGENTS.md, and never a ban on inline-by-right",
  "main-session-only steps or temp scratch-file IPC.",
  "",
  "- ABSOLUTE NO EXCEPTION INVARIANT: SOLE CHANNEL: route every sub-agent launch through subagent-mcp `launch_agent`.",
  "  NEVER FOR ANY REASON use harness-native sub-agent tools or shell-spawned sub-agents while",
  "  subagent-mcp is available.",
  "- 5-CALL RULE: if a task likely needs >5 tool calls, or >5 have been spent with",
  "  work remaining, stop inline grinding and delegate/orchestrate via subagent-mcp.",
  "- ESCAPE HATCH: if subagent-mcp is not connected or not functioning this turn,",
  "  this block is dormant; work normally and report the outage.",
  "<!-- subagent-mcp:end -->",
].join("\n");

function detectEol(s: string): "\n" | "\r\n" {
  const crlf = s.indexOf("\r\n");
  const lf = s.replace(/\r\n/g, "").indexOf("\n");
  return crlf >= 0 && (lf < 0 || crlf <= lf) ? "\r\n" : "\n";
}

function normalizeBlock(eol: "\n" | "\r\n"): string {
  return INIT_BLOCK.split("\n").join(eol);
}

function insertAfterFirstHeading(body: string, block: string, eol: string): string {
  const m = body.match(/^# .*(?:\r?\n|$)/m);
  if (!m || m.index === undefined) return `${block}${eol}${eol}${body}`;
  const end = m.index + m[0].length;
  return `${body.slice(0, end)}${eol}${block}${eol}${body.slice(end)}`;
}

function collapseBlankRuns(s: string, eol: string): string {
  return s.replace(new RegExp(`(?:${eol}){3,}`, "g"), `${eol}${eol}`);
}

function removeManagedBlock(body: string, eol: string): string {
  const match = body.match(BEGIN_RE);
  const next = collapseBlankRuns(body.replace(BEGIN_RE, ""), eol);
  if (!match || match.index !== 0) return next;
  let trimmed = next;
  let removed = 0;
  while (trimmed.startsWith(eol) && removed < 2) {
    trimmed = trimmed.slice(eol.length);
    removed++;
  }
  return trimmed;
}

function backupOnce(file: string): void {
  if (!existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${file}.bak-init-${stamp}`;
  copyFileSync(file, backup);
}

function atomicWrite(file: string, data: string, force: boolean): void {
  mkdirSync(dirname(file), { recursive: true });
  if (force && existsSync(file)) chmodSync(file, 0o666);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, file);
}

export function upsertInitBlock(
  file: string,
  opts: { dryRun?: boolean; remove?: boolean; force?: boolean } = {}
): InitResult {
  const exists = existsSync(file);
  const original = exists ? readFileSync(file, "utf8") : "";
  const hadBom = original.charCodeAt(0) === 0xfeff;
  const body = hadBom ? original.slice(1) : original;
  const eol = exists ? detectEol(body) : "\n";
  const block = normalizeBlock(eol);
  let next = body;
  let status: InitStatus;

  if (opts.remove) {
    if (!exists || !BEGIN_RE.test(body)) {
      status = "absent";
    } else {
      next = removeManagedBlock(body, eol);
      status = "removed";
    }
  } else if (!exists) {
    next = `${block}${eol}`;
    status = "created";
  } else if (BEGIN_RE.test(body)) {
    const current = body.match(BEGIN_RE)?.[0] ?? "";
    if (current === block) {
      status = "ok";
    } else {
      next = body.replace(BEGIN_RE, block);
      status = "updated";
    }
  } else {
    next = insertAfterFirstHeading(body, block, eol);
    status = "added";
  }

  const changed = !["ok", "absent"].includes(status);
  if (changed && !opts.dryRun) {
    const out = (hadBom ? "\ufeff" : "") + (next.endsWith(eol) ? next : next + eol);
    backupOnce(file);
    atomicWrite(file, out, opts.force === true);
  }
  return { file, status, changed };
}

function parseArgs(args: string[]) {
  const parsed = {
    dryRun: false,
    remove: false,
    force: false,
    copilot: false,
    cursor: false,
    root: process.cwd(),
    files: null as string[] | null,
  };
  const readValue = (args: string[], i: number, flag: string): string => {
    const value = args[i + 1];
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") parsed.dryRun = true;
    else if (a === "--remove" || a === "--uninstall") parsed.remove = true;
    else if (a === "--force") parsed.force = true;
    else if (a === "--copilot") parsed.copilot = true;
    else if (a === "--cursor") parsed.cursor = true;
    else if (a === "--root") {
      parsed.root = readValue(args, i, a);
      i++;
    } else if (a === "--files") {
      parsed.files = readValue(args, i, a).split(",").filter(Boolean);
      i++;
    }
    else throw new Error(`unknown init argument: ${a}`);
  }
  if (!parsed.root) throw new Error("--root requires a directory");
  return parsed;
}

function isSelfRepo(root: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: string };
    return pkg.name === "@heretyc/subagent-mcp";
  } catch {
    return false;
  }
}

function targetFiles(root: string, opts: ReturnType<typeof parseArgs>): string[] {
  const resolveTarget = (f: string): string => {
    const target = isAbsolute(f) ? resolve(f) : resolve(root, f);
    const rel = relative(root, target);
    if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
      return target;
    }
    throw new Error(`--files target escapes --root: ${f}`);
  };
  if (opts.files) return opts.files.map(resolveTarget);
  const rel = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"];
  if (opts.copilot) rel.push(".github/copilot-instructions.md");
  if (opts.cursor) rel.push(".cursor/rules/subagent-mcp.mdc");
  return rel.map(resolveTarget);
}

export async function runInit(args = process.argv.slice(3)): Promise<number> {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(args);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const root = resolve(opts.root);
  if (isSelfRepo(root) && !opts.force) {
    console.error("Refusing to run init inside the subagent-mcp source repo without --force.");
    console.error("This repo keeps CLAUDE.md/GEMINI.md as thin redirects; use --root for a consumer repo.");
    return 1;
  }

  let files: string[];
  try {
    files = targetFiles(root, opts);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }

  const issues: string[] = [];
  const results: InitResult[] = [];
  for (const file of files) {
    try {
      const r = upsertInitBlock(file, opts);
      results.push(r);
      console.log(`${r.status.padEnd(7)} ${file}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      issues.push(`${file}: ${msg}`);
      console.error(`failed  ${file}: ${msg}`);
    }
  }
  if (opts.dryRun) console.log("(dry-run: no files written)");
  if (issues.length > 0) {
    console.error("\nInit completed with issues:");
    for (const i of issues) console.error(`- ${i}`);
    return 1;
  }
  return results.length > 0 ? 0 : 1;
}
