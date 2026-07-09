# graphify-local — Patch Notes

Upstream: https://github.com/safishamsi/graphify (branch v5)
Vendor location: tools/vendor/graphify-local/
Reason: Keyless local-harness extraction for Unity-Claude-Scaffold — no API key required.

---

## Changes from upstream

### 0. Audit hardening - direct HTTP API/keyed backends disabled

**What changed:**

Removed the vendored `claude` and `kimi` entries from `graphify/llm.py`
`BACKENDS`, disabled direct-call helper bodies with a premise error, and removed
API-key environment auto-selection from `detect_backend()` and semantic doc-link
resolution. CLI extraction now defaults to `--backend local`.

**Why:** subagent-mcp's graphify integration must use only the keyless local
harness backend: no direct HTTP API calls and no API keys, ever.

### 1. `graphify/llm.py` — `BACKENDS["local"]` + `_call_local_cli`

**What changed:**

Added a new `"local"` entry to the `BACKENDS` dict:
```python
BACKENDS["local"] = {
    "base_url": None,
    "default_model": None,
    "pricing": {"input": 0.0, "output": 0.0},
}
```

Added `_call_local_cli(user_message, provider=None, cwd=None) -> str` which spawns
the local harness CLI (no API key):

- **Claude path:** `claude -p --model <model> --permission-mode bypassPermissions
  --output-format stream-json --verbose --max-turns 1`; prompt sent via stdin;
  stream-json JSONL parsed — prefers `type=result` event, falls back to assembling
  `type=assistant` content blocks.

- **Codex path:** `codex exec -C <cwd> -m <model> -c 'model_reasoning_effort="low"'
  --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --json "<prompt>"`;
  prompt as final argv; JSONL parsed until `turn.completed` event.

Both paths add `SUBAGENT_MCP_SUBAGENT=1` to the child environment.

**Why:** Upstream backends require cloud API keys. This fork adds a keyless path
that reuses the already-authenticated Claude Code CLI or Codex CLI present on the
user's machine (modelled on subagent-mcp v2.6.2).

**Provider selection:** Per-scan, never baked in. Supply via:
- `GRAPHIFY_LOCAL_PROVIDER=claude|codex` env var, OR
- `provider=` argument to `extract_files_direct` / `_call_local_cli`

**Model selection:** Defaults to `claude-haiku-4-5` (Claude) or `gpt-5.5` (Codex).
Override per-run with `GRAPHIFY_LOCAL_MODEL=<id>`.

Modified `extract_files_direct` signature to accept an optional `provider` kwarg
and to short-circuit the API-key check when `backend == "local"`, routing instead
to `_call_local_cli`. Token counts are hard-set to 0 (no billing metering needed).

### 2. `graphify/__main__.py` — `extract` CLI subcommand

**What changed:**

Added `graphify extract` subcommand so `--backend local` can be invoked from the
command line (and from the choreography Python pipeline):

```
graphify extract --backend local --provider claude file1.py file2.py
graphify extract --backend local --provider codex --out out.json src/
```

Flags: `--backend`, `--provider`, `--root`, `--api-key`, `--model`, `--out`.

**Why:** Upstream `__main__.py` had no CLI path for `extract_files_direct` / the
`--backend` flag (the `UNVERIFIED` item from PART E of the scaffold plan). This
addition completes the wiring so the local backend is reachable both via Python
import and via CLI.

---

## What was NOT changed

The keyless local backend and installable entrypoint remain available. Upstream
direct HTTP API/keyed backend behavior is intentionally not preserved in this
vendored copy.

---

## Install

```
uv pip install -e tools/vendor/graphify-local
# or
pip install -e tools/vendor/graphify-local
```

The installed entrypoint is `graphify` (defined in pyproject.toml `[project.scripts]`).
