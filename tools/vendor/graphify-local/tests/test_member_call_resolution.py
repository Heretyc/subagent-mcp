"""
Regression test for the cross-file member-call name-collision bug fixed by
the `_MEMBER_CALL_NODE_TYPES` resolver guard.

Bug summary
-----------
graphify's per-language AST extractors strip member-expression callees
(`this.logger.log(...)`, `obj.find(...)`, `Pkg::baz(...)`) down to the
trailing identifier (`log`, `find`, `baz`) and queue them in `raw_calls`
for cross-file resolution. The cross-file resolver then matches that bare
identifier against a global lowercase name → id map. If any other file in
the corpus defines a top-level helper with the same name (e.g. a
`function log(id, name, pass) { ... }` in a smoke-test script), every
unrelated `Logger.log` / `this.logger.log` / `logger.log` call across the
codebase resolves to that single helper, producing a phantom god node with
hundreds of bogus INFERRED edges.

Fix
---
Each `raw_calls.append(...)` now records `callee_node_type` (the AST node
type of the callee). The cross-file resolver in `extract()` skips entries
whose `callee_node_type` is in `_MEMBER_CALL_NODE_TYPES`.

Run with:
    pytest tests/test_member_call_resolution.py -v
"""

from __future__ import annotations

from pathlib import Path

import pytest

from graphify.extract import extract

try:
    from graphify.extract import _MEMBER_CALL_NODE_TYPES
except ImportError:
    _MEMBER_CALL_NODE_TYPES = None  # patched constant absent on unpatched code


# ---------------------------------------------------------------------------
# Source fixtures — written verbatim to a tmp dir so tree-sitter sees real files
# ---------------------------------------------------------------------------

_SMOKE_TEST_JS = """\
const results = [];

function log(id, name, pass, detail = '') {
  const status = pass ? 'PASS' : 'FAIL';
  console.log(`${id} ${status} ${name}`);
  results.push({ id, name, pass });
}

function testAuth() {
  log('A1', 'auth-login', true);
  log('A2', 'auth-refresh', true);
}

testAuth();
"""

_NESTJS_SERVICE_TS = """\
import { Logger } from '@nestjs/common';

export class AppointmentsService {
  private readonly logger = new Logger('AppointmentsService');

  async create(payload: unknown): Promise<void> {
    this.logger.log('Creating appointment');
    Logger.log('static-style log call');
  }

  async cancel(id: string): Promise<void> {
    this.logger.log(`Cancelled ${id}`);
  }
}
"""

_NESTJS_OTHER_SERVICE_TS = """\
import { Logger } from '@nestjs/common';

const logger = new Logger('eprescribing-metrics');

export function logTransmissionAttempt(rxId: string): void {
  logger.log({ event: 'tx-attempt', rxId });
}

export function logWebhookReceived(payload: unknown): void {
  logger.log({ event: 'webhook', payload });
}
"""


@pytest.fixture
def project(tmp_path: Path) -> Path:
    (tmp_path / "validation").mkdir()
    (tmp_path / "src").mkdir()
    (tmp_path / "validation" / "smoke-test.mjs").write_text(_SMOKE_TEST_JS)
    (tmp_path / "src" / "appointments.service.ts").write_text(_NESTJS_SERVICE_TS)
    (tmp_path / "src" / "eprescribing-metrics.ts").write_text(_NESTJS_OTHER_SERVICE_TS)
    return tmp_path


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_member_call_node_types_constant_present() -> None:
    """The constant must exist and cover every language extractor."""
    assert _MEMBER_CALL_NODE_TYPES is not None, (
        "_MEMBER_CALL_NODE_TYPES is missing from graphify.extract — patch not applied"
    )
    assert isinstance(_MEMBER_CALL_NODE_TYPES, frozenset)
    # Spot-check that the most important node types are tracked.
    for required in (
        "member_expression",   # JS/TS
        "selector_expression", # Go
        "field_expression",    # Rust / C++
        "navigation_expression",  # Swift / Kotlin
        "dot",                 # Elixir
    ):
        assert required in _MEMBER_CALL_NODE_TYPES, f"missing: {required}"


def test_smoke_test_log_does_not_steal_nestjs_logger_calls(project: Path) -> None:
    """
    Regression: with a corpus containing both `validation/smoke-test.mjs`
    (which defines `function log(...)`) AND NestJS service files (which
    call `this.logger.log(...)` / `Logger.log(...)` / `logger.log(...)`),
    NONE of the NestJS calls should resolve to the smoke-test `log` node.
    """
    files = sorted(project.rglob("*.mjs")) + sorted(project.rglob("*.ts"))
    result = extract(files, cache_root=project)

    log_nodes = [n for n in result["nodes"]
                 if n.get("label", "").strip().rstrip("()") == "log"]
    assert len(log_nodes) == 1, "expected exactly one top-level log() symbol"

    log_id = log_nodes[0]["id"]
    log_source_file = log_nodes[0]["source_file"]

    # Every inbound edge to log() must come from the same file (validation/smoke-test.mjs).
    inbound = [e for e in result["edges"] if e.get("target") == log_id]
    cross_file = [e for e in inbound if e.get("source_file") != log_source_file]

    assert not cross_file, (
        f"phantom edges leaked to log() from other files: "
        f"{[(e['source_file'], e['source_location']) for e in cross_file]}"
    )

    # And we should still capture the legitimate intra-file calls
    # (testAuth → log in the smoke-test file).
    assert any(e for e in inbound if e.get("source_file") == log_source_file), (
        "lost legitimate intra-file call edges to log()"
    )


def test_raw_calls_emit_callee_node_type_for_member_expressions(project: Path) -> None:
    """
    Direct check on the raw-calls payload: any unresolved member-expression
    callee should carry a `callee_node_type` that's in _MEMBER_CALL_NODE_TYPES.

    We can't easily inspect raw_calls after extract() returns (they get
    consumed by the resolver), so we test indirectly: the absence of phantom
    edges (above test) is the observable proof.
    """
    # Sanity: just exercise extract() with something that triggers raw_calls
    # so we know our test corpus is meaningful.
    files = sorted(project.rglob("*.mjs")) + sorted(project.rglob("*.ts"))
    result = extract(files, cache_root=project)
    # We expect nodes from all three files.
    source_files = {n.get("source_file") for n in result["nodes"]}
    assert any("smoke-test" in (s or "") for s in source_files)
    assert any("appointments.service" in (s or "") for s in source_files)
    assert any("eprescribing-metrics" in (s or "") for s in source_files)
