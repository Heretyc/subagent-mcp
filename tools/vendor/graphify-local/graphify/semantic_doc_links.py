"""Semantic document-to-code links gated by a document-change budget."""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

from .cache import file_hash
from .detect import MD_EXTENSIONS, _is_ignored, _load_graphifyignore, is_markdown_included
from .llm import BACKENDS, _call_claude, _call_local_cli, _call_openai_compat, _parse_llm_json

MANIFEST_PATH = Path("graphify-out/semantic-doc-link-manifest.json")
CACHE_PATH = Path("graphify-out/cache/semantic/doc-links.json")
STATS_PATH = Path("graphify-out/cache/semantic/doc-links-stats.json")
MIN_SCORE = 0.65
BATCH_SIZE = 5
TOP_CODE_NODES = 1000


def discover_doc_files(root: Path) -> list[Path]:
    root = Path(root).resolve()
    patterns = _load_graphifyignore(root)
    docs: list[Path] = []
    for ext in sorted(MD_EXTENSIONS):
        for path in root.rglob(f"*{ext}"):
            if "graphify-out" in path.parts:
                continue
            if any(part.startswith(".") for part in path.relative_to(root).parts):
                continue
            if patterns and _is_ignored(path, root, patterns):
                continue
            if is_markdown_included(path, root):
                docs.append(path)
    return sorted(docs, key=lambda p: _relpath(p, root))


def _relpath(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix().replace("\\", "/")


def _compute_doc_hashes(doc_files: list[Path], root: Path) -> dict[str, str]:
    return {_relpath(path, root): file_hash(path, root) for path in sorted(doc_files)}


def _load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _atomic_write_json(path: Path, payload: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


def _gate_decision(current_hashes: dict[str, str], manifest: dict, cache_exists: bool) -> dict:
    prev_hashes = manifest.get("doc_hashes", {}) if isinstance(manifest, dict) else {}
    prev_count = manifest.get("doc_count_at_last_run", 0) if isinstance(manifest, dict) else 0
    added = len([k for k in current_hashes if k not in prev_hashes])
    removed = len([k for k in prev_hashes if k not in current_hashes])
    modified = len([k for k in current_hashes if k in prev_hashes and current_hashes[k] != prev_hashes[k]])
    changed_fraction = (added + removed + modified) / max(int(prev_count or 0), 1)
    force = (not manifest) or (not cache_exists) or changed_fraction > 0.30
    return {
        "force": force,
        "changed_fraction": changed_fraction,
        "added": added,
        "removed": removed,
        "modified": modified,
    }


def _code_table(code_nodes: list[dict]) -> tuple[list[dict], str]:
    ranked = sorted(
        (n for n in code_nodes if n.get("id") and n.get("file_type") == "code"),
        key=lambda n: (-int(n.get("_degree", 0) or 0), str(n.get("id", ""))),
    )[:TOP_CODE_NODES]
    rows = []
    lines = []
    for idx, node in enumerate(ranked, start=1):
        row = {
            "id": str(node.get("id", "")),
            "label": str(node.get("label", "")),
            "path": str(node.get("source_file", "")),
            "degree": int(node.get("_degree", 0) or 0),
        }
        rows.append(row)
        lines.append(f"{idx}. id={row['id']} label={row['label']} path={row['path']} degree={row['degree']}")
    return rows, "\n".join(lines)


def _sections_by_doc(doc_nodes: list[dict]) -> dict[str, list[dict]]:
    by_doc: dict[str, list[dict]] = {}
    for node in sorted(doc_nodes, key=lambda n: (str(n.get("doc_path") or n.get("source_file", "")), int(n.get("line_number", 0) or 0), str(n.get("id", "")))):
        rel = str(node.get("doc_path") or node.get("source_file") or "").replace("\\", "/")
        if rel:
            by_doc.setdefault(rel, []).append(node)
    return by_doc


def _doc_excerpt(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            text = text[end + 4:]
    return text[:12000]


def _prompt(root: Path, batch: list[Path], code_table: str, doc_sections: dict[str, list[dict]]) -> str:
    docs = []
    for path in batch:
        rel = _relpath(path, root)
        sections = doc_sections.get(rel, [])
        section_lines = [
            f"- source_id={s.get('id')} title={s.get('title') or s.get('label')} line={s.get('line_number')}"
            for s in sections[:80]
        ] or [f"- source_id=md:{rel}#section title={rel} line=1"]
        docs.append(
            f"=== DOC {rel} ===\nSECTIONS:\n" + "\n".join(section_lines) + "\nCONTENT:\n" + _doc_excerpt(path)
        )
    return (
        "You are adding semantic document-to-code graph edges.\n"
        "Return ONLY valid JSON with this exact shape: "
        '{"edges":[{"source":"doc_section_id","target":"code_node_id","score":0.0,"reason":"brief"}]}.\n'
        "Use only source IDs from DOC SECTIONS and target IDs from CODE NODE TABLE.\n"
        "Create links only when the doc section and code symbol describe the same feature, system, or responsibility.\n"
        "Score from 0.0 to 1.0. Prefer precision over recall. Do not invent IDs.\n\n"
        "CODE NODE TABLE:\n" + code_table + "\n\n"
        + "\n\n".join(docs)
    )


def _resolve_backend() -> tuple[str, str | None]:
    configured = (
        os.environ.get("GRAPHIFY_SEMANTIC_DOC_BACKEND")
        or os.environ.get("GRAPHIFY_BACKEND")
        or "local"
    ).strip().lower()
    if configured == "local":
        provider = os.environ.get("GRAPHIFY_LOCAL_PROVIDER", "").strip().lower()
        if not provider:
            if shutil.which("codex"):
                provider = "codex"
            elif shutil.which("claude"):
                provider = "claude"
        if provider:
            return "local", provider
    if configured in BACKENDS:
        print(
            f"[graphify semantic-doc-links] WARNING: using cloud backend {configured} (API cost) "
            f"because GRAPHIFY_SEMANTIC_DOC_BACKEND/GRAPHIFY_BACKEND selected it; "
            "set GRAPHIFY_SEMANTIC_DOC_BACKEND=local for offline mode.",
            file=sys.stderr,
        )
        return configured, None
    if os.environ.get("MOONSHOT_API_KEY"):
        print(
            "[graphify semantic-doc-links] WARNING: using cloud backend kimi (API cost) "
            "because MOONSHOT_API_KEY is set; set GRAPHIFY_SEMANTIC_DOC_BACKEND=local for offline mode.",
            file=sys.stderr,
        )
        return "kimi", None
    if os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "[graphify semantic-doc-links] WARNING: using cloud backend claude (API cost) "
            "because ANTHROPIC_API_KEY is set; set GRAPHIFY_SEMANTIC_DOC_BACKEND=local for offline mode.",
            file=sys.stderr,
        )
        return "claude", None
    return "local", None


def _call_model(prompt: str, backend: str, provider: str | None, root: Path) -> dict:
    if backend == "local":
        raw = _call_local_cli(prompt, provider=provider, cwd=str(root))
        return _parse_llm_json(raw)
    cfg = BACKENDS[backend]
    key = os.environ.get(cfg["env_key"], "")
    if not key:
        raise ValueError(f"No API key for backend '{backend}'. Set {cfg['env_key']}.")
    if backend == "claude":
        return _call_claude(key, cfg["default_model"], prompt)
    return _call_openai_compat(
        cfg["base_url"],
        key,
        cfg["default_model"],
        prompt,
        temperature=cfg.get("temperature", 0),
    )


def _as_score(value) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def _run_semantic_pass(root: Path, doc_files: list[Path], code_nodes: list[dict], doc_nodes: list[dict]) -> tuple[list[dict], dict]:
    backend, provider = _resolve_backend()
    _, code_table = _code_table(code_nodes)
    if not code_table:
        return [], {"backend": backend, "provider": provider, "calls": 0, "elapsed_seconds": 0.0}
    sections = _sections_by_doc(doc_nodes)
    valid_sources = {str(n.get("id")) for n in doc_nodes if n.get("id")}
    first_section = {rel: items[0]["id"] for rel, items in sections.items() if items}
    valid_targets = {str(n.get("id")) for n in code_nodes if n.get("id") and n.get("file_type") == "code"}
    batches = [doc_files[i:i + BATCH_SIZE] for i in range(0, len(doc_files), BATCH_SIZE)]
    edges: list[dict] = []
    calls = 0
    t0 = time.monotonic()

    for batch in batches:
        result = _call_model(_prompt(root, batch, code_table, sections), backend, provider, root)
        calls += 1
        for item in result.get("edges", []):
            source = str(item.get("source") or "")
            target = str(item.get("target") or item.get("target_code_id") or "")
            score = _as_score(item.get("score", item.get("confidence_score")))
            if source not in valid_sources:
                rel = source.replace("\\", "/")
                source = first_section.get(rel, source)
            if source not in valid_sources or target not in valid_targets or score < MIN_SCORE:
                continue
            source_file = next((n.get("source_file") for n in doc_nodes if n.get("id") == source), "")
            edges.append({
                "source": source,
                "target": target,
                "relation": "semantically_similar_to",
                "confidence": "INFERRED",
                "confidence_score": score,
                "source_file": source_file,
                "source_location": None,
                "weight": score,
                "_semantic_doc_link": True,
                "reason": str(item.get("reason", ""))[:200],
            })

    edge_key = lambda e: (str(e["source"]), str(e["target"]), float(e["confidence_score"]))
    deduped = {edge_key(edge): edge for edge in edges}
    sorted_edges = [deduped[key] for key in sorted(deduped)]
    stats = {
        "backend": backend,
        "provider": provider,
        "calls": calls,
        "elapsed_seconds": round(time.monotonic() - t0, 2),
        "edges": len(sorted_edges),
    }
    return sorted_edges, stats


def run_or_load(root: Path, code_nodes: list[dict], doc_nodes: list[dict] | None = None) -> list[dict]:
    root = Path(root).resolve()
    manifest_path = root / MANIFEST_PATH
    cache_path = root / CACHE_PATH
    stats_path = root / STATS_PATH
    doc_files = discover_doc_files(root)
    current_hashes = _compute_doc_hashes(doc_files, root)
    manifest = _load_json(manifest_path, {})
    decision = _gate_decision(current_hashes, manifest, cache_path.exists())

    if not decision["force"] and cache_path.exists():
        cached = _load_json(cache_path, {"edges": []})
        stats = {
            "backend": "cache",
            "provider": None,
            "calls": 0,
            "elapsed_seconds": 0.0,
            "edges": len(cached.get("edges", [])),
            **decision,
        }
        _atomic_write_json(stats_path, stats)
        print(f"[graphify semantic-doc-links] cache hit: {stats['edges']} edges, no model calls")
        return cached.get("edges", [])

    print(
        "[graphify semantic-doc-links] forced semantic pass: "
        f"{len(doc_files)} docs, changed_fraction={decision['changed_fraction']:.2f}"
    )
    edges, stats = _run_semantic_pass(root, doc_files, code_nodes, doc_nodes or [])
    stats.update(decision)
    _atomic_write_json(cache_path, {"edges": edges})
    _atomic_write_json(manifest_path, {
        "doc_hashes": current_hashes,
        "doc_count_at_last_run": len(current_hashes),
    })
    _atomic_write_json(stats_path, stats)
    print(
        "[graphify semantic-doc-links] forced pass complete: "
        f"{len(edges)} edges, backend={stats['backend']}, calls={stats['calls']}"
    )
    return edges
