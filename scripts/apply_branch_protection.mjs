import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Applies the Tier-1 (AUTHORITATIVE) branch-protection ruleset to the repo's
// DEFAULT branch reproducibly and idempotently. Zero-dependency ESM. Shells `gh`.
//
// Tier-1 is the real server-side guarantee behind the Worktree-Isolation Mandate:
// it blocks direct pushes / force-push / deletion to the default branch for
// EVERYONE (admins included); all changes land via PR. Local hooks (Tier-2) and
// agent self-enforcement (Tier-3) are best-effort layers above this gate.
//
// Owner/repo derive from `git remote get-url origin`; default branch from
// origin/HEAD. The ruleset is read from .github/main-branch-protection.json.
// Re-running with the same JSON is a no-op (PUT is idempotent).

const here = dirname(fileURLToPath(import.meta.url));
const PROTECTION_JSON = resolve(here, "..", ".github", "main-branch-protection.json");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function parseOwnerRepo(url) {
  // Handles https://github.com/<owner>/<repo>(.git) and git@github.com:<owner>/<repo>(.git).
  const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) throw new Error(`could not parse owner/repo from origin URL: ${url}`);
  return { owner: m[1], repo: m[2] };
}

function resolveDefaultBranch() {
  try {
    const ref = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    if (ref) return ref.replace(/^origin\//, "");
  } catch {
    /* fall through */
  }
  return "main";
}

function main() {
  const originUrl = git(["remote", "get-url", "origin"]);
  const { owner, repo } = parseOwnerRepo(originUrl);
  const branch = resolveDefaultBranch();
  // Validate the committed ruleset is well-formed JSON before shelling out.
  JSON.parse(readFileSync(PROTECTION_JSON, "utf8"));

  const endpoint = `repos/${owner}/${repo}/branches/${branch}/protection`;
  console.log(`Applying Tier-1 branch protection to ${owner}/${repo} @ '${branch}'`);
  console.log(`  gh api -X PUT ${endpoint} --input ${PROTECTION_JSON}`);

  execFileSync("gh", ["api", "-X", "PUT", endpoint, "--input", PROTECTION_JSON], {
    encoding: "utf8",
    stdio: ["ignore", "inherit", "inherit"],
  });

  console.log(`OK: Tier-1 protection applied to ${owner}/${repo}:${branch} (idempotent).`);
  return 0;
}

process.exit(main());
