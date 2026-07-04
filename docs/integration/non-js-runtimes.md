# Non-JS Runtime Integration Guide

OpenAgentAudit's core audit engine runs on Node.js / Bun, but any runtime that can emit JSON and invoke a CLI subprocess can integrate with the audit pipeline.

The minimal integration flow is:

1. **Emit** an AEP JSON record (or CanonicalEvents JSONL) from your agent runtime.
2. **Call** the CLI to convert/audit the record.
3. **Consume** the JSON/Markdown/HTML report output.

---

## Python

### Option A: Subprocess CLI invocation

```python
import subprocess
import json
from pathlib import Path

def audit_aep_record(aep_record: dict, output_path: str = "report.json") -> dict:
    """
    Run an OpenAgentAudit report on a single AEP record.

    Prerequisites:
        npm install -g @openagentaudit/cli
        # or use npx (no global install needed)
    """
    input_path = "/tmp/aep_input.json"
    Path(input_path).write_text(json.dumps(aep_record))

    # Step 1: Convert AEP record to CanonicalEvents JSONL
    result = subprocess.run(
        ["npx", "@openagentaudit/cli", "from-aep", input_path],
        capture_output=True, text=True, check=True
    )
    events_jsonl = result.stdout

    # Step 2: Write events to a temp file
    events_path = "/tmp/events.jsonl"
    Path(events_path).write_text(events_jsonl)

    # Step 3: Generate report
    result = subprocess.run(
        ["npx", "@openagentaudit/cli", "report", events_path, "--format", "json"],
        capture_output=True, text=True, check=True
    )

    report = json.loads(result.stdout)

    # Optionally save to file
    Path(output_path).write_text(json.dumps(report, indent=2))
    return report
```

### Option B: Batch processing multiple AEP records

```python
import subprocess
import json
from pathlib import Path

def audit_batch(aep_records: list[dict], output_path: str = "report.json") -> dict:
    """
    Audit multiple AEP records as one aggregate report.
    Uses the --batch flag to merge events with hash-chain continuity.
    """
    # Write all records as a JSON array
    input_path = "/tmp/aep_batch.json"
    Path(input_path).write_text(json.dumps(aep_records))

    # Convert batch to CanonicalEvents JSONL
    result = subprocess.run(
        ["npx", "@openagentaudit/cli", "from-aep", input_path, "--batch"],
        capture_output=True, text=True, check=True
    )

    events_path = "/tmp/events.jsonl"
    Path(events_path).write_text(result.stdout)

    # Generate aggregate report
    result = subprocess.run(
        ["npx", "@openagentaudit/cli", "report", events_path, "--format", "json"],
        capture_output=True, text=True, check=True
    )

    report = json.loads(result.stdout)
    Path(output_path).write_text(json.dumps(report, indent=2))
    return report
```

### Option C: Validate against JSON Schema directly

If you only need schema validation without the full audit engine, you can use the
JSON Schema files directly with a Python JSON Schema validator:

```python
import jsonschema
import json
from pathlib import Path

# Load the schema (from the schemas/ directory in this repo)
schema = json.loads(Path("schemas/v0.1/canonical-event.schema.json").read_text())

# Validate an event
event = {
    "schema_version": "open-agent-audit/v0.1",
    "run_id": "run-001",
    "agent_id": "my-agent",
    "model_id": "gpt-4",
    "event_id": "evt-001",
    "timestamp": "2026-01-01T00:00:00Z",
    "type": "tool_call",
    "actor": "agent",
    "tool": {"name": "bash"}
}

jsonschema.validate(event, schema)  # Raises ValidationError if invalid
```

---

## Go

### Option A: Subprocess CLI invocation

```go
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
)

// AuditAEPRecord converts an AEP record to a report via the CLI.
func AuditAEPRecord(aepRecord map[string]interface{}) (map[string]interface{}, error) {
	// Write AEP record to temp file
	inputFile, err := os.CreateTemp("", "aep-*.json")
	if err != nil {
		return nil, fmt.Errorf("create temp file: %w", err)
	}
	defer os.Remove(inputFile.Name())

	if err := json.NewEncoder(inputFile).Encode(aepRecord); err != nil {
		return nil, fmt.Errorf("write AEP record: %w", err)
	}
	inputFile.Close()

	// Step 1: Convert AEP to CanonicalEvents JSONL
	cmd := exec.Command("npx", "@openagentaudit/cli", "from-aep", inputFile.Name())
	eventsJSONL, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("from-aep: %w", err)
	}

	// Write events to temp file
	eventsFile, err := os.CreateTemp("", "events-*.jsonl")
	if err != nil {
		return nil, fmt.Errorf("create events file: %w", err)
	}
	defer os.Remove(eventsFile.Name())

	if _, err := eventsFile.Write(eventsJSONL); err != nil {
		return nil, fmt.Errorf("write events: %w", err)
	}
	eventsFile.Close()

	// Step 2: Generate report
	cmd = exec.Command("npx", "@openagentaudit/cli", "report", eventsFile.Name(), "--format", "json")
	reportJSON, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("report: %w", err)
	}

	var report map[string]interface{}
	if err := json.Unmarshal(reportJSON, &report); err != nil {
		return nil, fmt.Errorf("parse report: %w", err)
	}

	return report, nil
}

func main() {
	// Example usage
	record := map[string]interface{}{
		"schema_version": "aep/v0.2",
		"run_id":         "run-go-001",
		"created_at_ms":  1700000000000,
		"signature": map[string]interface{}{
			"alg":    "ed25519",
			"key_id": "my-key",
			"sig":    "deadbeef",
		},
	}

	report, err := AuditAEPRecord(record)
	if err != nil {
		fmt.Fprintf(os.Stderr, "audit failed: %v\n", err)
		os.Exit(1)
	}

	out, _ := json.MarshalIndent(report, "", "  ")
	fmt.Println(string(out))
}
```

### Option B: Batch processing

```go
// AuditBatch processes multiple AEP records as one aggregate report.
func AuditBatch(records []map[string]interface{}) (map[string]interface{}, error) {
	inputFile, err := os.CreateTemp("", "aep-batch-*.json")
	if err != nil {
		return nil, err
	}
	defer os.Remove(inputFile.Name())

	if err := json.NewEncoder(inputFile).Encode(records); err != nil {
		return nil, err
	}
	inputFile.Close()

	// Use --batch flag for aggregate conversion
	cmd := exec.Command("npx", "@openagentaudit/cli", "from-aep", inputFile.Name(), "--batch")
	eventsJSONL, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	eventsFile, err := os.CreateTemp("", "events-*.jsonl")
	if err != nil {
		return nil, err
	}
	defer os.Remove(eventsFile.Name())
	os.WriteFile(eventsFile.Name(), eventsJSONL, 0644)

	cmd = exec.Command("npx", "@openagentaudit/cli", "report", eventsFile.Name(), "--format", "json")
	reportJSON, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var report map[string]interface{}
	json.Unmarshal(reportJSON, &report)
	return report, nil
}
```

---

## JSON Schema Reference

The canonical event schemas are located in the repository at:

```
schemas/v0.1/canonical-event.schema.json
schemas/v0.1/audit-run.schema.json
schemas/v0.1/finding.schema.json
schemas/v0.1/risk-score.schema.json
```

These can be used by any language with a JSON Schema validator library for offline validation without invoking the CLI.

---

## Minimal End-to-End Flow

Regardless of language, the integration pattern is:

```
Your Agent Runtime
    |
    v
[Emit AEP JSON record]
    |
    v
npx @openagentaudit/cli from-aep input.json -o events.jsonl
    |
    v
npx @openagentaudit/cli report events.jsonl --format json -o report.json
    |
    v
[Consume report.json in your application]
```

For batch processing (multiple agent runs):

```
[Emit N AEP JSON records as JSON array or JSONL]
    |
    v
npx @openagentaudit/cli from-aep batch.json --batch > events.jsonl
    |
    v
npx @openagentaudit/cli report events.jsonl --format json > report.json
```
