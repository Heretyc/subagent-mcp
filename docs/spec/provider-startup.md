# Provider Startup Strings

**Claude (non-ultracode):** Claude Agent SDK `query({ prompt: AsyncIterable, options })`; options include local Claude executable path, `cwd`, model, supported effort, bypass permission mode, default tools, and max turns. `buildCommand` does not emit `--permission-mode`, `--tools`, or `--max-turns`; those settings are owned by the SDK driver.

**Claude (ultracode):** Same logical SDK session, with `settings: <tmpdir/subagent-uc-<uuid>.json>` instead of an effort option. Settings file: `{"ultracode":true}`. Deleted on close.

**Codex:** `codex app-server --stdio`, followed by `initialize`, `thread/start`, and `turn/start` JSONL protocol messages.
