# Contributing to subagent-mcp

This repository is operated by **specification-first changes** and **Claude
Routine CI/CD**, and is licensed under **Apache-2.0**. Before making changes,
read [AGENTS.md](AGENTS.md) : it is the canonical repository instruction file :
along with the dev-loop specs under [docs/spec/dev-loop/](docs/spec/dev-loop/).
This guide covers the developer environment, build, test, contribution
workflow, CI/CD gates, and publishing.

## Prerequisites

Developer / build-from-source toolchain (end-user runtime requirements live in
[README section  What you need first](README.md#what-you-need-first)):

- **Node.js >= 18**  (`node --version`)
- **npm >= 8**  (`npm --version`)
- **`claude` CLI** : globally installed and authenticated  (`claude --version`)
- **`codex` CLI** : globally installed and authenticated  (`codex --version`; optional if only using Claude paths)
- **Git**  (`git --version`)
- **TypeScript 5** : dev dependency, installed by `npm install`; no global install needed

## Local Setup (Build from Source)

```bash
git clone https://github.com/Heretyc/subagent-mcp.git
cd subagent-mcp
npm install
npm run build
node dist/index.js   # verify: the MCP server starts
```

`npm install` runs the `postinstall` script and the `prepare` script (which
runs `npm run build`), so the project is built automatically on a clean clone.
The server entry point after build is `dist/index.js`.

**Version-sync gate.** The version string must match across these surfaces:
`package.json`, `package-lock.json` (top-level), `package-lock.json`
(`packages[""]`), the MCP server `version` in `src/index.ts`, and
`.claude-plugin/plugin.json` (plus each `plugins[].version` in
`.claude-plugin/marketplace.json` / `marketplace.json` when present). Run
`npm run check:versions` to validate. To bump, use
`npm version <patch|minor|major> --no-git-tag-version` for the first three
surfaces, then edit `src/index.ts` manually, then re-run `npm run check:versions`.

**From-source registration.** See
[docs/registration.md](docs/registration.md) : *Developer install from source* :
for the per-platform MCP host wiring steps (Claude Code, Codex, Gemini CLI,
Claude Desktop) once the from-source binary is built.

## Development Commands

| Command | What it does |
|---|---|
| `npm run build` | Version sync (`check:versions`) → scaffold gen → TypeScript compile (`tsc`) → copy provider assets |
| `npm run check:versions` | Assert all version surfaces match (incl. `.claude-plugin/plugin.json` + marketplace `plugins[].version`); blocks the build on mismatch |
| `npm run check:prose` | Enforce ASCII prose policy across markdown docs, excluding managed blocks and vendored docs |
| `npm start` | `node dist/index.js` : run the compiled server |
| `npm test` | Full test suite (~40 test files) plus three validator scripts |

Lifecycle hooks: `prepare` runs `npm run build` (fires on `npm install`);
`prepublishOnly` runs `npm test` (fires before publish); `postinstall` runs
`scripts/postinstall.mjs`.

## Running Tests

```bash
npm test
```

`npm test` runs `check:versions` as a precondition (a version-surface mismatch
fails before any test logic), then `check:prose`, the ~40 test files under
`test/`, plus the validator scripts:

- `scripts/validate_provider.mjs`
- `scripts/validate_seed_sites.mjs`
- `scripts/validate_routing_audit.mjs`

**Doc-invariant guard tests** (fail the suite on documentation drift):

- `test/no-per-provider-cap.test.mjs` : asserts no doc reintroduces
  per-provider concurrency-cap language; the cap is a single machine-global,
  provider-agnostic value (default 20).
- `test/rag-pointers.test.mjs` : asserts the RAG retrieval map (`retrieval-map.md`)
  and doc cross-pointers stay valid (every indexed path exists).

Mock driver seams (`SUBAGENT_MOCK_CLAUDE_DRIVER`,
`SUBAGENT_MOCK_CODEX_DRIVER`, and `SUBAGENT_MOCK_DRIVER_SCRIPT`) are test-only.
They require `NODE_ENV=test` or `SUBAGENT_MCP_ENABLE_TEST_SEAMS=1`.

## Contribution Workflow

1. Inspect `git status --short --branch` before work.
2. Read `AGENTS.md`, `docs/spec/dev-loop/git-collaboration.md`, and `agents/GIT_COLLABORATION.md`.
3. Work on a short-lived policy-named topic branch; never directly on protected or default branches.
4. Keep changes scoped to the active task and preserve user/unowned work.
5. Run `npm run build && npm test` before staging; stage only inspected diffs as small logical units.
6. Open a PR for non-trivial changes; the PR must include summary, validation steps, risk, rollback plan, and reviewer notes.
7. Validate docs, JSON, local scripts, Claude routine CI/CD mapping, and generated artifacts before commit.
8. Do not add AI attribution or co-author lines to commits.

See [docs/spec/dev-loop/git-collaboration.md](docs/spec/dev-loop/git-collaboration.md) for the extended git-collaboration rules.

### Worktree-per-task, hooks, and pre-commit gate

- **Git hooks.** Install the repo hooks once (`git config core.hooksPath .githooks`).
  They run the pre-commit compliance and contradiction checks locally.
- **Worktree-per-task.** All mutating work happens in a **linked worktree on a
  `<type>/<subject>` branch outside the repo dir** : never in the primary
  checkout. Run the pre-action gate `node scripts/check_worktree.mjs` before any
  mutating action; on failure, create/enter a compliant worktree first.
- **Contradiction-checker pre-commit.** Before committing any executable/source
  or build-participating change, run `node scripts/check_mcp_compliance.mjs`
  (a FAIL blocks the commit), then the contradiction-checker per
  [docs/spec/dev-loop/contradiction-checker.md](docs/spec/dev-loop/contradiction-checker.md).
  Never commit around a `blocked`/`needs_user` result.

## GitHub Gates (CI/CD)

- Claude Code Routines are the canonical CI/CD path.
- `.github/workflows/claude-routine.yml` is the GitHub-standard dispatch bridge to Claude routine CI/CD.
- `.github/workflows/pr-gate.yml` is a **required check** : it runs the test
  suite and the standalone `check:prose` ASCII prose gate on every PR; a
  failure blocks merge.
- `.github/workflows/worktree-guard.yml` enforces the worktree-isolation mandate.
- PRs must pass required checks, independent review, CODEOWNER review when applicable, and resolved conversations before merge.
- Agent-authored PRs use the same CI, review, and merge gates as human PRs.
- Workflow changes are executable code and require owner/CODEOWNER review.

On private Free-org repos the `claude-routine-dispatch` check is a mandatory
manual merge gate.

See [docs/spec/dev-loop/claude-routines-cicd.md](docs/spec/dev-loop/claude-routines-cicd.md)
for the full CI/CD spec and
[docs/spec/dev-loop/git-collaboration.md](docs/spec/dev-loop/git-collaboration.md)
for the merge/collaboration rules.

## Spec-First Changes

The specification is authoritative. Before changing behavior, update or verify
the corresponding spec doc. When spec and code diverge, **halt and clarify** :
do not self-resolve. Triage each drift item four ways: code-stale, spec-stale,
genuine-ambiguity, or informational. Never batch newly discovered drift issues.
See
[docs/spec/dev-loop/orchestration-directive-architecture.md](docs/spec/dev-loop/orchestration-directive-architecture.md)
for the canonical orchestration model.

## Publishing (Maintainers Only)

npmjs.com is the default publish target. GitHub Packages is the optional mirror,
selected with an explicit `--registry` override (`publishConfig.registry` points
at npmjs, so the override redirects the same tarball). The release/publish SOP is
maintained as a single source of truth : see
[docs/spec/dev-loop/release-publishing.md](docs/spec/dev-loop/release-publishing.md)
for the exact current commands.

## Boundary Contract (Anti-Drift Enforcement)

Each topic has exactly one home. Cross-link from the listed places; never
duplicate the content in the "Must NOT be duplicated in" column.

| Topic | Single home | Must NOT be duplicated in |
|---|---|---|
| End-user runtime prerequisites | README section  Prerequisites | CONTRIBUTING (link only) |
| Developer / build prerequisites | CONTRIBUTING section  Prerequisites | README (link only); docs/registration.md; CONTRIBUTING section  Publishing |
| From-source build steps (clone/install/build/run) | CONTRIBUTING section  Local Setup | README; any other CONTRIBUTING section |
| MCP host wiring (per-platform) | docs/registration.md | README; CONTRIBUTING prose |
| MCP-only server registration vs orchestration-hook install | docs/registration.md owns MCP server registration steps only; docs/install/* owns orchestration-hook install, plugin/npm/manual wiring, and per-host hook verification | Do not put orchestration-hook install steps in docs/registration.md; do not duplicate MCP-only server config steps in docs/install/* |
| Contribution workflow (8 steps) | CONTRIBUTING section  Contribution Workflow | docs/CONTRIBUTING.md (redirect stub only); README |
| GitHub CI/CD gates | CONTRIBUTING section  GitHub Gates (CI/CD) | README; any other doc |
| Release / publish SOP | docs/spec/dev-loop/release-publishing.md | README; CONTRIBUTING section  Local Setup |
| Install commands (npmjs + GitHub Packages) | README section  Install | CONTRIBUTING section  Publishing (brief context only; no install commands) |
| Auto Mode routing table | docs/spec/auto-mode/_INDEX.md | CONTRIBUTING; other spec docs |
| Tools parameter/return shapes | docs/tools.md | CONTRIBUTING; spec docs |
| Agent lifecycle semantics | docs/reference/status-lifecycle.md | CONTRIBUTING; Auto Mode section |
| Orchestration model (schema=3) | docs/spec/dev-loop/orchestration-directive-architecture.md | Any doc that would copy schema text inline |
| Model-selection-mode semantics | docs/spec/model-selection-mode/_INDEX.md | CONTRIBUTING; other README sections |
| version string | src/index.ts + package.json (kept in sync via check:versions) | Any markdown doc (do not hard-code version strings in prose) |
| publishConfig rationale | CONTRIBUTING section  Publishing | README; any spec doc not listed |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) files.
