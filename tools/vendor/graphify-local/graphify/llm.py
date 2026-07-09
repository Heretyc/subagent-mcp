# Keyless local-harness backend for semantic extraction.
# This vendored copy intentionally disables all direct HTTP API/keyed paths.
from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Callable
from pathlib import Path

BACKENDS: dict[str, dict] = {
    # Local harness backend — keyless. Routes through the already-authenticated
    # Claude Code CLI or Codex CLI on the user's machine. No API key is needed.
    # Provider (claude|codex) is chosen PER-SCAN via GRAPHIFY_LOCAL_PROVIDER env
    # var or the provider= arg on extract_files_direct / _call_local_cli.
    # Modelled on subagent-mcp v2.6.2 dispatch.
    "local": {
        "base_url": None,
        "default_model": None,
        "pricing": {"input": 0.0, "output": 0.0},
    },
}

_DIRECT_API_DISABLED = (
    "Direct HTTP API/keyed graphify backends are disabled in this vendored copy. "
    "subagent-mcp relies on the keyless 'local' backend only: no direct HTTP API "
    "calls and no API keys, ever."
)

_EXTRACTION_SYSTEM = """\
You are a graphify semantic extraction agent. Extract a knowledge graph fragment from the files provided.
Output ONLY valid JSON — no explanation, no markdown fences, no preamble.

Rules:
- EXTRACTED: relationship explicit in source (import, call, citation, reference)
- INFERRED: reasonable inference (shared data structure, implied dependency)
- AMBIGUOUS: uncertain — flag for review, do not omit

Node ID format: lowercase, only [a-z0-9_], no dots or slashes.
Format: {stem}_{entity} where stem = filename without extension, entity = symbol name (both normalised).

Output exactly this schema:
{"nodes":[{"id":"stem_entity","label":"Human Readable Name","file_type":"code|document|paper|image|concept","source_file":"relative/path","source_location":null,"source_url":null,"captured_at":null,"author":null,"contributor":null}],"edges":[{"source":"node_id","target":"node_id","relation":"calls|implements|references|cites|conceptually_related_to|shares_data_with|semantically_similar_to","confidence":"EXTRACTED|INFERRED|AMBIGUOUS","confidence_score":1.0,"source_file":"relative/path","source_location":null,"weight":1.0}],"hyperedges":[],"input_tokens":0,"output_tokens":0}
"""


def _read_files(paths: list[Path], root: Path) -> str:
    """Return file contents formatted for the extraction prompt."""
    parts: list[str] = []
    for p in paths:
        try:
            rel = p.relative_to(root)
        except ValueError:
            rel = p
        try:
            content = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        parts.append(f"=== {rel} ===\n{content[:20000]}")
    return "\n\n".join(parts)


def _parse_llm_json(raw: str) -> dict:
    """Strip optional markdown fences and parse JSON. Returns empty fragment on failure."""
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.rsplit("```", 1)[0]
    try:
        return json.loads(raw.strip())
    except json.JSONDecodeError as exc:
        print(f"[graphify] LLM returned invalid JSON, skipping chunk: {exc}", file=sys.stderr)
        return {"nodes": [], "edges": [], "hyperedges": []}


def _call_openai_compat(
    base_url: str,
    api_key: str,
    model: str,
    user_message: str,
    temperature: float | None = 0,
) -> dict:
    """Disabled: direct HTTP API/keyed extraction is not allowed here."""
    raise RuntimeError(_DIRECT_API_DISABLED)


def _call_claude(api_key: str, model: str, user_message: str) -> dict:
    """Disabled: direct HTTP API/keyed extraction is not allowed here."""
    raise RuntimeError(_DIRECT_API_DISABLED)


def _call_local_cli(
    user_message: str,
    provider: str | None = None,
    cwd: str | None = None,
) -> str:
    """Invoke the local harness CLI (claude or codex) for keyless graph extraction.

    The provider is chosen per-scan via the ``GRAPHIFY_LOCAL_PROVIDER`` env var or
    the ``provider`` argument — never baked in.  The caller (Python choreography
    layer) must supply one before triggering a scan.

    Modelled on subagent-mcp v2.6.2 local-harness dispatch:
    - Claude: ``claude -p --model <model> --permission-mode bypassPermissions
      --output-format stream-json --verbose --max-turns 1``; prompt via stdin.
    - Codex: ``codex exec -C <cwd> -m <model> -c 'model_reasoning_effort="low"'
      --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --json
      "<prompt>"``; prompt as final argv.
    Both add ``SUBAGENT_MCP_SUBAGENT=1`` to the child env.
    """
    import subprocess as _sp
    import shutil as _shutil

    def _win_safe(cmd_list: list[str]) -> list[str]:
        # The local harness CLIs (claude / codex) are npm shims: on Windows they
        # ship as .cmd / .ps1, NOT .exe. A bare Popen(["codex"/"claude", ...])
        # therefore fails with WinError 2 — CreateProcess will not resolve via
        # PATHEXT nor execute a .cmd/.bat directly. Resolve the real path via
        # shutil.which (PATHEXT-aware) and route .cmd/.bat through cmd.exe so the
        # shim actually runs. No-op on POSIX (the bare name resolves fine).
        exe = _shutil.which(cmd_list[0])
        if not exe:
            return cmd_list
        resolved = [exe, *cmd_list[1:]]
        if sys.platform == "win32" and exe.lower().endswith((".cmd", ".bat")):
            return ["cmd", "/c", *resolved]
        return resolved

    resolved_provider = (provider or os.environ.get("GRAPHIFY_LOCAL_PROVIDER", "")).lower().strip()
    if not resolved_provider:
        raise ValueError(
            "local backend requires a provider. "
            "Set GRAPHIFY_LOCAL_PROVIDER=claude|codex "
            "or pass provider= to extract_files_direct / _call_local_cli."
        )

    env = {**os.environ, "SUBAGENT_MCP_SUBAGENT": "1"}
    resolved_cwd = cwd or os.getcwd()

    # Combine extraction system prompt + file content into a single payload.
    # Prefix with the parent-process marker (sub-invocation convention) so the
    # harness CLI treats this as an automated request from a calling process.
    full_prompt = (
        "<this is a request from a parent process>\n"
        + _EXTRACTION_SYSTEM + "\n\n" + user_message
    )
    # Reasoning/effort level for the local harness CLI. Modest default suited to
    # per-file structured extraction; override via GRAPHIFY_LOCAL_EFFORT.
    effort = os.environ.get("GRAPHIFY_LOCAL_EFFORT", "medium").strip() or "medium"

    if resolved_provider == "claude":
        model = os.environ.get("GRAPHIFY_LOCAL_MODEL", "claude-haiku-4-5")
        # Template:
        #   claude -p --model <m> --effort <e> --permission-mode bypassPermissions
        #          --tools default --max-turns 50 --output-format json <prompt>
        # Prompt is delivered via stdin (claude -p reads stdin) rather than as a
        # positional arg — identical content, but Windows routes the npm .cmd shim
        # through cmd.exe, which corrupts a large code-bearing prompt passed as an
        # argument. Flag values are simple and pass cleanly.
        cmd = [
            "claude", "-p",
            "--model", model,
            "--effort", effort,
            "--permission-mode", "bypassPermissions",
            "--tools", "default",
            "--max-turns", "50",
            "--output-format", "json",
        ]
        proc = _sp.Popen(
            _win_safe(cmd),
            stdin=_sp.PIPE,
            stdout=_sp.PIPE,
            stderr=_sp.PIPE,
            env=env,
            cwd=resolved_cwd,
        )
        stdout_b, stderr_b = proc.communicate(input=full_prompt.encode("utf-8"))
        if proc.returncode != 0:
            err = stderr_b.decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"[graphify-local] claude exited {proc.returncode}: {err}")

        # --output-format json emits ONE JSON object; the agent's final text is in
        # the ``result`` field. Fall back to raw stdout if it is not valid JSON.
        raw = stdout_b.decode("utf-8", errors="replace").strip()
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict):
                return obj.get("result", "") or raw
            return raw
        except json.JSONDecodeError:
            return raw

    elif resolved_provider == "codex":
        import tempfile as _tf
        model = os.environ.get("GRAPHIFY_LOCAL_MODEL", "gpt-5.5")
        # Template:
        #   codex exec -C <wd> -m <m> -c 'model_reasoning_effort="<e>"'
        #        --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check
        #        --json <prompt>
        # Two adaptations for robustness on Windows (npm .cmd shim via cmd.exe):
        #  * prompt delivered via stdin ("-") instead of as a positional arg —
        #    cmd.exe corrupts a large code-bearing argument (this caused empty
        #    extractions). codex reads instructions from stdin when "-" is given.
        #  * -c value passed WITHOUT embedded quotes (model_reasoning_effort=<e>);
        #    codex falls back to the raw string when the TOML parse fails, and the
        #    bare token survives cmd.exe whereas embedded double-quotes do not.
        #  * --output-last-message captures the final agent message to a file
        #    (reliable regardless of --json event-schema drift).
        last_fd, last_path = _tf.mkstemp(prefix="graphify-codex-", suffix=".txt")
        os.close(last_fd)
        try:
            cmd = [
                "codex", "exec",
                "-C", resolved_cwd,
                "-m", model,
                "-c", f"model_reasoning_effort={effort}",
                "--dangerously-bypass-approvals-and-sandbox",
                "--skip-git-repo-check",
                "--json",
                "--output-last-message", last_path,
                "-",
            ]
            proc = _sp.Popen(
                _win_safe(cmd),
                stdin=_sp.PIPE,
                stdout=_sp.PIPE,
                stderr=_sp.PIPE,
                env=env,
                cwd=resolved_cwd,
            )
            stdout_b, stderr_b = proc.communicate(input=full_prompt.encode("utf-8"))
            if proc.returncode != 0:
                err = stderr_b.decode("utf-8", errors="replace")[:500]
                raise RuntimeError(f"[graphify-local] codex exited {proc.returncode}: {err}")

            # Primary: the captured final message (the extraction JSON we asked for).
            try:
                with open(last_path, "r", encoding="utf-8") as _fh:
                    last_msg = _fh.read().strip()
            except OSError:
                last_msg = ""
            if last_msg:
                return last_msg

            # Fallback: parse --json JSONL across known/likely codex event shapes.
            text_parts = []
            for raw_line in stdout_b.decode("utf-8", errors="replace").splitlines():
                raw_line = raw_line.strip()
                if not raw_line:
                    continue
                try:
                    ev = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue
                if ev.get("type") == "turn.completed":
                    break
                if ev.get("type") == "text":
                    text_parts.append(ev.get("text", ""))
                elif ev.get("type") in ("message", "assistant_message"):
                    for block in ev.get("content", []):
                        if isinstance(block, dict) and block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                item = ev.get("item")
                if isinstance(item, dict) and item.get("type") in (
                    "agent_message", "message", "assistant_message",
                ) and item.get("text"):
                    text_parts.append(item["text"])

            return "".join(text_parts)
        finally:
            try:
                os.remove(last_path)
            except OSError:
                pass

    else:
        raise ValueError(
            f"[graphify-local] Unknown local provider {resolved_provider!r}. "
            "Use 'claude' or 'codex'."
        )


def extract_files_direct(
    files: list[Path],
    backend: str = "local",
    api_key: str | None = None,
    model: str | None = None,
    root: Path = Path("."),
    provider: str | None = None,
) -> dict:
    """Extract semantic nodes/edges from a list of files using the given backend.

    Returns dict with nodes, edges, hyperedges, input_tokens, output_tokens.
    Raises ValueError for unknown backends.

    When backend=="local" the call is routed through the already-authenticated
    Claude Code CLI or Codex CLI (keyless).  The active provider (claude|codex)
    must be supplied via the ``provider`` arg or the ``GRAPHIFY_LOCAL_PROVIDER``
    env var — it is never baked in so the caller chooses per-scan.
    """
    if backend not in BACKENDS:
        raise ValueError(f"Unknown backend {backend!r}. Available: {sorted(BACKENDS)}")

    # ── Local harness path (keyless) ──────────────────────────────────────────
    if backend == "local":
        resolved_provider = provider or os.environ.get("GRAPHIFY_LOCAL_PROVIDER")
        user_msg = _read_files(files, root)
        raw = _call_local_cli(user_msg, provider=resolved_provider, cwd=str(root))
        result = _parse_llm_json(raw)
        result.setdefault("nodes", [])
        result.setdefault("edges", [])
        result.setdefault("hyperedges", [])
        result["input_tokens"] = 0
        result["output_tokens"] = 0
        result["model"] = "local"
        return result

    raise RuntimeError(_DIRECT_API_DISABLED)


def extract_corpus_parallel(
    files: list[Path],
    backend: str = "local",
    api_key: str | None = None,
    model: str | None = None,
    root: Path = Path("."),
    chunk_size: int = 20,
    on_chunk_done: Callable | None = None,
) -> dict:
    """Extract a corpus in chunks, merging results.

    on_chunk_done(idx, total, chunk_result) is called after each chunk if provided.
    Returns merged dict with nodes, edges, hyperedges, input_tokens, output_tokens.
    """
    chunks = [files[i:i + chunk_size] for i in range(0, len(files), chunk_size)]
    merged: dict = {"nodes": [], "edges": [], "hyperedges": [], "input_tokens": 0, "output_tokens": 0}

    for idx, chunk in enumerate(chunks):
        t0 = time.time()
        result = extract_files_direct(chunk, backend=backend, api_key=api_key, model=model, root=root)
        result["elapsed_seconds"] = round(time.time() - t0, 2)
        merged["nodes"].extend(result.get("nodes", []))
        merged["edges"].extend(result.get("edges", []))
        merged["hyperedges"].extend(result.get("hyperedges", []))
        merged["input_tokens"] += result.get("input_tokens", 0)
        merged["output_tokens"] += result.get("output_tokens", 0)
        if callable(on_chunk_done):
            on_chunk_done(idx, len(chunks), result)

    return merged


def estimate_cost(backend: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate USD cost for a given token count using published pricing."""
    if backend not in BACKENDS:
        return 0.0
    p = BACKENDS[backend]["pricing"]
    return (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000


def detect_backend() -> str | None:
    """Return the default backend without consulting API-key environment state."""
    return "local"
