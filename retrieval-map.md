# Repo Retrieval Map (RAG Index)

**Always load this at session start.** It is the activation index for ALL repo
documentation. Coverage is aggressive by design â€” **prefer false positives**: if
a row plausibly matches, load the target. Every path below was verified to exist (existence, not canonicality).
When nothing matches or the source you have is insufficient, **stop and ask for
more context** (see final section).

Canonical instruction file: `AGENTS.md` (always loaded). This map routes to
everything else.

## 1. Direct topic index

| Topic | Document |
|---|---|
| Design rationale / the "why" / core bets | `docs/spec/arch-rationale.md` |
| Full technical spec | `docs/SPEC.md` |
| Spec hub / index | `docs/SPEC.md`, `docs/spec/` |
| Tool reference (params/returns) | `docs/tools.md` |
| Usage, model/effort matrix, ultracode | `docs/usage.md` |
| Install / registration (all platforms) | `docs/registration.md`, `docs/install/_INDEX.md` |
| Claude Code / Codex / Desktop install | `docs/install/claude-code-cli.md`, `docs/install/codex-cli.md`, `docs/install/claude-desktop.md`, `docs/install/codex-desktop.md` |
| Agent status lifecycle | `docs/reference/status-lifecycle.md` |
| Effort resolution | `docs/reference/effort-resolution.md` |
| Interactive driver model | `docs/spec/interactive-drivers.md` |
| Global concurrency cap | `docs/spec/global-concurrency/_INDEX.md`, `docs/spec/global-concurrency/cap-contract.md` |
| Auto-mode / routing | `docs/spec/auto-mode/_INDEX.md`, `docs/spec/auto-mode/param-contract.md`, `docs/spec/auto-mode/resolution-matrix.md`, `docs/spec/auto-mode/routing-table-contract.md`, `docs/spec/auto-mode/routing-table-model-effort.md`, `docs/spec/auto-mode/tool-description.md`, `docs/spec/auto-mode/build-and-test.md` |
| Routing table artifact | `src/routing-table.json` (canonical profiler-emitted artifact; copied to `dist/`) + `.spec/references/assets/routing-table.json` (non-authoritative structural mirror) |
| Task taxonomy (14 categories) | `docs/spec/task-taxonomy/_INDEX.md` (+ `category-rationale.md`, `composite-inferred-tiles.md`, `derivation-methodology.md`, `determination-rationale.md`) |
| Work categories (fixed taxonomy) | `.spec/references/work-categories.md` |
| Advanced ruleset override | `docs/spec/advanced-ruleset/_INDEX.md` (+ `execution-contract.md`, `io-contract.md`, `visibility-and-failover.md`, `build-and-test.md`, `scaffold-and-deployment.md`) |
| Orchestration mode semantics | `docs/spec/orchestration-mode/_INDEX.md` |
| Orchestration directive architecture | `docs/spec/dev-loop/orchestration-directive-architecture.md` (retrieval map over its subdir leaves) |
| â€” arch subdir leaves | `docs/spec/dev-loop/orchestration-directive-architecture/{sections-00-04,sections-05-09,sections-10-13,derivation-map,appendix-a1-a4,appendix-a5-directives,appendix-a6-a7}.md` |
| Model-selection mode | `docs/spec/model-selection-mode/_INDEX.md` |
| Safety scope / clarifying cascade | `docs/spec/safety-scope.md` (+ `safety-scope/00-scope-and-cascade.md`, `01-question-flow.md`, `02-debug-and-credentials.md`, `03-subagents-platforms.md`) |
| Worktree enforcement | `docs/spec/dev-loop/worktree-enforcement/_INDEX.md` (+ `enforcement.md`, `naming.md`, `claude.md`, `codex.md`) |
| Git collaboration | `docs/spec/dev-loop/git-collaboration.md`, `agents/GIT_COLLABORATION.md` |
| CI/CD (Claude routines) | `docs/spec/dev-loop/claude-routines-cicd.md`, `docs/spec/dev-loop/claude-routine-prompt.md` |
| Release / publishing | `docs/spec/dev-loop/release-publishing.md` |
| Contradiction checker | `docs/spec/dev-loop/contradiction-checker.md` |
| Prompt review (8-perspective) | `docs/spec/prompt-review/eight-perspective-review.md` |
| Graphify (knowledge graph) | `docs/spec/graphify.md` |
| Contributing / dev env | `CONTRIBUTING.md`, `docs/CONTRIBUTING.md` (redirect stub) |
| Release notes | `docs/release-notes.md` |
| Directive source assets | `directives/{orchestration-claude,orchestration-codex,carryover-claude,carryover-codex,reminder-on,reminder-off-claude,reminder-off-codex,short-on,short-off}.md` |
| MCP builder skill | `skills/mcp-builder/SKILL.md` (+ `references/`) |
| Model profiler skill | `skills/model-profiler/SKILL.md` (+ `references/`) |
| Installer skill | `skills/subagent-mcp-installer/SKILL.md` (+ `references/`) |
| Nested RAG map (skill) | `skills/mcp-builder/references/retrieval-map.md`, `.spec/references/retrieval-map.md` |

## 2. Alias / synonym index

| You saidâ€¦ | Means | Go to |
|---|---|---|
| "the why", "rationale", "design bets", "why built this way" | arch rationale | `docs/spec/arch-rationale.md` |
| "sub-agent", "subagent", "worker", "delegate", "child session" | managed agent | `docs/tools.md`, `docs/reference/status-lifecycle.md` |
| "orchestrator", "manager mode", "delegate-only" | orchestration mode | `docs/spec/orchestration-mode/_INDEX.md` |
| "cap", "limit", "max agents", "concurrency", "slots" | global concurrency cap | `docs/spec/global-concurrency/cap-contract.md` |
| "routing", "auto-pick", "model selection", "which model" | auto-mode / routing | `docs/spec/auto-mode/_INDEX.md` |
| "category", "task type", "work category", "taxonomy" | task taxonomy | `docs/spec/task-taxonomy/_INDEX.md`, `.spec/references/work-categories.md` |
| "stuck", "quiet", "not responding", "hung" | stalled lifecycle | `docs/reference/status-lifecycle.md` |
| "hook", "injection", "reminder", "directive", "managed block" | orchestration directives | `docs/spec/dev-loop/orchestration-directive-architecture.md`, `directives/` |
| "install", "setup", "register", "wire" | registration | `docs/registration.md`, `docs/install/_INDEX.md` |
| "publish", "release", "npm", "ship" | release | `docs/spec/dev-loop/release-publishing.md` |
| "worktree", "branch-per-task", "isolation" | worktree enforcement | `docs/spec/dev-loop/worktree-enforcement/_INDEX.md` |

## 3. Trigger-phrase index

| Phrase in prompt | Load |
|---|---|
| "how do I install / set up subagent-mcp" | `docs/registration.md`, `docs/install/_INDEX.md` |
| "what does tool X return / its params" | `docs/tools.md` |
| "why delegate / long context / no compaction" | `docs/spec/arch-rationale.md` |
| "add / change a tool param" | `docs/spec/auto-mode/param-contract.md` |
| "change the cap / too many agents" | `docs/spec/global-concurrency/cap-contract.md` |
| "classify this task / pick a category" | `.spec/references/work-categories.md`, `docs/spec/task-taxonomy/_INDEX.md` |
| "re-profile models / new model shipped" | `skills/model-profiler/SKILL.md` |
| "build an MCP server" | `skills/mcp-builder/SKILL.md` |
| "install subagent-mcp addon globally" | `skills/subagent-mcp-installer/SKILL.md` |
| "before I commit / branch / push" | `docs/spec/dev-loop/git-collaboration.md`, `agents/GIT_COLLABORATION.md` |
| "edit a workflow / required check" | `docs/spec/dev-loop/claude-routines-cicd.md` |

## 4. Task-to-document map

| Task | Primary doc |
|---|---|
| Register the server with a host | `docs/registration.md` |
| Call/understand a tool | `docs/tools.md` |
| Change routing behavior | `docs/spec/auto-mode/_INDEX.md` + `src/routing-table.json` (canonical) + `.spec/references/assets/routing-table.json` (non-authoritative structural mirror) |
| Change the concurrency cap | `docs/spec/global-concurrency/cap-contract.md` |
| Change orchestration directives | `docs/spec/dev-loop/orchestration-directive-architecture.md` + `directives/` |
| Change model-selection contract | `docs/spec/model-selection-mode/_INDEX.md` |
| Build / test / publish | `CONTRIBUTING.md`, `docs/spec/dev-loop/release-publishing.md` |
| Classify work into a category | `.spec/references/work-categories.md` |
| Do any mutating git work | `docs/spec/dev-loop/git-collaboration.md` + worktree-enforcement `_INDEX.md` |

## 5. Symptom / error-to-document map

| Symptom / error | Look at |
|---|---|
| Agent shows `stalled` / looks stuck | `docs/reference/status-lifecycle.md` |
| `launch_agent` rejected at cap | `docs/spec/global-concurrency/cap-contract.md` |
| `401 Unauthorized` on install | `docs/registration.md` |
| Version-surface mismatch fails build | `CONTRIBUTING.md` (version-sync gate) |
| Hook not firing / no injection | `docs/spec/dev-loop/orchestration-directive-architecture.md`, `docs/registration.md` |
| Wrong model/effort picked | `docs/spec/auto-mode/resolution-matrix.md`, `docs/reference/effort-resolution.md` |
| Zombie / stale slot killed | `docs/spec/global-concurrency/cap-contract.md`, `docs/SPEC.md` |
| Publish/registry failure | `docs/spec/dev-loop/release-publishing.md` |

## 6. Entity / product / vendor / project map

| Entity | Doc |
|---|---|
| Claude Code (Anthropic) | `docs/install/claude-code-cli.md`, `docs/spec/interactive-drivers.md` |
| Codex (OpenAI CLI) | `docs/install/codex-cli.md`, `docs/spec/interactive-drivers.md` |
| Gemini CLI | `docs/registration.md` |
| npmjs / GitHub Packages | `docs/registration.md`, `docs/spec/dev-loop/release-publishing.md` |
| `@heretyc/subagent-mcp` package | `README.md`, `CONTRIBUTING.md` |
| routing-table.json artifact | `src/routing-table.json` (canonical), `.spec/references/assets/routing-table.json` (non-authoritative structural mirror), `docs/spec/auto-mode/routing-table-contract.md` |

## 7. Workflow map

| Workflow | Docs (in order) |
|---|---|
| Install â†’ wire â†’ enable | `docs/registration.md` â†’ `docs/install/_INDEX.md` |
| Build â†’ test â†’ publish | `CONTRIBUTING.md` â†’ `docs/spec/dev-loop/release-publishing.md` |
| Branch â†’ work â†’ PR â†’ merge | `docs/spec/dev-loop/git-collaboration.md` â†’ `agents/GIT_COLLABORATION.md` â†’ `docs/spec/dev-loop/claude-routines-cicd.md` |
| Mutating action gate | worktree-enforcement `_INDEX.md` â†’ `enforcement.md` |
| Re-profile fleet | `skills/model-profiler/SKILL.md` â†’ `docs/spec/auto-mode/_INDEX.md` |

## 8. Decision-rule map

| Decision | Authority |
|---|---|
| Classification ordering | `src/routing-table.json` - `classification_precedence` array is the SOLE ordering authority; `.spec/references/assets/routing-table.json` is a non-authoritative structural mirror |
| Which model/provider/effort | `docs/spec/auto-mode/resolution-matrix.md` + routing-table.json |
| Orchestration ON vs OFF default | `docs/spec/dev-loop/orchestration-directive-architecture.md` (fail-safe ON on hookless hosts) |
| Cap value / floor | `docs/spec/global-concurrency/cap-contract.md` (default 20, min 10, single global) |
| Spec vs code conflict | halt & clarify â€” `CONTRIBUTING.md` (Spec-First), `docs/spec/dev-loop/contradiction-checker.md` |

## 9. Failure-mode map

| Failure mode | Doc |
|---|---|
| Uncontrolled inline execution (hookless host) | `docs/spec/dev-loop/orchestration-directive-architecture.md` (fail-safe ON) |
| Fork-bomb / recursion | AGENTS.md sub-agent carve-out; `docs/spec/dev-loop/worktree-enforcement/_INDEX.md` |
| Parallel checkout corruption | worktree-enforcement `_INDEX.md` |
| Drift / hallucination over long runs | `docs/spec/arch-rationale.md` (durable hooks) |
| Silent launch failover | `docs/spec/advanced-ruleset/visibility-and-failover.md` |
| Doc drift (per-provider cap reintro) | `test/no-per-provider-cap.test.mjs` (guard) |

## 10. "Load this whenâ€¦" per reference file

- `docs/spec/arch-rationale.md` â€” need the design rationale / core bets.
- `docs/tools.md` â€” need exact tool params/return shapes.
- `docs/usage.md` â€” need model/effort matrix or ultracode.
- `docs/registration.md` / `docs/install/*` â€” installing or wiring a host.
- `docs/reference/status-lifecycle.md` â€” an agent's status is unclear.
- `docs/reference/effort-resolution.md` â€” effort level seems wrong.
- `docs/spec/global-concurrency/*` â€” anything about the cap.
- `docs/spec/auto-mode/*` â€” routing, param contract, resolution.
- `docs/spec/task-taxonomy/*` + `.spec/references/work-categories.md` â€” classifying work.
- `docs/spec/advanced-ruleset/*` â€” the python override hook / failover window.
- `docs/spec/orchestration-mode/*` + `directives/*` â€” orchestration semantics/source.
- `docs/spec/dev-loop/orchestration-directive-architecture(.md|/*)` â€” directive architecture; the `.md` is a map over the subdir leaves.
- `docs/spec/model-selection-mode/*` â€” smart vs user-approved-overrides.
- `docs/spec/safety-scope*` â€” clarify/consent/refuse/credentials/irreversible.
- `docs/spec/dev-loop/worktree-enforcement/*` â€” before ANY mutating action.
- `docs/spec/dev-loop/git-collaboration.md` + `agents/GIT_COLLABORATION.md` â€” git writes.
- `docs/spec/dev-loop/claude-routine*.md` â€” CI/CD or routine text.
- `docs/spec/dev-loop/release-publishing.md` â€” publish/registry.
- `docs/spec/dev-loop/contradiction-checker.md` â€” pre-commit contradiction gate.
- `docs/spec/prompt-review/eight-perspective-review.md` â€” changing instruction/prompt files.
- `docs/spec/graphify.md` â€” architecture/navigation questions, before grep/find.
- `docs/spec/interactive-drivers.md` â€” driver model / provider process handling.
- `CONTRIBUTING.md` â€” dev env, build, test, contribution workflow.
- `skills/mcp-builder/SKILL.md` â€” building an MCP server.
- `skills/model-profiler/SKILL.md` â€” re-profiling the fleet / routing-table regen.
- `skills/subagent-mcp-installer/SKILL.md` â€” installing the addon globally.

## 11. When to stop and ask for more context

Stop and request more source context (do NOT guess) when: no index row matches
the prompt with reasonable confidence; two docs give conflicting answers (spec
vs code â€” halt & clarify per Spec-First); the answer depends on a file not
indexed here; or the task requires a credential, irreversible action, or
authorization decision (route to `docs/spec/safety-scope.md` first).
