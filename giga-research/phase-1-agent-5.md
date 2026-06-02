# Phase 1 Agent 5: Operational Concerns for a Mixed Claude + Codex Agent Fleet

Date: 2026-05-29. Scope: cost, latency, quota, failure modes, governance, and cost-aware routing for a mixed Claude + Codex sub-agent fleet. Internal seed baseline: GPT-5.5 is preferred for closed-loop filesystem/script work, fast retrieval, deterministic extraction/proofs, concise terminal execution, and boilerplate; Opus for planning/architecture/synthesis/nuance; Haiku for fast coding/file operations; Sonnet for balanced debug/review/reasoning; Codex risks are confident hallucination and security bugs; Opus risks are caution/stall and verbosity; other-provider capacity adds five separable sub-agent slots and should be split by domain with no duplicated tasks (Blackburn, 2026).

## Highest-Impact Operating Rules
1. Treat model choice as an expected-value decision: cheap/fast agents handle separable, verifiable, low-ambiguity work; expensive/high-effort agents handle tasks where one missed contradiction, unsafe write, or wrong architecture decision costs more than the extra tokens.
2. Prefer smaller/cheaper models until the task needs hard synthesis, long-horizon state, ambiguous tradeoff evaluation, or security-critical judgment. OpenAI explicitly frames GPT-5.4 mini/nano as lower-latency/lower-cost alternatives and GPT-5.5 as the complex reasoning/coding default; Anthropic frames Haiku 4.5 as fastest, Sonnet 4.6 as best speed/intelligence balance, and Opus as most capable for complex reasoning/[agentic mention removed] (OpenAI, 2026a; Anthropic, 2026a).
3. Reasoning/effort is a tuning knob, not a rescue lever. Higher effort increases hidden/visible output-token exposure, latency, and stall risk. Use high/xhigh only when evals or task shape show measurable gain: multi-step tool use, architecture, complex debugging, adversarial review, proof/extraction with high error cost (OpenAI, 2026b; Anthropic, 2026b).
4. Context is rented, not owned. Every retained token competes with task evidence and increases cost, latency, and truncation risk. Summarize-and-restart when the context contains resolved exploration, duplicate logs, stale plans, or tool output that can be replaced by file-backed locators.
5. Quota failures are capacity-routing signals, not just retry events. On 429/turn-limit/truncation, split work into smaller independent calls, lower model/effort where safe, use batch/flex for asynchronous work, and reserve premium slots for synthesis or gating.
6. No model output commits itself. Multi-provider fleets need a trust boundary: agents may propose writes; orchestrator or a separate checker audits scope, evidence, policy, and contradictions before source-code commits or external side effects.
7. Never route secrets, credentials, unpublished owner data, or regulated data to a provider, tool, or cache mode unless that disclosure is explicitly within the approved data boundary. API keys should be unique, non-shared, not committed, and stored in a KMS/secret manager; Anthropic and OpenAI both warn that exposed keys can incur unauthorized charges (OpenAI, 2026c; Anthropic, 2026c).
8. Most fleet failures are silent quality failures: confident hallucination, skipped files, overly broad writes, verbose non-answers, and turn-limit truncation. Detection must be built into prompts and tooling: file locators, line references, status JSON, explicit skipped-work fields, diff checks, token/usage logging, and independent contradiction review.

## Current Vendor Cost and Capacity Facts
1. OpenAI GPT-5.5 standard pricing is $5.00/input MTok, $0.50/cached input MTok, and $30.00/output MTok for short context; long context is $10.00/input, $1.00/cached input, and $45.00/output. GPT-5.5-pro is $30.00/input and $180.00/output short context, or $60.00/input and $270.00/output long context. Batch/flex halves GPT-5.5 short-context prices to $2.50/input, $0.25/cached input, and $15.00/output; priority raises GPT-5.5 to $12.50/input, $1.25/cached input, and $75.00/output. Regional processing adds a 10% uplift for eligible GPT-5.5 endpoints (OpenAI, 2026d).
2. GPT-5.5 has a 1,050,000-token context window, 128,000 max output tokens, supports reasoning efforts none/low/medium/high/xhigh, defaults to medium, and charges prompts above 272K input tokens at 2x input and 1.5x output for the full session across standard/batch/flex (OpenAI, 2026a; OpenAI, 2026d).
3. OpenAI rate limits are per organization/project and vary by model; limits may include RPM, RPD, TPM, TPD, IPM, and batch queue tokens. Batch uses a separate pool and is recommended when immediate responses are not required (OpenAI, 2026e; OpenAI, 2026f).
4. OpenAI prompt caching is automatic for recent models and can reduce latency by up to 80% and input-token cost by up to 90% when repeated prompt prefixes match; static instructions/examples should be at the beginning and dynamic content near the end (OpenAI, 2026g).
5. OpenAI flex processing trades slower responses and occasional resource unavailability for Batch API token rates plus caching discounts; fit: non-production, evals, data enrichment, and async workloads (OpenAI, 2026h).
6. Anthropic current model economics: Opus 4.8/4.7/4.6/4.5 cost $5/input MTok, $25/output MTok, $6.25 5-minute cache write, $10 1-hour cache write, and $0.50 cache hit/refresh. Sonnet 4.6/4.5 cost $3/input, $15/output, $3.75 5-minute cache write, $6 1-hour cache write, and $0.30 cache hit. Haiku 4.5 costs $1/input, $5/output, $1.25 5-minute cache write, $2 1-hour cache write, and $0.10 cache hit (Anthropic, 2026d).
7. Anthropic batch halves token prices: Opus 4.8/4.7/4.6/4.5 at $2.50/input and $12.50/output, Sonnet 4.6/4.5 at $1.50/input and $7.50/output, Haiku 4.5 at $0.50/input and $2.50/output (Anthropic, 2026d).
8. Anthropic fast mode is preview and premium: Opus 4.6/4.7 fast mode costs $30/input MTok and $150/output MTok; Opus 4.8 fast mode costs $10/input and $50/output. It has dedicated rate limits and headers and should be reserved for latency-critical Opus-grade work (Anthropic, 2026d; Anthropic, 2026e).
9. Claude Opus 4.8 and Sonnet 4.6 have 1M-token context windows; Haiku 4.5 has 200K. Opus 4.8 max output is 128K; Sonnet 4.6 and Haiku 4.5 max output are 64K. Comparative latency is moderate for Opus, fast for Sonnet, fastest for Haiku (Anthropic, 2026a).
10. Claude Opus 4.6, later Opus, and Sonnet 4.6 include 1M context at standard pricing; US-only inference for Opus 4.6/Sonnet 4.6 and later applies a 1.1x multiplier. Tool use adds tokens for tool schemas, tool blocks, tool results, and model-specific tool [agentic mention removed]s (Anthropic, 2026d).
11. Anthropic rate limits are measured in RPM, input tokens/minute, and output tokens/minute by model class. Exceeding limits returns 429 plus `retry-after`; response headers expose limit, remaining quota, and reset time. Fast mode has separate limits for Opus 4.8/4.7/4.6 (Anthropic, 2026e).
12. Anthropic API request-size limits: standard Messages and Token Counting endpoints are 32 MB; Batch API is 256 MB; Files API is 500 MB; exceeding standard size returns 413 `request_too_large` (Anthropic, 2026f).

## Effort-Setting Economics
1. GPT-5.5 `none`: use for latency-critical retrieval, deterministic extraction after evidence is already gathered, schema transformation, title/label generation, simple classification, and non-tool single-step responses. Do not use when planning, multi-call tool sequencing, or ambiguous conflict resolution matters.
2. GPT-5.5 `low`: default for cheap agentic execution: read/search/summarize files, produce small patches, run tests, extract citations, prepare handoff JSON. It retains enough reasoning for tool use while avoiding medium/high overthinking.
3. GPT-5.5 `medium`: default balanced setting per OpenAI for GPT-5.5. Use for nontrivial coding, research synthesis with citations, multi-file but bounded changes, and tasks where skipped constraints are likely but latency still matters (OpenAI, 2026b).
4. GPT-5.5 `high`: use for high-stakes code review, security-sensitive diffs, difficult bug localization, migration planning, policy interpretation, or when prior low/medium attempts disagree. Require explicit success criteria and stopping rules to prevent unnecessary searching.
5. GPT-5.5 `xhigh`: reserve for hardest asynchronous tasks, adversarial contradiction checking, deep root-cause analysis, or architecture decisions with high blast radius. If no independent verification or eval exists, xhigh can waste budget by producing a more elaborate wrong answer.
6. GPT-5.5-pro: use only when GPT-5.5 high/xhigh still lacks precision or when several failed attempts show the problem is model-capability-limited. It may take several minutes; use background/async handling to avoid timeouts (OpenAI, 2026i).
7. Claude standard/no thinking: use Haiku/Sonnet for direct file ops, simple coding, straightforward review, and bounded summaries. Prefer Haiku for high-volume simple work and Sonnet when a little more reasoning reduces rework.
8. Claude adaptive thinking / effort: Opus 4.6 and Sonnet 4.6 support adaptive thinking controlled by effort; higher effort elicits more thinking, and complex prompts also elicit more thinking. Use low/medium for routine reasoning; high/max/xhigh only for synthesis, planning, nuanced policy, or high-ambiguity review (Anthropic, 2026b).
9. Claude extended thinking budgets: older supported models require minimum 1,024 thinking tokens; Anthropic recommends starting at the minimum and increasing incrementally. Above 32K thinking tokens, use batch processing to avoid networking/system-timeout issues; thinking tokens are billed as output and visible summaries may not equal billed thinking (Anthropic, 2026g).
10. Effort pays off when it prevents repeated calls, bad writes, missed constraints, or manual audit. Effort wastes budget when the task is bounded and machine-verifiable, when evidence is missing, when prompt constraints conflict, or when no one will inspect the extra rationale.

## Token Budget and Context-Window Economics
1. Cost formula: total cost = input tokens * input rate + cached-input tokens * cached rate + visible output tokens * output rate + hidden reasoning/thinking tokens * output rate + tool-call/tool-storage charges + region/priority/fast-mode multipliers.
2. Latency formula, operationally: base model latency + prompt ingestion time + reasoning/thinking time + tool round trips + output generation time + retry/backoff. Reducing tokens and requests usually reduces both cost and latency (OpenAI, 2026j).
3. Output tokens are usually more expensive than input tokens: GPT-5.5 standard output is 6x input; Claude Opus/Sonnet/Haiku output is 5x input. Therefore verbosity controls and strict output contracts are direct budget controls.
4. Hidden reasoning is not free. OpenAI says reasoning tokens occupy context and are billed as output; Anthropic says thinking consumes output-token budget/pricing. Treat high effort as buying extra output tokens whether or not they are shown (OpenAI, 2026k; Anthropic, 2026g).
5. Long context is a last resort. GPT-5.5 crosses a price cliff above 272K input tokens; Claude Opus 4.6+ and Sonnet 4.6 avoid a long-context premium but still pay ingestion latency and quota cost.
6. Summarize-and-restart triggers: context >60-70% and active evidence is <50% of prompt; repeated tool logs dominate; the next phase changes from exploration to implementation; failures/retries obscure current state; output budget cannot fit a complete answer; or rate limits are being hit by oversized prompts.
7. Preserve locators, not transcripts: keep file paths, line numbers, URLs, command names, exact error codes, diff hunks, and acceptance criteria; drop raw logs once summarized unless they contain unique evidence.
8. Cache strategy: stable policy/[agentic mention removed] first, static examples next, tool schema stable where possible, dynamic task/evidence last. Avoid needless timestamp/current-date churn in cacheable prefixes unless the date materially changes behavior.
9. Split contexts by domain: security audit, cost model, failure-mode table, and routing rules can run in separate sub-agents. Do not duplicate the same corpus across agents unless redundancy is intentionally used for verification.
10. Meter every agent: capture model, effort, input/output/cached/reasoning tokens, wall time, retries, failure class, and whether final output passed validation. Without telemetry, routing will drift toward intuition and premium-model overuse.

## Sub-Agent Capacity and Turn-Limit Handling
1. Use extra other-provider slots only for separable work: e.g., OpenAI extracts pricing facts, Claude synthesizes governance risks, Haiku patches files, Sonnet reviews diffs, Opus resolves architectural contradictions.
2. Do not assign duplicate tasks to multiple agents unless explicitly doing adversarial verification. Duplicate execution burns quota and produces false confidence if both agents share the same missing evidence.
3. Split by artifact ownership: one agent per file/module/table/decision domain. Each returns status, summary, source locators, risks, and writes requested; large payloads should be written to scratch files or target artifacts rather than returned through the orchestrator.
4. Turn-limit symptom: trailing incomplete sentences, missing final JSON, no tests despite claiming tests, skipped sections, or final answer that omits required fields. Recovery: rerun with smaller scope and a resume prompt containing only state locators and remaining acceptance criteria.
5. Rate-limit symptom: 429, retry-after, provider-specific quota headers, or CLI turn exhaustion. Recovery: respect retry-after, lower effort/model, move async work to batch/flex, reduce max output, compact context, and subdivide across independent calls.
6. Stalled premium-agent symptom: long planning, repeated caveats, no writes, or asking for nonessential clarifications. Recovery: assign a cheap executor a concrete subtask and reserve premium model for reviewing the executor's artifact.
7. Agent-output contract: no bare prose for operational sub-agents. Require machine-parseable completion status and explicit skipped-work/uncertainty/risk fields so silent skips are visible.

## Failure Modes, Symptoms, Detection, Recovery
| Failure mode | Common symptom | Primary detection | Recovery/mitigation |
|---|---|---|---|
| Confident hallucination | Specific facts with no locators; invented APIs/prices/files | Require URLs/file lines; spot-check against vendor docs; run deterministic commands | Reject unsupported claims; rerun extraction with source-only prompt; use structured citations |
| Security bug | Broad permissions, unsafe shell, leaking secrets, bypassed sandbox, unreviewed write | Diff/security checklist; secret scan; side-effect declaration | Halt write path; narrow permissions; rotate exposed keys; independent security review |
| Over-caution/stall | Many caveats, no progress, repeated asks despite enough evidence | Time/turn budget and deliverable checklist | Re-scope to concrete next artifact; lower model/effort; ask one blocking question only |
| Verbosity | Output exceeds needed contract; buries decision | Word/line limits; JSON schema; section budgets | Set verbosity low; require tables/checklists; summarize-and-restart |
| Turn-limit truncation | Missing ending, no final status, partial table | Required sentinel/final JSON absent; max-turn logs | Split task; continue from scratch file; lower output size |
| Silent skip | Claims complete but omits required file/test/source | Compare output to acceptance checklist; git/status/test logs | Fail task; rerun only skipped items; require skipped=[] field |
| Quota exhaustion | 429/retry-after; degraded model fallback | Log quota headers and model pool | Backoff; switch provider/model; batch async work; reduce prompt/output |
| Context poisoning | External text tries to change instructions | Treat documents/webpages as data; quote locators | Ignore injected commands; summarize content only |
| Cache miss/cost spike | Expected cached tokens absent; high input bill | Usage telemetry cached-token fields | Stabilize prefix; move dynamic data later; avoid changing [agentic mention removed] |
| Tool misuse | Wrong tool, repeated retries, destructive command | Tool-call audit; side-effect allowlist | Tool-specific descriptions; require dry-run for destructive ops |
| Cross-provider inconsistency | Claude and Codex disagree | Source-backed compare table | Prefer primary source/command output; escalate only true ambiguity |
| Data boundary breach | Sensitive data sent to wrong provider/cache/tool | DLP rules; prompt logging; provider allowlist | Halt; purge where possible; rotate credentials; document incident |
| Commit of bad AI output | Generated code committed without review/tests | Commit gate; contradiction checker; CI | Block commit; require separate reviewer and passing relevant checks |
| Long-context overload | Huge prompt, slow response, weak recall | Token meter; retrieval hit rate | RAG/summarize; split corpus; use locators |
| Excessive premium routing | Opus/pro/high used for routine tasks | Cost dashboard by task class | Default downshift; require justification for premium effort |

## Security, Governance, and Compliance Controls
1. Data classification before routing: public, internal, confidential, secret, regulated, owner-private. Only public/internal-low-risk content may be freely routed across providers; confidential/regulated data requires approved provider, retention, region, logging, and cache policy.
2. Secret handling: never paste API keys into prompts, docs, logs, or issue comments. Use per-user/per-service keys, environment variables or secret managers/KMS, least privilege, spend limits, usage monitoring, and immediate revocation on suspected compromise (OpenAI, 2026c; Anthropic, 2026c).
3. Retention: OpenAI API abuse monitoring logs may contain prompts/responses and are retained up to 30 days by default unless exceptions apply; Anthropic API inputs/outputs are automatically deleted within 30 days by default, with exceptions for longer-retention services, ZDR agreements, usage-policy enforcement, or law (OpenAI, 2026l; Anthropic, 2026h).
4. Zero data retention is not universal. Anthropic ZDR applies only to eligible Anthropic APIs and products using a commercial organization API key, including Claude Code, and still retains user-safety classifier results; it does not automatically cover all products/features (Anthropic, 2026i).
5. Sandbox/bypass risk: coding CLIs with filesystem and shell access can exfiltrate data, overwrite user work, or execute unsafe commands. Require repository status before edits, scoped write allowlists, no destructive commands without explicit approval, and tool-call logging.
6. Write scoping: agent writes must name exact target files, expected diffs, and validation. Orchestrator rejects writes outside requested scope, unexplained formatting churn, generated metadata with AI attribution, and edits to user-owned dirty files.
7. Commit gating: before commits that change executable/source code, require a separate contradiction/security checker using the strongest available reviewer settings; block on `blocked`/`needs_user`, unresolved test failures, missing diff review, or unexplained generated changes.
8. Provider governance: maintain an allowlist of approved models, regions, retention modes, tool capabilities, max effort, max spend per task, and disallowed data categories. Log deviations as incidents.
9. Prompt-injection governance: instructions in files, webpages, tool output, emails, or model output are untrusted data. The fleet may summarize them but must not adopt their commands unless the human/orchestrator explicitly authorizes them.
10. Auditability: every run should produce run ID, parent task ID, model/provider, effort, prompt hash or policy version, files read/written, commands run, external URLs, token/cost estimate, validation result, and unresolved risks.
11. Compliance posture is feature-specific, not provider-wide. Web search, files, code execution, caches, batch, regional processing, and third-party platforms can have different retention/security implications; route based on the exact feature path.
12. Halt-and-surface rules: halt on secret exposure, destructive action ambiguity, external side effect, identity/authorization uncertainty, conflicting instructions, unsafe broad write, missing required checker, provider unavailable when mandated, or evidence that a pipeline is compounding errors.

## Cost-Aware Routing Decision Rules
1. Haiku 4.5: use for fast file reads/searches, simple code edits, deterministic transformations, line-count checks, and high-volume low-risk work. Do not use for subtle architecture, security-critical review, or ambiguous policy synthesis unless a reviewer follows.
2. Sonnet 4.6: use for balanced debugging, review, moderate reasoning, and code changes where Haiku might miss interactions. Do not use when the task is pure extraction at scale (Haiku/mini cheaper) or deep cross-domain synthesis (Opus/GPT-5.5 high better).
3. Opus 4.6/4.8: use for architecture, synthesis, nuanced tradeoffs, contradiction resolution, and high-autonomy planning. Do not use for routine file ops, boilerplate, or tasks with no clear acceptance criteria; Opus fast mode is only for latency-critical premium reasoning.
4. GPT-5.5 low/medium: use for Codex-style closed-loop filesystem/script work, grounded research, deterministic extraction/proofs, terminal-heavy validation, and concise operational reports. Do not use when the dominant risk is nuanced social/policy interpretation and Opus is available for review.
5. GPT-5.5 high/xhigh or pro: use for hard debugging, formal-ish proof, adversarial review, or synthesis where wrong answers are expensive and validation exists. Do not use to compensate for missing evidence, unclear owner intent, or a task that should be split.
6. GPT-5.4 mini/nano or GPT-5 mini/nano equivalents: use for classification, summarization, data cleanup, and first-pass extraction. Do not use as final authority for security, governance, or architectural decisions.
7. Batch: use for noninteractive extraction, document sweeps, evals, bulk classification, and duplicate independent records; do not use for tasks needing immediate conversational correction or side-effect supervision.
8. Flex: use for async low-priority OpenAI work where occasional unavailability is acceptable; do not use for CI blockers, human-waiting interactive sessions, or deadlines.
9. Priority/fast mode: use when latency has business value greater than price multiplier: production incident, blocking human, high-value customer flow. Do not use for background research or routine agent chatter.
10. Human/orchestrator review: use when a model proposes irreversible/destructive/external effects, touches secrets, conflicts with policy, or reports uncertainty that affects downstream action. Do not let cross-provider agreement substitute for evidence.

## Practical Default Policy
1. Start with cheap executor plus explicit acceptance criteria. Escalate only failed/ambiguous/high-risk residue.
2. For code: Haiku or GPT-5.5 low/medium implements; Sonnet reviews routine diffs; Opus or GPT-5.5 high reviews architecture/security/contradictions; commit only after tests and checker pass.
3. For research: split extraction by source/provider; require APA citations to primary docs; synthesize with GPT-5.5 medium or Opus; verify volatile pricing/rate-limit facts against vendor docs on the day of use.
4. For governance: prefer fewer, stricter agent permissions; every added provider/slot expands data boundary and incident surface.
5. For stalled work: reduce scope, lower verbosity, write intermediate artifacts, and resume from locators. Do not keep feeding the same overloaded context to a premium model.

## References
Anthropic. (2026a). Models overview. https://platform.claude.com/docs/en/about-claude/models/overview
Anthropic. (2026b). Prompting best practices: Leverage thinking and interleaved thinking capabilities. https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#leverage-thinking-and-interleaved-thinking-capabilities
Anthropic. (2026c). API key best practices: Keeping your keys safe and secure. https://support.claude.com/en/articles/9767949-api-key-best-practices-keeping-your-keys-safe-and-secure
Anthropic. (2026d). Pricing. https://platform.claude.com/docs/en/about-claude/pricing
Anthropic. (2026e). Rate limits. https://platform.claude.com/docs/en/api/rate-limits
Anthropic. (2026f). API overview. https://platform.claude.com/docs/en/api/overview
Anthropic. (2026g). Extended thinking tips. https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips
Anthropic. (2026h). How long do you store my organization's data? https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
Anthropic. (2026i). I have a zero data retention agreement with Anthropic. What products does it apply to? https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to
Blackburn, L. (2026). Cross-provider sub-agent routing directive [Internal document].
OpenAI. (2026a). GPT-5.5 model. https://developers.openai.com/api/docs/models/gpt-5.5/
OpenAI. (2026b). Using GPT-5.5. https://developers.openai.com/api/docs/guides/latest-model
OpenAI. (2026c). Best practices for API key safety. https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety
OpenAI. (2026d). Pricing. https://developers.openai.com/api/docs/pricing
OpenAI. (2026e). Rate limits. https://developers.openai.com/api/docs/guides/rate-limits
OpenAI. (2026f). Batch API. https://developers.openai.com/api/docs/guides/batch
OpenAI. (2026g). Prompt caching. https://developers.openai.com/api/docs/guides/prompt-caching
OpenAI. (2026h). Flex processing. https://developers.openai.com/api/docs/guides/flex-processing
OpenAI. (2026i). GPT-5.5 pro model. https://developers.openai.com/api/docs/models/gpt-5.5-pro
OpenAI. (2026j). Cost optimization. https://developers.openai.com/api/docs/guides/cost-optimization
OpenAI. (2026k). Reasoning models. https://developers.openai.com/api/docs/guides/reasoning
OpenAI. (2026l). Data controls in the OpenAI platform. https://developers.openai.com/api/docs/guides/your-data
