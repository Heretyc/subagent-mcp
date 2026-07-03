#!/usr/bin/env python3
"""advanced-ruleset.py — final-authority model-routing override hook for subagent-mcp.

(a) PERFORMANCE WARNING: this script runs synchronously inside EVERY launch_agent
    call. Slow rules slow every agent launch. Keep rules lean and low-latency —
    no network calls, no heavy imports at module top. This is YOUR responsibility;
    you have been warned.

(b) OUTPUT CONTRACT (routing mode): print to stdout ONE JSON array — the modified
    candidate list (reorder / filter / replace allowed). Template:
    [
      {"provider": "claude", "model": "sonnet",  "effort": "high",  "rank": 1},
      {"provider": "codex",  "model": "gpt-5.5", "effort": "xhigh", "rank": 2}
    ]
    Valid providers: claude, codex. Valid models: haiku, sonnet, opus, opus-4-8, fable (claude);
    gpt-5.5 (codex). Valid efforts: haiku -> "none" only; sonnet -> medium|high|xhigh|max;
    fable -> medium|high|xhigh|max; opus/opus-4-8 -> those plus ultracode; gpt-5.5 -> medium|high|xhigh.
    "rank" on output is ignored. An EMPTY array vetoes the launch. Anything else
    invalid fails the launch hard — the server validates strictly.

(c) INPUT CONTRACT (routing mode, invoked as: <python> advanced-ruleset.py route):
    stdin receives one JSON object:
    { "candidates": [ {"provider","model","effort","rank"} ... ],   # rank 1..N best->worst
      "context": { "task_category": str, "cwd": str,
                   "selection_mode": "auto"|"provider"|"provider_model"|"explicit",
                   "provider": str|None, "model": str|None, "effort": str|None } }
    OS environment variables are visible natively (os.environ).

ENV-CHECK MODE (no arguments): prints {"ready": true|false, "load-rules": true|false}.
Runs once per MCP server process. load-rules false => ruleset silently disabled
for the rest of the process. Set LOAD_RULES = True below to activate.
"""
import json
import sys

LOAD_RULES = False

# --- Requirements stub (scaffold itself is stdlib-only) ----------------------
# List third-party distributions your rules import, e.g.:
# REQUIREMENTS = ["requests", "pyyaml"]
# Install with:  <python> -m pip install <name> ...
REQUIREMENTS = []

def missing_requirements():
    """pip-check helper: returns the REQUIREMENTS entries not importable here."""
    import importlib.util
    return [r for r in REQUIREMENTS
            if importlib.util.find_spec(r.replace("-", "_")) is None]

def env_check():
    missing = missing_requirements()
    json.dump({"ready": not missing, "load-rules": bool(LOAD_RULES)}, sys.stdout)

def apply_rules(candidates, context):
    """YOUR RULES HERE. Default: passthrough (returns the list unchanged)."""
    return candidates

def route():
    payload = json.load(sys.stdin)
    out = apply_rules(payload.get("candidates", []), payload.get("context", {}))
    json.dump(out, sys.stdout)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "route":
        route()
    else:
        env_check()
