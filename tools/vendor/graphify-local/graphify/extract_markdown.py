"""Deterministic structural extraction from Markdown files."""
from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import unquote, urlparse


MD_EXTENSIONS = {".md", ".markdown"}

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
_MD_LINK_RE = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
_INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
_TOKEN_RE = re.compile(r"\S+")
_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_LINE_LIMIT_RE = re.compile(r"^LINE_LIMIT:\s*(.+?)\s*$")
_SEMANTIC_KEYWORDS_RE = re.compile(r"^SEMANTIC_KEYWORDS:\s*(.+?)\s*$")
_MENTION_MIN_LEN = 5
_COMMON_IDENTIFIER_DENYLIST = {
    "a", "b", "c", "d", "i", "j", "k",
    "get", "set", "data", "main", "update", "value", "name", "type",
    "response", "request", "index", "count", "list", "item", "node",
    "file", "path", "text", "line", "result", "results", "return",
    "input", "output", "config", "option", "options", "object", "string",
    "number", "array", "true", "false", "null", "none", "this", "that",
    "with", "from", "into", "class", "function", "method", "property",
    "component", "system", "manager", "controller", "handler", "state",
    "event", "action", "error", "warning", "debug", "test", "tests",
    "json", "yaml", "markdown", "readme", "changelog",
    "editor", "project", "build", "start", "apply", "remove", "fail",
    "assets", "unity", "github", "script", "scripts", "branch", "commit",
    "projectsettings", "items", "unique", "values", "awake", "onenable",
    "vector3", "gameobject", "transform", "material", "shader", "texture",
    "mathf", "camera", "light", "unityeditor",
}


def _slug(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", text.lower())
    return cleaned.strip("-") or "section"


def _relpath(path: Path, root: Path | None) -> str:
    try:
        base = root.resolve() if root is not None else Path.cwd().resolve()
        return path.resolve().relative_to(base).as_posix()
    except ValueError:
        return path.as_posix()


def _section_id(relpath: str, slug: str) -> str:
    return f"md:{relpath}#{slug}"


def _source_location(line: int) -> str:
    return f"L{line}"


def _read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8", errors="ignore").splitlines()


def _header_attrs(lines: list[str]) -> dict:
    attrs: dict[str, object] = {}
    for line in lines[:2]:
        limit = _LINE_LIMIT_RE.match(line)
        if limit:
            attrs["line_limit"] = limit.group(1)
            continue
        keywords = _SEMANTIC_KEYWORDS_RE.match(line)
        if keywords:
            attrs["semantic_keywords"] = [
                item.strip() for item in keywords.group(1).split(",") if item.strip()
            ]
    return attrs


def _strip_heading_markup(title: str) -> str:
    title = re.sub(r"\s+\{#[^}]+\}\s*$", "", title)
    title = re.sub(r"`([^`]+)`", r"\1", title)
    title = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", title)
    return title.strip()


def _parse_headings(path: Path, root: Path | None) -> tuple[list[dict], list[dict], dict[str, str]]:
    rel = _relpath(path, root)
    lines = _read_lines(path)
    header = _header_attrs(lines)
    nodes: list[dict] = []
    edges: list[dict] = []
    slug_counts: dict[str, int] = {}
    slug_to_id: dict[str, str] = {}
    stack: list[tuple[int, str]] = []

    for idx, line in enumerate(lines, start=1):
        match = _HEADING_RE.match(line)
        if not match:
            continue
        level = len(match.group(1))
        title = _strip_heading_markup(match.group(2))
        base_slug = _slug(title)
        count = slug_counts.get(base_slug, 0) + 1
        slug_counts[base_slug] = count
        section_slug = base_slug if count == 1 else f"{base_slug}-{count}"
        nid = _section_id(rel, section_slug)
        slug_to_id.setdefault(base_slug, nid)
        slug_to_id[section_slug] = nid
        node = {
            "id": nid,
            "label": title,
            "file_type": "document",
            "type": "doc_section",
            "node_type": "doc_section",
            "doc_path": rel,
            "heading_level": level,
            "title": title,
            "line_number": idx,
            "source_file": rel,
            "source_location": _source_location(idx),
        }
        node.update(header)
        nodes.append(node)

        while stack and stack[-1][0] >= level:
            stack.pop()
        if stack:
            edges.append({
                "source": stack[-1][1],
                "target": nid,
                "relation": "contains",
                "confidence": "EXTRACTED",
                "source_file": rel,
                "source_location": _source_location(idx),
                "weight": 1.0,
            })
        stack.append((level, nid))

    return nodes, edges, slug_to_id


def _find_section_for_line(nodes: list[dict], line: int) -> str | None:
    current = None
    for node in nodes:
        if node["line_number"] <= line:
            current = node["id"]
        else:
            break
    return current


def _target_doc_path(source: Path, link: str, root: Path | None) -> tuple[str, str | None] | None:
    link = link.strip()
    if not link or link.startswith("#"):
        return None
    parsed = urlparse(link)
    if parsed.scheme or parsed.netloc:
        return None
    raw_path = unquote(parsed.path).strip()
    if not raw_path:
        return None
    if raw_path.startswith("<") and raw_path.endswith(">"):
        raw_path = raw_path[1:-1]
    target = Path(raw_path.replace("/", os.sep))
    if not target.suffix:
        target = target.with_suffix(".md")
    if target.suffix.lower() not in MD_EXTENSIONS:
        return None
    if not target.is_absolute():
        target = (source.parent / target).resolve()
    return _relpath(target, root), parsed.fragment or None


def _wikilink_target(source: Path, value: str, root: Path | None) -> tuple[str, str | None] | None:
    target = value.split("|", 1)[0].strip()
    if not target:
        return None
    doc_part, _, section = target.partition("#")
    if doc_part:
        resolved = _target_doc_path(source, doc_part, root)
        if resolved is None:
            doc_path = Path(doc_part.replace("/", os.sep))
            if not doc_path.suffix:
                doc_path = doc_path.with_suffix(".md")
            if doc_path.suffix.lower() not in MD_EXTENSIONS:
                return None
            if not doc_path.is_absolute():
                doc_path = (source.parent / doc_path).resolve()
            resolved = (_relpath(doc_path, root), None)
        return resolved[0], section or resolved[1]
    return _relpath(source, root), section or None


def _first_heading_slug(path: Path) -> str | None:
    try:
        for line in _read_lines(path):
            match = _HEADING_RE.match(line)
            if match:
                return _slug(_strip_heading_markup(match.group(2)))
    except OSError:
        return None
    return None


def _resolve_section_id(source: Path, rel: str, fragment: str | None, root: Path | None) -> str:
    if fragment:
        return _section_id(rel, _slug(fragment))
    try:
        base = root.resolve() if root is not None else Path.cwd().resolve()
        target_path = (base / rel).resolve()
    except Exception:
        target_path = source.parent / rel
    return _section_id(rel, _first_heading_slug(target_path) or "section")


def _code_tokens(text: str) -> set[str]:
    tokens: set[str] = set()
    for match in _TOKEN_RE.finditer(text):
        token = match.group(0).strip().lstrip(".")
        token = re.sub(r"\([^)]*\)$", "", token)
        token = token.removesuffix(";")
        if not _IDENTIFIER_RE.fullmatch(token):
            continue
        if len(token) < _MENTION_MIN_LEN:
            continue
        if token.lower() in _COMMON_IDENTIFIER_DENYLIST:
            continue
        tokens.add(token)
    return tokens


def extract_markdown(path: Path, root: Path | None = None, code_index: dict[str, str] | None = None) -> dict:
    """Extract heading sections, doc links, and conservative code mentions."""
    try:
        lines = _read_lines(path)
    except OSError as exc:
        return {"nodes": [], "edges": [], "error": str(exc)}

    nodes, edges, local_slugs = _parse_headings(path, root)
    if not nodes:
        return {"nodes": [], "edges": [], "input_tokens": 0, "output_tokens": 0}

    rel = _relpath(path, root)
    known_code = code_index or {}
    seen_edges = {(e["source"], e["target"], e["relation"]) for e in edges}
    in_fence = False
    fence_text: list[str] = []
    fence_start = 0

    def add_edge(src: str | None, dst: str | None, relation: str, confidence: str, line: int, weight: float) -> None:
        if not src or not dst or src == dst:
            return
        key = (src, dst, relation)
        if key in seen_edges:
            return
        seen_edges.add(key)
        edges.append({
            "source": src,
            "target": dst,
            "relation": relation,
            "confidence": confidence,
            "source_file": rel,
            "source_location": _source_location(line),
            "weight": weight,
        })

    def add_code_mentions(section_id: str | None, text: str, line: int) -> None:
        if not section_id or not known_code:
            return
        for token in sorted(_code_tokens(text)):
            for target in known_code.get(token, []):
                add_edge(section_id, target, "mentions", "INFERRED", line, 0.8)

    for idx, line in enumerate(lines, start=1):
        if line.lstrip().startswith("```") or line.lstrip().startswith("~~~"):
            if in_fence:
                add_code_mentions(_find_section_for_line(nodes, fence_start), "\n".join(fence_text), fence_start)
                fence_text = []
                in_fence = False
            else:
                in_fence = True
                fence_start = idx
            continue
        if in_fence:
            fence_text.append(line)
            continue

        section_id = _find_section_for_line(nodes, idx)
        for match in _WIKILINK_RE.finditer(line):
            target = _wikilink_target(path, match.group(1), root)
            if target:
                add_edge(section_id, _resolve_section_id(path, target[0], target[1], root), "references", "EXTRACTED", idx, 1.0)
        for match in _MD_LINK_RE.finditer(line):
            target = _target_doc_path(path, match.group(1), root)
            if target:
                if target[0] == rel and target[1]:
                    dst = local_slugs.get(_slug(target[1]))
                else:
                    dst = _resolve_section_id(path, target[0], target[1], root)
                add_edge(section_id, dst, "references", "EXTRACTED", idx, 1.0)
        for match in _INLINE_CODE_RE.finditer(line):
            add_code_mentions(section_id, match.group(1), idx)

    if in_fence:
        add_code_mentions(_find_section_for_line(nodes, fence_start), "\n".join(fence_text), fence_start)

    return {"nodes": nodes, "edges": edges, "input_tokens": 0, "output_tokens": 0}
