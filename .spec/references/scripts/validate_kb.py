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
    "architecture",
    "quality_review",
    "debugging",
    "agentic_execution",
    "knowledge_synthesis",
    "coding",
    "mechanical",
    "fallback_default",
]

EXPECTED_PRECEDENCE = EXPECTED_CATEGORIES[:-1]

EXPECTED_GATES = [
    "G_MATH",
    "G_CTX_200",
    "G_CTX_272",
    "G_CTX_400",
    "G_CTX_1M",
    "G_CTX_OUT",
    "G_SEC",
    "G_COMMIT",
    "G_SANDBOX",
    "G_DATA",
    "G_OPUS_LOCK",
]

REQUIRED_CATEGORY_FIELDS = {
    "id",
    "definition",
    "classify_signals",
    "precedence",
    "primary",
    "fallback",
    "gates",
    "synergy_pattern",
    "cost_note",
    "risk_flags",
}

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

VALID_PROVIDERS = {"anthropic", "openai"}
VALID_CONDITION_OPS = {"eq", "gt", "in", "intersects"}
VALID_GATE_SEVERITIES = {"mandatory", "constraint", "blocker", "safety"}
MODEL_REF_RE = re.compile(r"\b(?:claude-[a-z]+-\d+-\d+|gpt-\d+\.\d+(?:-(?:mini|pro))?)\b")


def kb_root() -> Path:
    return Path(__file__).resolve().parents[1]


def rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


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


def extract_spine_ids(root: Path, file_name: str) -> set[str]:
    text = read_text(root / file_name)
    found = {token for token in re.findall(r"`([a-z][a-z0-9_]+)`", text)}
    return found & set(EXPECTED_CATEGORIES)


def extract_routing_table_order(root: Path) -> list[str]:
    ids: list[str] = []
    in_route_table = False
    for line in read_text(root / "routing-table.md").splitlines():
        if line.startswith("| prec | category |"):
            in_route_table = True
            continue
        if in_route_table and line.startswith("## "):
            break
        if not in_route_table:
            continue
        match = re.match(r"\|\s*[^|]+\|\s*`([a-z][a-z0-9_]+)`\s*\|", line)
        if match:
            ids.append(match.group(1))
    return ids


def validate_model_ref(errors: list[str], location: str, record: dict) -> None:
    provider = record.get("provider")
    model = record.get("model")
    if provider not in VALID_PROVIDERS:
        errors.append(f"{location} invalid provider: {provider!r}")
    if model not in VALID_MODELS:
        errors.append(f"{location} invalid model: {model!r}")


def validate_gate_condition(errors: list[str], location: str, condition: object) -> None:
    if not isinstance(condition, dict):
        errors.append(f"{location} must be an object")
        return

    groups = [key for key in ("all_of", "any_of") if key in condition]
    has_comparison = {"field", "op", "value"} <= set(condition)
    if has_comparison:
        allowed = {"field", "op", "value"}
        extra = set(condition) - allowed
        if extra:
            errors.append(f"{location} has unexpected fields: {', '.join(sorted(extra))}")
        if not isinstance(condition.get("field"), str):
            errors.append(f"{location}.field must be a string")
        if condition.get("op") not in VALID_CONDITION_OPS:
            errors.append(f"{location}.op invalid: {condition.get('op')!r}")
    elif len(groups) == 1:
        group = groups[0]
        children = condition.get(group)
        if not isinstance(children, list) or not children:
            errors.append(f"{location}.{group} must be a non-empty array")
            return
        for idx, child in enumerate(children):
            validate_gate_condition(errors, f"{location}.{group}[{idx}]", child)
    else:
        errors.append(f"{location} must be a comparison or exactly one all_of/any_of group")


def validate_gate_action(errors: list[str], location: str, action: object) -> None:
    if not isinstance(action, dict):
        errors.append(f"{location} must be an object")
        return
    if not isinstance(action.get("type"), str):
        errors.append(f"{location}.type must be a string")
    if "target" not in action:
        errors.append(f"{location}.target missing")
    elif not isinstance(action.get("target"), dict):
        errors.append(f"{location}.target must be an object")


def iter_json_strings(value: object):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from iter_json_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_json_strings(child)


def check_json_model_refs(data: object) -> list[str]:
    tokens: set[str] = set()
    for text in iter_json_strings(data):
        tokens.update(MODEL_REF_RE.findall(text))
    invalid = sorted(token for token in tokens if token not in VALID_MODELS)
    if invalid:
        return ["assets/routing-table.json invalid model refs: " + ", ".join(invalid)]
    return []


def check_routing_table(root: Path) -> list[str]:
    errors: list[str] = []
    path = root / "assets" / "routing-table.json"
    try:
        data = json.loads(read_text(path))
    except FileNotFoundError:
        return ["assets/routing-table.json missing"]
    except json.JSONDecodeError as exc:
        return [f"assets/routing-table.json JSON parse error: {exc}"]

    metadata = data.get("metadata")
    expected_metadata = {
        "author": "Lexi Blackburn",
        "author_url": "https://github.com/Heretyc/",
        "version": "2.0.0",
        "generated_for": "subagent-mcp cross-provider work-category routing feature",
        "source": "phase-2-core-synthesis/2026-05-29",
        "generated": "2026-05",
    }
    if metadata != expected_metadata:
        errors.append("assets/routing-table.json metadata block does not match manifest")

    if data.get("schema_version") != "2.0.0":
        errors.append("assets/routing-table.json schema_version must be 2.0.0")
    if data.get("classification_precedence") != EXPECTED_PRECEDENCE:
        errors.append("classification_precedence does not match manifest spine")
    if data.get("default_category") != "fallback_default":
        errors.append("default_category must be fallback_default")

    hard_gates = data.get("hard_gates")
    if not isinstance(hard_gates, list):
        errors.append("hard_gates must be an array")
        hard_gate_ids: list[str] = []
    else:
        hard_gate_ids = [gate.get("id") for gate in hard_gates if isinstance(gate, dict)]
        if hard_gate_ids != EXPECTED_GATES:
            errors.append("hard_gates ids/order do not match manifest")
        for gate in hard_gates:
            if not isinstance(gate, dict) or set(gate) != {"id", "when", "action", "severity"}:
                errors.append(f"invalid hard gate record: {gate!r}")
                continue
            validate_gate_condition(errors, f"hard_gate {gate.get('id')}.when", gate.get("when"))
            validate_gate_action(errors, f"hard_gate {gate.get('id')}.action", gate.get("action"))
            if gate.get("severity") not in VALID_GATE_SEVERITIES:
                errors.append(f"hard_gate {gate.get('id')} invalid severity: {gate.get('severity')!r}")

    categories = data.get("categories")
    if not isinstance(categories, dict):
        errors.append("categories must be an object")
        categories = {}
    if list(categories.keys()) != EXPECTED_CATEGORIES:
        errors.append("categories keys/order do not match manifest spine")

    work_ids = extract_spine_ids(root, "work-categories.md")
    route_ids = extract_spine_ids(root, "routing-table.md")
    expected_set = set(EXPECTED_CATEGORIES)
    if work_ids != expected_set:
        errors.append(f"work-categories.md spine mismatch: {sorted(work_ids)}")
    if route_ids != expected_set:
        errors.append(f"routing-table.md spine mismatch: {sorted(route_ids)}")

    md_route_order = extract_routing_table_order(root)
    json_route_order = list(categories.keys())
    if md_route_order != json_route_order:
        errors.append(
            "routing-table.md/category JSON mirror drift: "
            f"md={md_route_order}, json={json_route_order}"
        )
    if md_route_order[:-1] != data.get("classification_precedence") or md_route_order[-1:] != ["fallback_default"]:
        errors.append("routing-table.md precedence order does not match classification_precedence")

    errors.extend(check_json_model_refs(data))

    gate_set = set(EXPECTED_GATES)
    for key, record in categories.items():
        if not isinstance(record, dict):
            errors.append(f"category {key} must be an object")
            continue
        missing = REQUIRED_CATEGORY_FIELDS - set(record)
        if missing:
            errors.append(f"category {key} missing fields: {', '.join(sorted(missing))}")
        if record.get("id") != key:
            errors.append(f"category {key} id field mismatch")
        if key in EXPECTED_CATEGORIES:
            expected_prec = 99 if key == "fallback_default" else EXPECTED_CATEGORIES.index(key) + 1
            if record.get("precedence") != expected_prec:
                errors.append(f"category {key} precedence mismatch")
        if not isinstance(record.get("classify_signals"), list):
            errors.append(f"category {key} classify_signals must be an array")
        if not isinstance(record.get("fallback"), list):
            errors.append(f"category {key} fallback must be an array")
        if not isinstance(record.get("risk_flags"), list):
            errors.append(f"category {key} risk_flags must be an array")
        gates = record.get("gates")
        if not isinstance(gates, list):
            errors.append(f"category {key} gates must be an array")
        else:
            bad_gates = [gate for gate in gates if gate not in gate_set]
            if bad_gates:
                errors.append(f"category {key} unknown gates: {bad_gates}")
        primary = record.get("primary")
        if isinstance(primary, dict):
            validate_model_ref(errors, f"category {key}.primary", primary)
        else:
            errors.append(f"category {key} primary must be an object")
        for idx, fallback in enumerate(record.get("fallback", [])):
            if isinstance(fallback, dict):
                validate_model_ref(errors, f"category {key}.fallback[{idx}]", fallback)
                if "effort" not in fallback:
                    errors.append(f"category {key}.fallback[{idx}] missing effort")
            else:
                errors.append(f"category {key}.fallback[{idx}] must be an object")
        synergy = record.get("synergy_pattern")
        if not isinstance(synergy, dict) or set(synergy) != {"id", "trigger"}:
            errors.append(f"category {key} synergy_pattern must contain id and trigger")

    if "global_invariants" not in data:
        errors.append("global_invariants missing")
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
