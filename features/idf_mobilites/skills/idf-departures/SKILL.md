---
name: idf-departures
description: Show next departures at a transit stop in Ile-de-France. Use when the user asks about upcoming trains, buses, metros, or departures at a specific stop or station. Triggers include "next train at", "departures at", "when is the next metro", "bus schedule at", or any transit departure query for Paris/IDF region.
allowed-tools: Bash(tinyclaw feature idf_mobilites departures*)
---

# IDF Mobilites - Next Departures

Show real-time departure times for any transit stop in Ile-de-France (Paris region).

## Usage

```bash
# By stop name
tinyclaw feature idf_mobilites departures "Chatelet"

# By stop ID (for exact match)
tinyclaw feature idf_mobilites departures --stop-id "STIF:StopArea:SP:71517:"

# Filter by line
tinyclaw feature idf_mobilites departures "Chatelet" --line "STIF:Line::C01374:"

# Limit results
tinyclaw feature idf_mobilites departures "Chatelet" --count 10

# Markdown output (for chat)
tinyclaw feature idf_mobilites departures "Chatelet" --format markdown

# JSON output
tinyclaw feature idf_mobilites departures "Chatelet" --format json
```

## Workflow

1. Search for the stop name to get its ID (done automatically)
2. Fetch real-time departures from the PRIM API
3. Display grouped by line/direction with status indicators

## Output

Shows line, direction, expected time (relative), and status (On Time, Delayed, Cancelled).
