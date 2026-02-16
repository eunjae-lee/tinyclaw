---
name: idf-status
description: Check service status and disruptions on Ile-de-France transit network. Use when the user asks about service disruptions, delays, line status, or whether transit is running normally. Triggers include "is the metro running", "any disruptions", "line status", "service alerts", "delays on", or transit status queries.
allowed-tools: Bash(tinyclaw feature idf_mobilites status*)
---

# IDF Mobilites - Service Status

Check current service disruptions and alerts on the Ile-de-France transit network.

## Usage

```bash
# Show all current disruptions
tinyclaw feature idf_mobilites status

# Check specific line
tinyclaw feature idf_mobilites status --line "Metro 4"
tinyclaw feature idf_mobilites status --line "RER B"

# Markdown output (for chat)
tinyclaw feature idf_mobilites status --format markdown

# JSON output
tinyclaw feature idf_mobilites status --format json
```

## Line Name Format

Use natural names like:
- `Metro 1`, `Metro 4`, `Metro 14`
- `RER A`, `RER B`, `RER D`
- `Bus 29`, `Tram 3`

Or navitia line IDs like `line:IDFM:C01374`.

## Output

Shows severity, affected lines, cause, status, and message text for each disruption.
