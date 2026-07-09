import path from "node:path";
import permissionClasses from "./permission-classes.json" with { type: "json" };

export type PermissionVerdict = "allow" | "deny" | "ask";

export type PermissionsCeiling = "yolo" | "auto" | "manual";

export type PermissionEscalation = "irreversible-only" | "off";

export interface PermissionNetworkTarget {
  host?: string;
  url?: string;
}

export interface PermissionOp {
  tool: string;
  command?: string;
  argv?: string[];
  paths?: string[];
  resolvedPaths?: string[];
  network?: PermissionNetworkTarget[];
  cwd: string;
  additionalDirectories?: string[];
  irreversible?: boolean;
}

export interface PermissionRuleSet {
  allow?: string[];
  ask?: string[];
  deny?: string[];
}

export interface PermissionSnapshot {
  ceiling: PermissionsCeiling;
  escalation: PermissionEscalation;
  rules: PermissionRuleSet;
  additionalDirectories?: string[];
  repoConfigDigest?: string | null;
  repoConfigChangedSinceFirstSeen?: boolean;
}

export interface PermissionVerdictResult {
  verdict: PermissionVerdict;
  classification: "safe" | "danger" | "neutral";
  irreversible: boolean;
  matchedRule?: string;
  reason: string;
}

interface PermissionClasses {
  safe: {
    tools: string[];
    bashPrefixes: string[];
    webFetchHosts: string[];
  };
  danger: {
    toolWritePathPrefixes: string[];
    dangerousPathSegments: string[];
    protectedFilenames: string[];
    bashRegexes: string[];
    irreversibleBashRegexes: string[];
  };
}

const classes = permissionClasses as PermissionClasses;
const safeTools = new Set(classes.safe.tools.map(normalizeToolName));
const safeBashPrefixes = classes.safe.bashPrefixes.map(tokenizeCommand);
const safeWebFetchHosts = new Set(classes.safe.webFetchHosts.map((h) => h.toLowerCase()));
const dangerRegexes = classes.danger.bashRegexes.map((p) => new RegExp(p, "i"));
const irreversibleRegexes = classes.danger.irreversibleBashRegexes.map((p) => new RegExp(p, "i"));
const writeTools = new Set(classes.danger.toolWritePathPrefixes.map(normalizeToolName));
const dangerousPathSegments = new Set(classes.danger.dangerousPathSegments.map((p) => p.toLowerCase()));
const protectedFilenames = new Set(classes.danger.protectedFilenames.map((p) => p.toLowerCase()));
const mutatingTools = new Set(["bash", "edit", "multiedit", "write", "notebookedit"]);
const safeEnvVars = new Set(["NODE_ENV", "GOOS", "LANG"]);
const maxSubcommandsForSecurityCheck = 50;

/**
 * Shared trust-boundary decision point for Claude canUseTool and Codex approval
 * payloads. It performs no I/O; callers must provide already-known resolved
 * paths when they want symlink parity.
 */
export function verdict(op: PermissionOp, rules: PermissionRuleSet = {}): PermissionVerdictResult {
  const classified = classifyPermissionOp(op);
  if (classified.classification === "danger") {
    return {
      verdict: "deny",
      classification: "danger",
      irreversible: classified.irreversible,
      reason: classified.reason,
    };
  }

  const ruleVote = evaluateRuleSet(op, rules);
  if (ruleVote) {
    return {
      verdict: ruleVote.verdict,
      classification: classified.classification,
      irreversible: classified.irreversible,
      matchedRule: ruleVote.rule,
      reason: `${ruleVote.verdict} rule matched: ${ruleVote.rule}`,
    };
  }

  if (classified.classification === "safe") {
    return {
      verdict: "allow",
      classification: "safe",
      irreversible: classified.irreversible,
      reason: classified.reason,
    };
  }

  return {
    verdict: "ask",
    classification: "neutral",
    irreversible: classified.irreversible,
    reason: "neutral residue defaults to ask",
  };
}

/**
 * Applies the launch ceiling after the engine vote. `yolo` bypasses normal
 * gating; adapter-level bypass-immune denials must be enforced by the caller.
 */
export function applyPermissionCeiling(
  engineVote: PermissionVerdict,
  ceiling: PermissionsCeiling
): PermissionVerdict {
  if (ceiling === "yolo") return "allow";
  // The ceilings are NOT points on a permissiveness total order (the J2-9
  // "total-order-over-modes" mistake). Neither `auto` nor `manual` may demote
  // the engine's allow (SAFE) or deny (DANGER) decisions: SAFE always
  // auto-allows, DANGER always auto-denies, and only NEUTRAL residue ("ask")
  // parks. The auto/manual difference is solely *who* answers an "ask" —
  // `auto` escalates only irreversible residue to a human while `manual` routes
  // all residue to a human — which is decided downstream (see pending-permissions
  // `escalate_to_human`), never by mapping SAFE ops to "ask" here.
  return engineVote;
}

export function classifyPermissionOp(
  op: PermissionOp
): { classification: "safe" | "danger" | "neutral"; irreversible: boolean; reason: string } {
  const command = commandText(op);
  const irreversible = Boolean(op.irreversible) || (command !== "" && irreversibleRegexes.some((r) => r.test(command)));

  if (hasDangerousOrProtectedPath(op)) {
    return {
      classification: "danger",
      irreversible,
      reason: "dangerous or protected path",
    };
  }

  if (isReadPathOutsideAllowedRoots(op)) {
    return {
      classification: "neutral",
      irreversible,
      reason: "read path outside allowed roots",
    };
  }

  if (normalizeToolName(op.tool) === "bash") {
    if (command === "") return { classification: "neutral", irreversible, reason: "empty bash command" };
    if (countSubcommands(command) > maxSubcommandsForSecurityCheck) {
      return { classification: "neutral", irreversible, reason: "too many subcommands to classify safely" };
    }
    if (dangerRegexes.some((r) => r.test(command))) {
      return { classification: "danger", irreversible, reason: "dangerous bash pattern" };
    }
    if (countSubcommands(command) > 1) {
      return { classification: "neutral", irreversible, reason: "compound bash command requires review" };
    }
    if (isSafeBashCommand(command)) {
      return { classification: "safe", irreversible, reason: "safe bash prefix" };
    }
    return { classification: "neutral", irreversible, reason: "unmatched bash command" };
  }

  if (normalizeToolName(op.tool) === "webfetch" && isPreapprovedWebFetch(op)) {
    return { classification: "safe", irreversible, reason: "preapproved WebFetch host" };
  }

  if (safeTools.has(normalizeToolName(op.tool))) {
    return { classification: "safe", irreversible, reason: "safe read-only tool" };
  }

  return { classification: "neutral", irreversible, reason: "unmatched tool" };
}

export function evaluateRuleSet(
  op: PermissionOp,
  rules: PermissionRuleSet
): { verdict: PermissionVerdict; rule: string } | null {
  return (
    firstRuleMatch(op, "deny", rules.deny) ??
    firstRuleMatch(op, "ask", rules.ask) ??
    firstRuleMatch(op, "allow", rules.allow)
  );
}

export function parsePermissionRule(rule: string): { tool: string; content: string | null } {
  const firstParen = rule.indexOf("(");
  const lastParen = rule.lastIndexOf(")");
  if (firstParen < 0 || lastParen <= firstParen) {
    return { tool: rule.trim(), content: null };
  }
  return {
    tool: rule.slice(0, firstParen).trim(),
    content: rule.slice(firstParen + 1, lastParen),
  };
}

function firstRuleMatch(
  op: PermissionOp,
  vote: PermissionVerdict,
  rules: string[] | undefined
): { verdict: PermissionVerdict; rule: string } | null {
  for (const rule of rules ?? []) {
    if (matchesRule(op, rule)) return { verdict: vote, rule };
  }
  return null;
}

function matchesRule(op: PermissionOp, rawRule: string): boolean {
  const rule = parsePermissionRule(rawRule);
  if (rule.tool === "") return false;
  const opTool = normalizeToolName(op.tool);
  const ruleTool = normalizeToolName(rule.tool);
  if (ruleTool !== "*" && ruleTool !== opTool) return false;
  if (rule.content === null || rule.content.trim() === "" || rule.content.trim() === "*") return true;

  if (opTool === "bash") return matchesBashRule(commandText(op), rule.content);
  if (opTool === "webfetch") return matchesNetworkRule(op, rule.content);
  if (writeTools.has(opTool) || op.paths?.length || op.resolvedPaths?.length) {
    return matchesAnyPath(op, rule.content);
  }
  return wildcardMatch(rule.content, JSON.stringify(op));
}

function matchesBashRule(command: string, pattern: string): boolean {
  if (command === "") return false;
  const stripped = stripEnvPrefix(command, true);
  const positive = pattern.trim();
  const excludes = positive.split(/\s+&&\s+|\s*;\s*|\s+\|\|\s+/).filter((p) => p.trim() !== "");
  if (excludes.length > 1 && positive === command) return false;
  if (positive.endsWith(":*")) {
    const prefix = positive.slice(0, -2);
    return hasWordBoundaryPrefix(stripped, prefix);
  }
  return wildcardMatch(positive, stripped) || hasWordBoundaryPrefix(stripped, positive);
}

function matchesNetworkRule(op: PermissionOp, pattern: string): boolean {
  const needle = pattern.startsWith("domain:") ? pattern.slice("domain:".length) : pattern;
  return networkHosts(op).some((host) => host === needle.toLowerCase() || host.endsWith(`.${needle.toLowerCase()}`));
}

function matchesAnyPath(op: PermissionOp, pattern: string): boolean {
  return allPaths(op).some((p) => {
    const normalized = normalizePathForMatch(p);
    const rule = normalizePathForMatch(pattern);
    return normalized === rule || normalized.startsWith(`${rule}/`) || wildcardMatch(rule, normalized);
  });
}

function hasDangerousOrProtectedPath(op: PermissionOp): boolean {
  if (!isPathProtectedTool(op)) return false;
  return allPaths(op).some((p) => {
    const normalized = normalizePathForMatch(p);
    const parts = normalized.split("/").filter(Boolean);
    const last = parts[parts.length - 1]?.toLowerCase() ?? "";
    return parts.some((part) => dangerousPathSegments.has(part.toLowerCase())) || protectedFilenames.has(last);
  });
}

function isReadPathOutsideAllowedRoots(op: PermissionOp): boolean {
  if (!safeTools.has(normalizeToolName(op.tool))) return false;
  return allPaths(op).some((p) => !isPathInsideAllowedRoots(p, op));
}

function isPathProtectedTool(op: PermissionOp): boolean {
  const opTool = normalizeToolName(op.tool);
  return writeTools.has(opTool) || safeTools.has(opTool);
}

function isPathInsideAllowedRoots(candidate: string, op: PermissionOp): boolean {
  const roots = [op.cwd, ...(op.additionalDirectories ?? [])].map((root) => resolvePathForContainment(root, op.cwd));
  const resolved = resolvePathForContainment(candidate, op.cwd);
  return roots.some((root) => resolved === root || resolved.startsWith(`${root}/`));
}

function resolvePathForContainment(candidate: string, cwd: string): string {
  const normalized = normalizePathForMatch(candidate);
  const isAbsolute = path.win32.isAbsolute(candidate) || path.posix.isAbsolute(candidate);
  const joined = isAbsolute ? normalized : normalizePathForMatch(path.resolve(cwd, candidate));
  return joined.replace(/\/$/, "");
}

function isSafeBashCommand(command: string): boolean {
  const stripped = stripEnvPrefix(command, false);
  const tokens = tokenizeCommand(stripped);
  if (tokens.length === 0) return false;
  return safeBashPrefixes.some((prefix) => startsWithTokens(tokens, prefix));
}

function isPreapprovedWebFetch(op: PermissionOp): boolean {
  return networkHosts(op).some((host) => safeWebFetchHosts.has(host));
}

function commandText(op: PermissionOp): string {
  if (op.command !== undefined) return op.command;
  if (op.argv && op.argv.length > 0) return op.argv.join(" ");
  return "";
}

function normalizeToolName(tool: string): string {
  const tail = tool.split("__").pop() ?? tool;
  return tail.replace(/[^A-Za-z]/g, "").toLowerCase();
}

function stripEnvPrefix(command: string, denyMode: boolean): string {
  let out = command.trim();
  while (true) {
    const match = out.match(/^([A-Za-z_][A-Za-z0-9_]*)=(?:"[^"]*"|'[^']*'|\S+)\s+([\s\S]*)$/);
    if (!match) return out;
    if (!denyMode && !safeEnvVars.has(match[1])) return out;
    out = match[2].trim();
  }
}

function tokenizeCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function startsWithTokens(tokens: string[], prefix: string[]): boolean {
  if (prefix.length > tokens.length) return false;
  return prefix.every((part, i) => tokens[i] === part || tokens[i] === `${part}:`);
}

function hasWordBoundaryPrefix(command: string, prefix: string): boolean {
  if (!command.startsWith(prefix)) return false;
  const next = command[prefix.length];
  return next === undefined || /[\s:;|&]/.test(next);
}

function countSubcommands(command: string): number {
  return command.split(/&&|\|\||;|\|/).length;
}

function allPaths(op: PermissionOp): string[] {
  return [...(op.paths ?? []), ...(op.resolvedPaths ?? [])];
}

function networkHosts(op: PermissionOp): string[] {
  const hosts: string[] = [];
  for (const target of op.network ?? []) {
    if (target.host) hosts.push(target.host.toLowerCase());
    if (target.url) {
      try {
        hosts.push(new URL(target.url).hostname.toLowerCase());
      } catch {}
    }
  }
  return hosts;
}

function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase();
}

function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[\\s\\S]*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}
