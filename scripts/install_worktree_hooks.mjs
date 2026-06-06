import { execFileSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Installs the Worktree-Isolation git hooks by pointing core.hooksPath at .githooks.
// Zero-dependency ESM. Idempotent. Does NOT itself run any worktree gate.
// core.hooksPath is repo-local (per-clone) config shared across all worktrees of one
// clone, so EVERY fresh clone must run this once.

const HOOKS_DIR = ".githooks";
const HOOK_FILES = ["pre-commit", "pre-push"];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function repoRoot() {
  // Resolve relative to THIS script's working tree (the .githooks beside scripts/),
  // so the installer works when run from any linked worktree, not only the primary checkout.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function main() {
  const root = repoRoot();
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const hooksAbs = join(root, HOOKS_DIR);

  if (!existsSync(hooksAbs)) {
    console.log(`FAIL: ${HOOKS_DIR}/ not found at ${hooksAbs}; cannot install worktree hooks.`);
    return 1;
  }

  // Idempotent: setting the same value twice is harmless.
  git(["config", "core.hooksPath", HOOKS_DIR]);
  const current = git(["config", "--get", "core.hooksPath"]);

  // Best-effort executable bit (no-op semantics on Windows; harmless under Git-for-Windows).
  for (const name of HOOK_FILES) {
    const hookPath = join(hooksAbs, name);
    if (existsSync(hookPath)) {
      try {
        chmodSync(hookPath, 0o755);
      } catch {
        // Non-POSIX filesystems may reject chmod; the shebang + hooksPath still work.
      }
    }
  }

  console.log("WORKTREE-HOOKS: installed");
  console.log(`  core.hooksPath = ${current}`);
  console.log(`  hooks: ${HOOK_FILES.join(", ")}`);
  console.log(
    "  NOTE: core.hooksPath is repo-local (per-clone) config shared across all worktrees of\n" +
      "  this clone. Every fresh clone must run `node scripts/install_worktree_hooks.mjs` once.\n" +
      `  (referenced from ${scriptDir})`
  );
  return 0;
}

process.exit(main());
