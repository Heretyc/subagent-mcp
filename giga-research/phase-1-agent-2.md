# Phase 1 Research Agent 2: OpenAI Codex / GPT-5.5 Routing

Date: 2026-05-29. Scope: GPT-5.5 family as exposed through OpenAI Codex CLI / `codex exec`, with reasoning-effort routing. Status note: OpenAI's public docs and this local CLI identify `gpt-5.5` as the recommended Codex model. I do not have hidden access to OpenAI internal benchmark data, system deployment metadata, or subscription entitlements beyond what this runtime exposes and what official docs publish; "self-knowledge" below means observed behavior of this Codex CLI session plus model-family behavior I can report from operating in it, not an undisclosed telemetry feed.

## Highest-impact decision rules

Use GPT-5.5 in Codex when the work is closed-loop and evidence-bearing: inspect files, run commands, transform data, create narrowly scoped code, extract facts, produce proofs from local artifacts, or iterate until tests/checks pass. OpenAI describes GPT-5.5 as its newest frontier model for "complex coding, computer use, knowledge work, and research workflows in Codex" and says most Codex tasks should start with `gpt-5.5` (OpenAI, 2026e). GPT-5.5's launch note emphasizes stronger agentic coding, computer use, knowledge work, research, context reasoning, and action over time, with Codex-specific gains in implementation, refactors, debugging, testing, validation, assumption checking, and carrying changes through a surrounding codebase (OpenAI, 2026a). Use a Claude-style reviewer or a separate contradiction checker when the output creates security, architecture, legal, financial, or irreversible risk; GPT-5.5 is strong at execution but can still produce confident wrong conclusions or insecure code.

Default routing: `gpt-5.5 + medium` for normal Codex tasks; `low` for fast, bounded file/script work; `high` for difficult debugging, multi-file changes, ambiguous failures, or research synthesis; `xhigh` only for asynchronous hard-agent tasks where maximum quality matters more than latency/cost and evals justify it. OpenAI's GPT-5.5 guide says `medium` is the balanced default, `none` is only for latency-critical work that does not need reasoning or chained tool calls, `low` should be evaluated before `none` when tool use/planning/search/multistep decisions matter, and `high`/`xhigh` should be increased only when evals show measurable gains (OpenAI, 2026d). The general prompt guidance similarly says `xhigh` should not be a default and is for long, agentic, reasoning-heavy tasks where maximum intelligence matters more than speed or cost (OpenAI, 2026g).

Do not use GPT-5.5 as the sole authority for broad architecture direction, high-stakes security design, final merge approval, or claims requiring external truth unless it is grounded in fetched sources or executed checks. It is best as the worker that turns a known objective into a verified artifact. Pairing pattern: GPT-5.5 implements/extracts/tests; Claude Opus/Sonnet or another independent reviewer reviews intent, contradictions, security, and maintainability; GPT-5.5 then applies surgical fixes if needed. For this repo specifically, repository policy already requires contradiction checking before commits that change executable/source code.

## Model and product facts

OpenAI says GPT-5.5 was released on April 23, 2026, rolled out to ChatGPT and Codex users, and is available in Codex for Plus, Pro, Business, Enterprise, Edu, and Go plans with a 400K context window; Fast mode generates tokens 1.5x faster for 2.5x the Codex credit cost (OpenAI, 2026a). The same launch note says API availability for `gpt-5.5` is "very soon" at $5 per 1M input tokens and $30 per 1M output tokens with a 1M context window, Batch/Flex at half standard rate, Priority at 2.5x standard, and `gpt-5.5-pro` planned at $30/M input and $180/M output (OpenAI, 2026a). Codex's current rate card lists GPT-5.5 at 125 credits per 1M input tokens, 12.50 credits per 1M cached input tokens, and 750 credits per 1M output tokens, with Fast mode consuming credits at a higher rate and code review using GPT-5.3-Codex (OpenAI, 2026b). The ChatGPT help page lists GPT-5.5 Instant, Thinking, and Pro; GPT-5.5 Thinking supports all ChatGPT tools, and manually selected Thinking context is 256K for paid tiers or 400K for Pro, while Instant context ranges from 16K to 128K by tier (OpenAI, 2026c). Codex's model page says `gpt-5.5` is available in Codex via ChatGPT sign-in or API-key authentication and that `gpt-5.4-mini` is the faster/lower-cost option for lighter coding tasks or subagents (OpenAI, 2026e).

Codex CLI is a local coding agent that can read, change, and run code in the selected directory; OpenAI documents it as open source, Rust-based, and available on macOS, Windows, and Linux, with native PowerShell/Windows sandbox support and WSL2 as an option for Linux-native workflows (OpenAI, 2026h). My local observed CLI is `codex-cli 0.135.0`; `codex exec --help` in this session exposes `--model`, `--sandbox read-only|workspace-write|danger-full-access`, `--dangerously-bypass-approvals-and-sandbox`, `--skip-git-repo-check`, `--json`, `--output-schema`, `--output-last-message`, `--ephemeral`, `--ignore-user-config`, and `--ignore-rules`. Treat local help as runtime evidence for this installation, not as an internet citation.

## Codex CLI / `codex exec` semantics

`codex exec` is the non-interactive mode for scripts, CI, pre-merge checks, scheduled jobs, release-note generation, summaries, or shell pipelines; OpenAI says it streams progress to `stderr` and prints only the final agent message to `stdout` in normal mode (OpenAI, 2026i). With `--json`, `stdout` becomes JSON Lines, emitting events such as `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, and `error`; item events can include agent messages, reasoning, command executions, file changes, MCP tool calls, web searches, and plan updates (OpenAI, 2026i). Use `--output-last-message` when a pipeline needs the final message in a file, and `--output-schema` when downstream automation needs structured final JSON validated against a schema (OpenAI, 2026i).

Permission defaults matter. OpenAI says `codex exec` defaults to a read-only sandbox; use `--sandbox workspace-write` for edits and `--sandbox danger-full-access` only in controlled environments such as isolated CI runners or containers (OpenAI, 2026i). The CLI reference defines `--dangerously-bypass-approvals-and-sandbox` / `--yolo` as running every command without approvals or sandboxing and says to use it only inside an externally hardened environment (OpenAI, 2026j). `--skip-git-repo-check` allows running outside a Git repository; OpenAI explains Codex requires a Git repo by default to prevent destructive changes and should be overridden only when the environment is known safe (OpenAI, 2026i, 2026j). `--cd` / `-C` sets the workspace root before task execution; `--add-dir` grants additional writable directories alongside the main workspace; `-c key=value` overrides config for that invocation (OpenAI, 2026j).

Modern Codex permissions can be configured either through built-in permission profiles or older sandbox settings. Built-ins are `:read-only`, `:workspace`, and `:danger-full-access`; profiles can grant read/write/deny filesystem access and network allowlists, including domain rules and local/private-network controls (OpenAI, 2026k). Profiles govern local sandboxed command execution; connectors, MCP servers, browser/computer-use surfaces, cloud environment settings, and approved escalations have separate controls (OpenAI, 2026k). Platform enforcement differs: macOS uses Seatbelt; Linux/WSL use bubblewrap/seccomp with Landlock fallback paths; native Windows uses elevated sandboxing as strongest and unelevated sandboxing as weaker fallback (OpenAI, 2026k). Operationally, choose the narrowest profile that completes the task, keep approvals aligned with access, and treat writes to scripts/build hooks/package hooks/shell startup/shared dirs as sensitive (OpenAI, 2026k).

`--dangerously-bypass-approvals-and-sandbox` is a throughput lever, not a safety model. It is appropriate only when another layer already provides isolation: disposable VM/container, clean checkout, no ambient secrets, no user-owned unrelated changes, network controls, and deterministic cleanup. It is especially risky in a real developer home directory because the model can execute arbitrary shell commands with the user's OS permissions. In routing terms, use it for controlled subagent workers in scratch worktrees or CI containers, not for mixed-trust workspaces.

## Reasoning-effort ladder

API docs list `none`, `minimal`, `low`, `medium`, `high`, and `xhigh` as current effort values, while noting model-specific support: GPT-5.1 supports `none`, `low`, `medium`, and `high`; pre-GPT-5.1 models default to `medium` and do not support `none`; `gpt-5-pro` only supports `high`; `xhigh` is supported for all models after `gpt-5.1-codex-max` (OpenAI, 2026l). GPT-5.5 docs say it defaults to `medium` and should be tuned against representative examples rather than treated as a drop-in replacement for GPT-5.2 or GPT-5.4 (OpenAI, 2026d).

`none`: Best for fastest, cheapest, no-reasoning calls: classification, routing labels, short deterministic transforms, lightweight voice turns, simple retrieval where no chained tool calls are needed. Anti-example: ambiguous repository debugging, security review, source reconciliation, or any task requiring multi-step tool use. Risk: under-planning and premature completion; mitigate with rigid schemas and external validation.

`minimal`: Fast reasoning-model behavior for latency-sensitive users; OpenAI introduced it in GPT-5 as the fastest option that still has reasoning-model benefits, but says minimal performance depends more strongly on prompt quality and needs explicit planning/persistence/tool instructions (OpenAI, 2026g). Best for short code edits, simple CLI extraction, one-file boilerplate, shallow tests, and field normalization where some reasoning helps but latency matters. Anti-example: broad refactors or high-stakes decisions.

`low`: Best Codex fast lane for bounded but nontrivial work: inspect 2-5 files, write a small script, make a surgical edit, run tests, summarize logs, extract structured facts from local artifacts, or generate boilerplate with constraints. OpenAI says `low` works well when small extra thinking gives meaningful accuracy gains, especially with complex instructions (OpenAI, 2026g). It is usually better than `none` for tool use/search/planning because it reduces missed dependencies.

`medium`: Default for most GPT-5.5 Codex work. Best balance for normal implementation, bug fixing, test repair, deterministic extraction with verification, medium-size research synthesis, and multi-command loops. OpenAI recommends `medium` as GPT-5.5's balanced starting point for quality, reliability, latency, and cost (OpenAI, 2026d). For Codex-style models, OpenAI separately describes `medium` as a good all-around interactive coding setting balancing intelligence and speed (OpenAI, 2026g).

`high`: Use when correctness depends on deeper reasoning: ambiguous failures, cross-file invariants, regression hunting, concurrency bugs, data migrations, API-surface changes, threat-model review, or long-context source synthesis. Cost/latency rise because reasoning tokens are billed as output tokens and occupy context (OpenAI, 2026f). Require explicit success criteria and test/evidence gates; otherwise high effort can spend more time on unhelpful paths.

`xhigh`: Use rarely. Best for hard asynchronous agents, long-horizon codebase transformations, research/eval runs, adversarial contradiction checks, or tasks where a single error is expensive and latency/cost are secondary. OpenAI says `xhigh` is best suited for long, agentic, reasoning-heavy tasks where maximum intelligence matters more than speed/cost and should be avoided as default unless evals prove benefit (OpenAI, 2026g). For GPT-5.5 launch evaluations, OpenAI notes GPT evals were run at `xhigh` in a research environment, which can differ from production ChatGPT output (OpenAI, 2026a).

## Strengths with concrete examples

Closed-loop filesystem/script work: GPT-5.5 + Codex is strongest when it can inspect the repo, run `rg`, edit a small set of files, run tests, observe failures, and iterate. Example: "Fix this failing pytest by reading the implementation and tests, make the smallest change, run the targeted test, then report the diff." This works because Codex can combine local shell, file edits, and verification in one loop. Anti-example: "Rewrite the auth system" without constraints; route to architecture planning/review first.

Fast retrieval: Use GPT-5.5 for local retrieval over code, logs, generated artifacts, and docs when the answer should cite file paths or command output. Example: "Find every place this feature flag is read, classify each as gating UI/API/background behavior, and cite file:line." It is faster and more reliable when the search space is explicit and code can answer. Anti-example: vague web research without source rules; add citation gates or use a research-specific workflow.

Deterministic extraction/proofs: Good at turning files into structured outputs with evidence. Example: parse a CI log, extract failing tests, commands, stack roots, and likely owner files; or prove that a JSON schema field is never read by tracing all references. Use `--json` or `--output-schema` for machine-readable results. Anti-example: asking for "all security problems" without a threat model; likely to overclaim or miss classes.

Concise terminal execution: Strong for one-shot commands and summarized results: line counts, dependency graphs, migration inventories, generated release notes from `git log`, or table creation from piped input. `codex exec` is designed for this pipeline shape and prints final output cleanly unless `--json` is enabled (OpenAI, 2026i). Anti-example: letting it run broad destructive commands in a real workspace; enforce sandbox and approvals.

Rapid functional boilerplate: Strong for conventional scaffolds, CLI wrappers, tests, adapters, data transforms, config samples, and small UI components when framework conventions are already visible. Example: "Add a `--dry-run` option following existing CLI parser style, update tests, and run the targeted suite." Anti-example: security-sensitive auth/crypto/session code without independent review.

## Risks and mitigations

Confident hallucination: GPT-5.5 can state plausible API behavior, file relationships, or source conclusions without sufficient evidence, especially when asked to be exhaustive under time pressure. Mitigations: require citations to original docs or file:line; make code answer deterministic questions; use structured source-locator fields; run `rg`/tests instead of memory; mark inference explicitly; run a contradiction-checker before commit; ask a separate reviewer to validate claims against sources.

Security bugs: GPT-5.5 may produce working code that weakens validation, broadens permissions, mishandles secrets, creates command injection, trusts user input, or normalizes unsafe sandbox bypass. Mitigations: least-permission sandbox; deny `.env` and credential paths; never expose API keys to commands running repo-controlled code; use Codex auto-review or human review for sandbox-boundary requests; run SAST/unit/security tests; require a Claude/security reviewer for auth, crypto, deserialization, filesystem, shell, network, CI/CD, or permission changes. OpenAI's non-interactive docs specifically warn not to set `OPENAI_API_KEY` or `CODEX_API_KEY` as job-level env vars in workflows that run repo-controlled code because scripts/tests/hooks/actions can read them (OpenAI, 2026i).

Over-effort regressions: Higher reasoning can over-search, overfit contradictions, or make unnecessary changes if the stopping criteria are weak. Mitigations: define "done when"; cap touched files; prefer medium; increase one notch only after prompt/schema/test fixes; use evals; split separable tasks into turns, which OpenAI says improves peak performance for complex tasks (OpenAI, 2026g).

Sandbox bypass misuse: `--dangerously-bypass-approvals-and-sandbox` removes the main local guardrail. Mitigations: use only in externally hardened runners; use clean disposable worktrees; remove ambient credentials; restrict network; log commands; never combine with broad, ambiguous prompts; prefer `workspace-write` plus narrow allowlists for normal work.

Context and pricing surprises: Reasoning tokens are not visible as normal content but occupy context and are billed as output tokens (OpenAI, 2026f). Mitigations: keep prompts static-first for caching; summarize large logs before model handoff; use `low`/`medium` by default; use Fast mode only when wall-clock speed is worth 2.5x GPT-5.5 Codex credits (OpenAI, 2026a, 2026m).

## Routing matrix

Use `gpt-5.5/low`: one-file edits, targeted tests, log triage, local fact extraction, boilerplate, small scripts, "find and list" tasks, deterministic transforms, subagents where latency matters. Use `gpt-5.5/medium`: default coding agent, multi-file but scoped changes, routine debugging, PR summaries, evidence-backed research, doc generation from local sources, tool-heavy but bounded work. Use `gpt-5.5/high`: ambiguous bugs, cross-module behavior, migrations, flaky tests, concurrency/state bugs, threat-model-sensitive implementation, long-context synthesis. Use `gpt-5.5/xhigh`: hardest asynchronous agents, maximum-quality contradiction review, large refactor execution after architecture is approved, evals, research requiring deep multi-pass synthesis. Use `gpt-5.4-mini` instead: cheap/fast subagent, literal extraction, simple coding where missing ambiguity is acceptable (OpenAI, 2026e). Use Claude/other reviewer instead of sole GPT-5.5: architecture choice, product strategy, final security signoff, prompt/policy contradiction analysis, human-sensitive communications, or any task where broad judgment matters more than local execution.

## Examples and anti-examples

Good: `codex exec -C repo -m gpt-5.5 -c 'model_reasoning_effort="low"' --sandbox workspace-write "Find the failing parser test, make the smallest fix, run that test, and summarize file changes."` Rationale: bounded, verifiable, low-latency.

Good: `codex exec --json -m gpt-5.5 -c 'model_reasoning_effort="medium"' "Read this repo and emit JSON listing risky untested modules with file locators." | jq` Rationale: structured automation gets JSONL events and usage metadata.

Good: `codex exec -m gpt-5.5 -c 'model_reasoning_effort="high"' --sandbox workspace-write "Debug this intermittent CI failure using the attached logs; cite evidence; change only the minimum files; run targeted checks."` Rationale: ambiguous failure justifies deeper reasoning, but scope is constrained.

Good only in hardened automation: `codex exec -m gpt-5.5 -c 'model_reasoning_effort="xhigh"' --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --json "In this disposable container with no secrets, complete the benchmark task and emit schema-valid JSON."` Rationale: bypass is acceptable only because external isolation is doing the safety work.

Anti-example: "Use `--dangerously-bypass-approvals-and-sandbox` in my home repo and fix whatever you find." Problems: broad authority, real filesystem, no bounded success criteria, destructive risk. Safer alternative: `workspace-write`, clean branch/worktree, explicit files, tests, and review.

Anti-example: `xhigh` for a 20-line extraction. Problems: cost/latency waste and possible overthinking. Safer alternative: `none`, `minimal`, or `low` with schema.

Anti-example: Sole GPT-5.5 implementation of auth/session/crypto followed by direct commit. Problems: security-bug risk. Safer alternative: GPT-5.5 writes tests and patch, independent reviewer checks threat model and diff, then run security tests before commit.

## Glossary

Codex CLI: OpenAI's local terminal coding agent. `codex exec`: non-interactive Codex mode for automation. Sandbox: local restrictions for model-generated commands, commonly read-only, workspace-write, or danger-full-access. Permission profile: newer reusable Codex config combining filesystem and network rules. Approval policy: when Codex pauses for human or reviewer approval before a command/action. `--json`: JSONL event stream from `codex exec`. `--output-schema`: schema-constrained final response. Fast mode: Codex speed tier for supported ChatGPT-auth models, faster token generation for higher credit burn. Reasoning tokens: internal reasoning budget that can improve quality but consumes context and is billed as output. `xhigh`: maximum reasoning effort for hard long-horizon tasks, not a default. Contradiction-checker: independent review pass looking for conflicts with specs, prompts, code, or evidence before write/commit.

## References

OpenAI. (2026a, April 23). *Introducing GPT-5.5*. https://openai.com/index/introducing-gpt-5-5/

OpenAI. (2026b). *Codex rate card*. https://help.openai.com/en/articles/20001106

OpenAI. (2026c). *GPT-5.5 in ChatGPT*. https://help.openai.com/en/articles/11909943-gpt-52-in-chatgpt

OpenAI. (2026d). *Using GPT-5.5*. https://developers.openai.com/api/docs/guides/latest-model

OpenAI. (2026e). *Models - Codex*. https://developers.openai.com/codex/models

OpenAI. (2026f). *Pricing*. https://developers.openai.com/api/docs/pricing

OpenAI. (2026g). *Prompt guidance*. https://developers.openai.com/api/docs/guides/prompt-guidance

OpenAI. (2026h). *Codex CLI*. https://developers.openai.com/codex/cli

OpenAI. (2026i). *Non-interactive mode - Codex*. https://developers.openai.com/codex/noninteractive

OpenAI. (2026j). *Command line options - Codex CLI*. https://developers.openai.com/codex/cli/reference

OpenAI. (2026k). *Permissions - Codex*. https://developers.openai.com/codex/permissions

OpenAI. (2026l). *Create a model response - Responses API reference*. https://developers.openai.com/api/reference/resources/responses/methods/create

OpenAI. (2026m). *Speed - Codex*. https://developers.openai.com/codex/speed

