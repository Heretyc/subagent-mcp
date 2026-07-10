import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Worktree-Isolation pre-action gate. Zero-dependency ESM. Implements GATE LOGIC
// from docs/spec/dev-loop/worktree-enforcement/. Standalone-runnable and hook-runnable.
// Prints `WORKTREE-GATE: PASS` (exit 0) or `WORKTREE-GATE: FAIL` + numbered reasons +
// exact remediation (exit 1). Read-only/immutable actions are exempt and must not call this.

const ALLOWED_TYPES = [
  "feature",
  "fix",
  "hotfix",
  "release",
  "docs",
  "test",
  "refactor",
  "chore",
  "agent",
  "user",
  "integration",
  "audit",
];

// The branch-name formula regex (literal). `git check-ref-format --branch` is still
// required for the deeper ref rules (.lock, .., @{, trailing dot/slash, 40-hex topics).
const BRANCH_FORMULA =
  /^(feature|fix|hotfix|release|docs|test|refactor|chore|agent|user|integration|audit)\/[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?$/;

// Literal fallback set of branches that may never be a worktree mutation target.
// The real protected set is this UNION the repo's resolved default branch (see
// resolveProtectedBranches): a type-named default like `release/x` is still blocked.
const FALLBACK_PROTECTED_BRANCHES = ["main", "master"];

function git(args) {
  // Returns { ok, out } — never throws; non-zero exit is reported as ok:false.
  try {
    const out = execFileSync("git", args, { encoding: "utf8" }).trim();
    return { ok: true, out };
  } catch (error) {
    const out = (error.stdout || error.stderr || error.message || "").toString().trim();
    return { ok: false, out };
  }
}

function realpathSafe(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

// True when `child` is equal to, or nested under, `parent` (case-insensitive on win32).
function isInside(child, parent) {
  const norm = (p) => (process.platform === "win32" ? p.replace(/\\/g, "/").toLowerCase() : p);
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith("/") ? p : `${p}/`);
}

// Resolve the repo's real default branch from origin/HEAD and UNION it with the
// literal fallback set {main, master}. If origin/HEAD is unset, just the fallback.
// Returns { set: Set<string>, resolvedDefault: string|null }.
function resolveProtectedBranches() {
  const set = new Set(FALLBACK_PROTECTED_BRANCHES);
  let resolvedDefault = null;
  const def = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (def.ok && def.out) {
    resolvedDefault = def.out.replace(/^origin\//, "");
    if (resolvedDefault) set.add(resolvedDefault);
  }
  return { set, resolvedDefault };
}

function checkGate() {
  const reasons = [];
  const { set: protectedBranches, resolvedDefault } = resolveProtectedBranches();

  // 1. Must be inside a git work tree.
  const insideWorkTree = git(["rev-parse", "--is-inside-work-tree"]);
  if (!insideWorkTree.ok || insideWorkTree.out !== "true") {
    reasons.push("not inside a git work tree (mutating work requires a linked worktree).");
    return { pass: false, reasons, branch: null };
  }

  // 2. Primary-vs-linked: a linked worktree has a per-worktree gitDir distinct from the
  //    shared common dir. Primary tree => realpath(gitDir) === realpath(commonDir).
  const absGitDir = git(["rev-parse", "--absolute-git-dir"]);
  const commonDir = git(["rev-parse", "--git-common-dir"]);
  let primaryTop = null;
  if (absGitDir.ok && commonDir.ok) {
    const realGit = realpathSafe(absGitDir.out);
    const realCommon = realpathSafe(commonDir.out);
    if (realGit === realCommon) {
      reasons.push(
        "primary working tree detected — all mutating work must happen in a LINKED worktree, never the primary checkout."
      );
    }
    // The primary worktree root is the parent of the common .git dir.
    primaryTop = realpathSafe(dirname(realCommon));
  } else {
    reasons.push("could not resolve git directories (rev-parse --absolute-git-dir / --git-common-dir failed).");
  }

  // 3. Branch must be a concrete, non-protected branch (not detached HEAD).
  const head = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = head.ok ? head.out : null;
  if (!head.ok || branch === "HEAD" || branch === "") {
    reasons.push("detached HEAD — check out a compliant named branch before any mutating action.");
  } else if (protectedBranches.has(branch)) {
    const dflt = resolvedDefault ? `resolved default '${resolvedDefault}'` : "default unresolved";
    reasons.push(
      `branch '${branch}' is a protected/default branch (protected set: ` +
        `${[...protectedBranches].join(", ")}; ${dflt}) — mutating work is forbidden here.`
    );
  } else {
    // 4. Branch name must satisfy the formula AND git check-ref-format.
    if (!BRANCH_FORMULA.test(branch)) {
      reasons.push(
        `branch '${branch}' does not match the formula ${BRANCH_FORMULA.source} ` +
          `(allowed types: ${ALLOWED_TYPES.join(", ")}).`
      );
    }
    const refOk = git(["check-ref-format", "--branch", branch]);
    if (!refOk.ok) {
      reasons.push(`branch '${branch}' fails 'git check-ref-format --branch'.`);
    }
    // Deeper ref rules the formula alone does not catch.
    if (/\.lock$/.test(branch) || branch.includes("..") || branch.includes("@{")) {
      reasons.push(`branch '${branch}' contains a forbidden token (.lock, .., or @{).`);
    }
    if (/(^|\/)[0-9a-f]{40}($|\/)/.test(branch)) {
      reasons.push(`branch '${branch}' has a 40-hex object-id-like segment.`);
    }
  }

  // 5. Outside-repo check: this worktree must NOT be the primary tree or nested under it.
  const showTop = git(["rev-parse", "--show-toplevel"]);
  if (showTop.ok && primaryTop) {
    const thisTop = realpathSafe(showTop.out);
    if (isInside(thisTop, primaryTop)) {
      reasons.push(
        "worktree must live OUTSIDE the primary repo directory under a sibling worktree root " +
          "(not e.g. .claude/worktrees/ inside the repo)."
      );
    }
  } else if (!showTop.ok) {
    reasons.push("could not resolve worktree top-level (rev-parse --show-toplevel failed).");
  }

  return { pass: reasons.length === 0, reasons, branch };
}

function remediation(branch) {
  // Best-effort default branch for the sibling-worktree command.
  const def = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const base = def.ok && def.out ? def.out : "origin/main";
  return [
    "Remediation — create/enter a compliant linked worktree (run from the primary checkout):",
    `  git worktree add -b <type>/<subject> ../<repo>.worktrees/<type>-<subject> ${base}`,
    "  # then do ALL mutating work from inside that sibling path.",
    "  # <type> in: feature|fix|hotfix|release|docs|test|refactor|chore|agent|user|integration|audit",
    "  # <subject>: lowercase kebab, [a-z0-9] start, then [a-z0-9._-]; folder uses '-' for '/'.",
  ].join("\n");
}

function main() {
  // Delegated sub-agents launched by subagent-mcp run with SUBAGENT_MCP_SUBAGENT=1
  // and are already placed in their target cwd by the orchestrator. They must not be
  // forced into a linked worktree — short-circuit BEFORE any isolation check.
  if (process.env.SUBAGENT_MCP_SUBAGENT === "1") {
    console.log(
      "check_worktree: delegated sub-agent (SUBAGENT_MCP_SUBAGENT=1) — worktree isolation skipped; operating in provided cwd."
    );
    return 0;
  }
  const { pass, reasons, branch } = checkGate();
  if (pass) {
    console.log("WORKTREE-GATE: PASS");
    return 0;
  }
  console.log("WORKTREE-GATE: FAIL");
  reasons.forEach((reason, index) => console.log(`  ${index + 1}. ${reason}`));
  console.log(remediation(branch));
  return 1;
}

process.exit(main());
