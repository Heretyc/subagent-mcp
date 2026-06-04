# Phase 1 — Agent 1: Model Discovery + Specifications (Authoritative Universe)

**Run:** 2026-06-03 Full-mode re-profile · **Agent:** phase-1-agent-1 · **Status:** Complete
**Scope:** current-generation models, BOTH families (Claude + OpenAI/Codex), cross-family.
**Role:** produce the AUTHORITATIVE model+effort universe (the spine all later agents map onto).

> Provenance rule honored: every figure below is cited to an ORIGINAL vendor card / doc or an
> independent leaderboard/aggregator — never to an internal `.spec` file. Baselines
> (`.spec/references/model-profiles.md`, `cost-model.md`, prior flat `giga-research/phase-1-agent-1*`)
> were read to DIFF only; nothing inherited. Claims tagged [SEED]/[INFERRED]/[ASSUMPTION]/[UNVERIFIED];
> gaps marked explicitly. Taxonomy categories neither invented, renamed, nor reordered.

**This file is an index** (AGENTS.md ≤200-line rule). Detail lives in `phase-1-agent-1/`:

| § | Section | File |
|---|---------|------|
| 1 | Claude family — full per-model specs | [phase-1-agent-1/01-claude-family-specs.md](phase-1-agent-1/01-claude-family-specs.md) |
| 2 | OpenAI/Codex family — full per-model specs | [phase-1-agent-1/02-openai-family-specs.md](phase-1-agent-1/02-openai-family-specs.md) |
| 3 | **The model@effort universe** (the spine) | [phase-1-agent-1/03-model-effort-universe.md](phase-1-agent-1/03-model-effort-universe.md) |
| 4 | DIFF vs baseline + source ledger (retrieved 2026-06-03) | [phase-1-agent-1/04-diff-and-sources.md](phase-1-agent-1/04-diff-and-sources.md) |

## Headline universe count

**22 model@effort pairings across 7 in-scope models.**
- **Primary fleet (15):** `claude-opus-4-8`×5 · `claude-sonnet-4-6`×4 · `claude-haiku-4-5`×1 · `gpt-5.5`×5
- **Extended siblings (7):** `claude-opus-4-7`×5 · `gpt-5.5-pro`×1 [ladder gap] · `gpt-5.4-mini`×1 [ladder gap]
- **Legacy-available (not routed here):** `claude-opus-4-6`, `claude-opus-4-5`, `claude-sonnet-4-5`.
- **Exists but out-of-fleet:** Claude Mythos Preview (invite-only, defensive-cyber research preview);
  `gpt-5.4-nano` (sibling). See §3 for the routable spine definition.
