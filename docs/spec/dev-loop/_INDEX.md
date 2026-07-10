# Development Loop Spec Index

This directory contains development-only orchestration guidance for repository
agents. It is not product behavior.

## Leaves

- `git-collaboration.md`: normative Git/GitHub branch, worktree, commit, PR,
  review, merge, Actions, and multi-agent collaboration policy.
- `claude-routines-cicd.md`: canonical Claude Code Routines CI/CD mapping and
  GitHub Actions dispatch bridge contract.
- `claude-routine-prompt.md`: exact copy/paste Instructions field text for the
  canonical Claude Routine CI/CD gate.
- `dependabot-ci-guard.md`: Dependabot dependency-update PR CI/branch-guard and
  auto-merge gate procedure.
- `contradiction-checker.md`: pre-commit contradiction-checker sub-agent
  contract : dispatch rules, contradiction classes (spec conflicts, stale
  build-participating docs, unstaged build-affecting files), JSON return shape.
- `../safety-scope.md`: read for long human prompts, debug/architecture
  requests, ambiguity, consent, credentials, external side effects, sub-agent
  prompts, and automated session declarations.
- `../prompt-review/eight-perspective-review.md`: prompt/directive/SOP review
  gate used when durable instructions are created or updated.
