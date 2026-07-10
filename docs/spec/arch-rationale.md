# Architecture Rationale : Why subagent-mcp Is Built This Way

**Load this when:** you need the *why* behind the design : the core bets, the
delegate-only model, mixed providers, or the durable-hook discipline. This file
is THE single home for that rationale; other docs point here instead of
restating it.

**Do NOT load when:** you need mechanics (tool params → `docs/tools.md`;
lifecycle → `docs/reference/status-lifecycle.md`; routing → `docs/spec/auto-mode/`;
orchestration semantics → `docs/spec/dev-loop/orchestration-directive-architecture.md`).

---

## One-screen summary

subagent-mcp is an MCP stdio server that spawns and manages always-interactive
Claude Code and Codex sub-agent sessions. It makes three design bets. Everything
else in the codebase is machinery serving these three.

## Bet 1 : Geometric context extension via delegate-only orchestration

The orchestrator **monitors but never reads or writes anything itself**. Every
step is delegated to a sub-agent. The orchestrator's own context therefore fills
with *summaries of work*, not the work itself : so its effective context window
extends geometrically instead of linearly, enabling absurdly long-horizon tasks
with minimal (if ever) compaction.

Three mechanisms enforce this:
- **Read-escalation ladder** : the orchestrator reads only through (1) a
  `poll_agent` tail, (2) a single ≤100-line sub-agent summary, or (3) the user
  reading directly. Never a raw file read.
- **Scratch-file handoffs** : large inter-agent data goes to a temp-file path
  the orchestrator assigns; producer writes, consumer reads, orchestrator never
  touches the bytes.
- **No inline-by-right** : there is no "just this once" direct read/write. A
  step that cannot run in a sub-agent requires an explicit user exception.

## Bet 2 : Mixed-provider operating model

Running both Claude Code and Codex (and being provider-agnostic beyond them)
prevents **per-provider and per-model blind spots** and removes **vendor
dependency**. A weakness or outage in one provider does not blind or block the
whole system; auto-routing picks the right provider/model/effort per task from a
benchmark-derived table. No direct API calls, no API keys : it drives the
locally authenticated vendor CLIs.

## Bet 3 : Ruthless token efficiency + durable authoritative hooks

Long-horizon autonomy fails on drift and hallucination. Two disciplines counter
it:
- **Ruthless token efficiency** : compressed handoffs, tail-only reads, and
  summary-return contracts keep every context small.
- **Durable, authoritative hook injections** : the same operating model is
  delivered redundantly via MCP `instructions`, an INIT_BLOCK, per-turn hooks,
  and the managed blocks in `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`. The managed
  blocks make those injections *authoritative*, so the invariant survives across
  turns and cannot silently erode.

---

## Guardrails these bets rely on

- **Single machine-global, provider-agnostic concurrency cap** (default 20,
  minimum 10; no per-provider cap; reject at cap, never queue).
- **Worktree isolation** : branch-per-task, mutating work in sibling worktrees,
  with a first-line sub-agent exemption to prevent fork-bomb recursion.
- **Fail-safe ON** on hookless hosts : unknown orchestration state defaults to
  ON to prevent uncontrolled inline execution.
