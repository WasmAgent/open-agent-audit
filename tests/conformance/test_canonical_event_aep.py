"""
Conformance test: CanonicalEvent → AEP record adapter.

Run from repo root:
    pytest tests/conformance/test_canonical_event_aep.py -v
"""
from __future__ import annotations

import json
import subprocess
import textwrap
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GOLDEN_TRACE = REPO_ROOT / "examples" / "traces" / "golden-trace.jsonl"
ADAPTER_SRC = REPO_ROOT / "packages" / "adapters" / "src" / "aep-record.ts"


def load_golden_events() -> list[dict]:
    events = []
    with GOLDEN_TRACE.open() as fh:
        for line in fh:
            line = line.strip()
            if line:
                events.append(json.loads(line))
    return events


def run_adapter(events: list[dict]) -> dict:
    events_json = json.dumps(events)
    script = textwrap.dedent(f"""\
        import {{ fromCanonicalEvents }} from "{ADAPTER_SRC}";
        const events = {events_json};
        const record = fromCanonicalEvents(events);
        process.stdout.write(JSON.stringify(record));
    """)
    runner = REPO_ROOT / "tmp-conformance-aep-record.ts"
    runner.write_text(script, encoding="utf-8")
    try:
        result = subprocess.run(
            ["bun", str(runner)],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            timeout=30,
        )
    finally:
        runner.unlink(missing_ok=True)
    assert result.returncode == 0, (
        f"bun exited with code {result.returncode}.\nstderr:\n{result.stderr}"
    )
    return json.loads(result.stdout)


@pytest.fixture(scope="module")
def golden_events() -> list[dict]:
    return load_golden_events()


@pytest.fixture(scope="module")
def aep_record(golden_events: list[dict]) -> dict:
    return run_adapter(golden_events)


def test_adapter_src_exists():
    assert ADAPTER_SRC.exists(), f"Missing: {ADAPTER_SRC}"


def test_golden_trace_has_events(golden_events: list[dict]):
    assert len(golden_events) > 0


def test_record_required_fields(aep_record: dict):
    for field in ("schema_version", "run_id", "model_id", "created_at_ms"):
        assert field in aep_record, f"Missing required field: {field}"


def test_record_schema_version(aep_record: dict):
    assert aep_record["schema_version"] == "aep/v0.2"


def test_record_run_id_matches_events(golden_events: list[dict], aep_record: dict):
    assert aep_record["run_id"] == golden_events[0]["run_id"]


def test_actions_count_matches_tool_calls(golden_events: list[dict], aep_record: dict):
    tool_call_count = sum(1 for e in golden_events if e.get("type") == "tool_call")
    assert len(aep_record.get("actions", [])) == tool_call_count


def test_actions_have_required_fields(aep_record: dict):
    for action in aep_record.get("actions", []):
        for field in ("action_id", "tool_name", "state_changing", "timestamp_ms"):
            assert field in action, f"Action missing: {field}"


def test_tool_names_round_trip(golden_events: list[dict], aep_record: dict):
    expected = [
        e["tool"]["name"]
        for e in golden_events
        if e.get("type") == "tool_call" and "tool" in e
    ]
    actual = [a["tool_name"] for a in aep_record.get("actions", [])]
    assert actual == expected


def test_policy_decisions_produce_capability_decisions(
    golden_events: list[dict], aep_record: dict
):
    policy_count = sum(1 for e in golden_events if e.get("type") == "policy_decision")
    assert len(aep_record.get("capability_decisions", [])) == policy_count


def test_verifier_results_all_failed(aep_record: dict):
    for vr in aep_record.get("verifier_results", []):
        assert vr.get("passed") is False


def test_empty_events_raises():
    script = textwrap.dedent(f"""\
        import {{ fromCanonicalEvents }} from "{ADAPTER_SRC}";
        try {{
          fromCanonicalEvents([]);
          process.exit(1);
        }} catch (e) {{
          process.exit(0);
        }}
    """)
    runner = REPO_ROOT / "tmp-conformance-empty.ts"
    runner.write_text(script, encoding="utf-8")
    try:
        result = subprocess.run(["bun", str(runner)], capture_output=True, text=True,
                                cwd=REPO_ROOT, timeout=10)
    finally:
        runner.unlink(missing_ok=True)
    assert result.returncode == 0, "fromCanonicalEvents([]) should have thrown"
