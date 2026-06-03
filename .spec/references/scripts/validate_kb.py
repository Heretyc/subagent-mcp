"""Validate the .spec/references knowledge base.

Pure-stdlib, path-relative checks for the decomposed RAG KB.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse


EXPECTED_CATEGORIES = [
    "math_proof",
    "security_review",
    "debugging",
    "quality_review",
    "architecture",
    "agentic_execution",
    "data_analysis",
    "coding",
    "knowledge_synthesis",
    "mechanical",
]

EXPECTED_PRECEDENCE = EXPECTED_CATEGORIES
EXPECTED_FALLBACK = "fallback_default"
EXPECTED_FALLBACK_PRECEDENCE = 99
EXPECTED_PENDING_STATUS = "pending_impartial_profiling"
EXPECTED_VERSION = "2.1.0"
EXPECTED_GENERATED = "2026-06"
EXPECTED_GENERATED_AT = "2026-06-03T00:00:00Z"
EXPECTED_SOURCE = r"C:\Users\Lexi\AppData\Local\Temp\catdebate\consensus-categories.json"
EXPECTED_SOURCE_DATE = "2026-06-03"

VALID_MODELS = {
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "gpt-5.5",
    "gpt-5.4-mini",
    "gpt-5.5-pro",
}

MODEL_REF_RE = re.compile(r"\b(?:claude-[a-z]+-\d+-\d+|gpt-\d+\.\d+(?:-(?:mini|pro))?)\b")
PENDING_ROUTE_TEXT = (
    "pending impartial profiler run "
    "(rankings determined solely from discovered research)"
)


def kb_root() -> Path:
    return Path(__file__).resolve().parents[1]


def rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def leaf_markdown_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.md") if p.is_file())


def check_line_caps(root: Path) -> list[str]:
    errors: list[str] = []
    for path in leaf_markdown_files(root):
        lines = read_text(path).splitlines()
        if len(lines) > 200:
            errors.append(f"{rel(path, root)} has {len(lines)} lines (>200)")
    return errors


def is_relative_local_link(target: str) -> bool:
    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc:
        return False
    if target.startswith("#"):
        return False
    return target.endswith(".md") or ".md#" in target or ".md " in target or target.endswith(".json")


def normalize_link_target(target: str) -> str:
    target = unquote(target.strip())
    target = target.split("#", 1)[0]
    target = target.split(" ", 1)[0]
    return target


def iter_markdown_links(text: str):
    for match in re.finditer(r"\[[^\]]+\]\(([^)]+)\)", text):
        yield match.group(1)


def check_cross_links(root: Path) -> list[str]:
    errors: list[str] = []
    for path in leaf_markdown_files(root):
        for raw_target in iter_markdown_links(read_text(path)):
            target = normalize_link_target(raw_target)
            if not is_relative_local_link(target):
                continue
            resolved = (path.parent / target).resolve()
            try:
                resolved.relative_to(root.resolve())
            except ValueError:
                errors.append(f"{rel(path, root)} links outside KB: {raw_target}")
                continue
            if not resolved.exists():
                errors.append(f"{rel(path, root)} broken link: {raw_target}")
    return errors


def check_retrieval_map_coverage(root: Path) -> list[str]:
    errors: list[str] = []
    retrieval_map = root / "retrieval-map.md"
    if not retrieval_map.exists():
        return ["retrieval-map.md missing"]
    text = read_text(retrieval_map)
    required = [
        rel(path, root)
        for path in leaf_markdown_files(root)
        if path.name != "retrieval-map.md"
    ]
    required.append("assets/routing-table.json")
    missing = [path for path in sorted(required) if path not in text]
    if missing:
        errors.append("retrieval-map.md missing references: " + ", ".join(missing))
    return errors


def load_json(path: Path, label: str) -> tuple[dict, list[str]]:
    try:
        data = json.loads(read_text(path))
    except FileNotFoundError:
        return {}, [f"{label} missing"]
    except json.JSONDecodeError as exc:
        return {}, [f"{label} JSON parse error: {exc}"]
    if not isinstance(data, dict):
        return {}, [f"{label} must be a JSON object"]
    return data, []


def iter_json_strings(value: object):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from iter_json_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_json_strings(child)


def check_json_model_refs(data: object, label: str) -> list[str]:
    tokens: set[str] = set()
    for text in iter_json_strings(data):
        tokens.update(MODEL_REF_RE.findall(text))
    invalid = sorted(token for token in tokens if token not in VALID_MODELS)
    if invalid:
        return [f"{label} invalid model refs: " + ", ".join(invalid)]
    return []


def expected_metadata(base: dict[str, object]) -> dict[str, object]:
    result = {
        "author": "Lexi Blackburn",
        "author_url": "https://github.com/Heretyc/",
        "version": EXPECTED_VERSION,
        "source": EXPECTED_SOURCE,
        "source_date": EXPECTED_SOURCE_DATE,
        "generated": EXPECTED_GENERATED,
        "generated_at": EXPECTED_GENERATED_AT,
        "status": EXPECTED_PENDING_STATUS,
        "rag_pointer": ".spec/references/retrieval-map.md",
    }
    result.update(base)
    return result


def check_metadata(errors: list[str], data: dict, label: str, expected: dict[str, object]) -> None:
    metadata = data.get("metadata")
    if metadata != expected:
        errors.append(f"{label} metadata block does not match June 2026 consensus manifest")


def check_fallback(errors: list[str], data: dict, label: str) -> None:
    fallback = data.get(EXPECTED_FALLBACK)
    if not isinstance(fallback, dict):
        errors.append(f"{label} fallback_default must be an object")
        return
    if fallback.get("id") != EXPECTED_FALLBACK:
        errors.append(f"{label} fallback_default id mismatch")
    if fallback.get("precedence") != EXPECTED_FALLBACK_PRECEDENCE:
        errors.append(f"{label} fallback_default precedence must be 99")
    if not isinstance(fallback.get("pairings"), list):
        errors.append(f"{label} fallback_default pairings must be an array")


def check_category_spine(errors: list[str], data: dict, label: str) -> None:
    categories = data.get("categories")
    if not isinstance(categories, dict):
        errors.append(f"{label} categories must be an object")
        return
    if list(categories.keys()) != EXPECTED_CATEGORIES:
        errors.append(f"{label} categories keys/order do not match consensus spine")
    for index, key in enumerate(EXPECTED_CATEGORIES, start=1):
        record = categories.get(key)
        if not isinstance(record, dict):
            errors.append(f"{label} category {key} must be an object")
            continue
        if record.get("id") != key:
            errors.append(f"{label} category {key} id field mismatch")
        if record.get("precedence") != index:
            errors.append(f"{label} category {key} precedence mismatch")
        if record.get("status") != EXPECTED_PENDING_STATUS:
            errors.append(f"{label} category {key} status must be {EXPECTED_PENDING_STATUS}")
        if not isinstance(record.get("rag_pointer"), str):
            errors.append(f"{label} category {key} rag_pointer must be a string")


def check_pending_branch(errors: list[str], data: dict, label: str, branch: str, *, audit: bool) -> None:
    records = data.get(branch)
    if not isinstance(records, dict):
        errors.append(f"{label} {branch} must be an object")
        return
    if list(records.keys()) != EXPECTED_CATEGORIES:
        errors.append(f"{label} {branch} keys/order do not match consensus spine")
    for index, key in enumerate(EXPECTED_CATEGORIES, start=1):
        record = records.get(key)
        if not isinstance(record, dict):
            errors.append(f"{label} {branch}.{key} must be an object")
            continue
        if record.get("id") != key:
            errors.append(f"{label} {branch}.{key} id field mismatch")
        if record.get("precedence") != index:
            errors.append(f"{label} {branch}.{key} precedence mismatch")
        if record.get("status") != EXPECTED_PENDING_STATUS:
            errors.append(f"{label} {branch}.{key} status must be {EXPECTED_PENDING_STATUS}")
        if not isinstance(record.get("rag_pointer"), str):
            errors.append(f"{label} {branch}.{key} rag_pointer must be a string")
        if record.get("pairings") != []:
            errors.append(f"{label} {branch}.{key} pairings must be empty until profiling")
        if audit and record.get("citations") != []:
            errors.append(f"{label} {branch}.{key} citations must be empty until profiling")


def extract_routing_table_rows(root: Path) -> list[tuple[str, str, str, str]]:
    rows: list[tuple[str, str, str, str]] = []
    in_route_table = False
    for line in read_text(root / "routing-table.md").splitlines():
        if line.startswith("| prec | category |"):
            in_route_table = True
            continue
        if in_route_table and line.startswith("## "):
            break
        if not in_route_table:
            continue
        parts = [part.strip() for part in line.strip().strip("|").split("|")]
        if len(parts) < 5 or parts[0].startswith("---"):
            continue
        match = re.fullmatch(r"`([a-z][a-z0-9_]+)`", parts[1])
        if match:
            rows.append((parts[0], match.group(1), parts[2], parts[3]))
    return rows


def check_md_spine_mirror(root: Path, json_order: list[str]) -> list[str]:
    errors: list[str] = []
    rows = extract_routing_table_rows(root)
    md_order = [row[1] for row in rows]
    expected_order = EXPECTED_CATEGORIES + [EXPECTED_FALLBACK]
    if md_order != expected_order:
        errors.append(f"routing-table.md category order mismatch: {md_order}")
    if json_order != EXPECTED_CATEGORIES:
        errors.append(f"routing-table.json category order mismatch: {json_order}")
    for _prec, category, performance_route, cost_route in rows:
        if category != EXPECTED_FALLBACK:
            if performance_route != PENDING_ROUTE_TEXT or cost_route != PENDING_ROUTE_TEXT:
                errors.append(f"routing-table.md {category} route columns must stay pending")
    text = read_text(root / "routing-table.md")
    invalid_models = sorted(set(MODEL_REF_RE.findall(text)) - VALID_MODELS)
    if invalid_models:
        errors.append("routing-table.md invalid model refs: " + ", ".join(invalid_models))
    return errors


def check_routing_table(root: Path) -> list[str]:
    errors: list[str] = []
    label = "assets/routing-table.json"
    data, load_errors = load_json(root / "assets" / "routing-table.json", label)
    if load_errors:
        return load_errors
    expected = expected_metadata(
        {"generated_for": "subagent-mcp cross-provider work-category routing feature"}
    )
    check_metadata(errors, data, label, expected)
    if data.get("schema_version") != EXPECTED_VERSION:
        errors.append(f"{label} schema_version must be {EXPECTED_VERSION}")
    if data.get("classification_precedence") != EXPECTED_PRECEDENCE:
        errors.append(f"{label} classification_precedence does not match consensus spine")
    if data.get("default_category") != EXPECTED_FALLBACK:
        errors.append(f"{label} default_category must be fallback_default")
    check_fallback(errors, data, label)
    check_category_spine(errors, data, label)
    check_pending_branch(errors, data, label, "performance", audit=False)
    check_pending_branch(errors, data, label, "cost_efficiency", audit=False)
    categories = data.get("categories") if isinstance(data.get("categories"), dict) else {}
    errors.extend(check_md_spine_mirror(root, list(categories.keys())))
    errors.extend(check_json_model_refs(data, label))
    return errors


def check_routing_table_audit(root: Path) -> list[str]:
    errors: list[str] = []
    label = "assets/routing-table-audit.json"
    data, load_errors = load_json(root / "assets" / "routing-table-audit.json", label)
    if load_errors:
        return load_errors
    expected = expected_metadata(
        {
            "schema_version": EXPECTED_VERSION,
            "audits": ".spec/references/assets/routing-table.json",
            "source_ledger_pointer": ".spec/references/source-ledger.md",
            "note": (
                "Per-category model-effort pairings and citations are empty until "
                "an impartial profiler run populates them from discovered research."
            ),
        }
    )
    check_metadata(errors, data, label, expected)
    if data.get("schema_version") != EXPECTED_VERSION:
        errors.append(f"{label} schema_version must be {EXPECTED_VERSION}")
    if data.get("classification_precedence") != EXPECTED_PRECEDENCE:
        errors.append(f"{label} classification_precedence does not match consensus spine")
    check_fallback(errors, data, label)
    check_pending_branch(errors, data, label, "performance", audit=True)
    check_pending_branch(errors, data, label, "cost_efficiency", audit=True)
    errors.extend(check_json_model_refs(data, label))
    return errors


def check_provenance_purity(root: Path) -> list[str]:
    errors: list[str] = []
    marker = ".spec/references/"
    for path in leaf_markdown_files(root):
        for line_no, line in enumerate(read_text(path).splitlines(), start=1):
            normalized = line.replace("\\", "/")
            if marker not in normalized:
                continue
            if path.name == "source-ledger.md" and normalized.startswith("|"):
                cells = [cell.strip() for cell in normalized.strip().strip("|").split("|")]
                if len(cells) >= 2 and marker in cells[1]:
                    errors.append(f"{rel(path, root)}:{line_no} cites internal KB path as provenance")
            elif re.search(r"\b(Source|Sources|Citation|Citations|Provenance):", line):
                errors.append(f"{rel(path, root)}:{line_no} cites internal KB path as provenance")
    return errors


def main() -> int:
    root = kb_root()
    checks = [
        ("markdown line caps", check_line_caps(root)),
        ("relative cross-links", check_cross_links(root)),
        ("retrieval-map coverage", check_retrieval_map_coverage(root)),
        ("routing-table.json", check_routing_table(root)),
        ("routing-table-audit.json", check_routing_table_audit(root)),
        ("provenance purity", check_provenance_purity(root)),
    ]
    failures = [(name, issues) for name, issues in checks if issues]
    if failures:
        print("FAIL .spec/references KB validation")
        for name, issues in failures:
            print(f"- {name}:")
            for issue in issues:
                print(f"  - {issue}")
        return 1
    print("PASS .spec/references KB validation")
    for name, _issues in checks:
        print(f"- {name}: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
