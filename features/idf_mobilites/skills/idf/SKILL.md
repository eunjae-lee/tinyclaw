---
name: idf
description: Ile-de-France transit assistant. Use for any public transport query in Paris/IDF region — departures, journey planning, stop search, disruptions. Supports station aliases (A-F) for frequent stations. Triggers include "timetable", "departures", "next train", "how to get to", "itinerary", "disruptions", "transit", or any IDF Mobilites query.
allowed-tools: Bash(tinyclaw feature idf_mobilites *)
---

# IDF Mobilites - Transit Assistant

Your Ile-de-France public transit assistant. Covers departures, journey planning, stop search, nearby stops, and service disruptions.

## Station Aliases

The user has saved these frequently-used stations:

| Alias | Station |
|-------|---------|
| **A** | Ermont Halte |
| **B** | Cernay |
| **C** | Ermont Eaubonne |
| **D** | Saint Denis |
| **E** | Stade de France Saint Denis |
| **F** | Gare Du Nord |

When the user refers to a station by its letter alias (e.g. "A", "from B to F"), **always substitute the full station name** before running the command.

When the user asks to "show my list" or "show aliases", display the table above.

## Available Commands

### Departures (timetable at a stop)
```bash
tinyclaw feature idf_mobilites departures "Ermont Halte" --format markdown
tinyclaw feature idf_mobilites departures "Gare Du Nord" --count 10 --format markdown
```

### Journey Planning (from A to B)
```bash
tinyclaw feature idf_mobilites itinerary "Ermont Halte" "Gare Du Nord" --format markdown
tinyclaw feature idf_mobilites itinerary "Cernay" "Saint Denis" --depart-at "08:30" --format markdown
```

### Search for stops/places
```bash
tinyclaw feature idf_mobilites search "opera" --format markdown
tinyclaw feature idf_mobilites search "chatelet" --type stop_area --format markdown
```

### Nearby stops
```bash
tinyclaw feature idf_mobilites nearby "Ermont Halte" --radius 500 --format markdown
tinyclaw feature idf_mobilites nearby 48.8566,2.3522 --format markdown
```

### Service disruptions
```bash
tinyclaw feature idf_mobilites status --format markdown
tinyclaw feature idf_mobilites status --line "RER C" --format markdown
```

## How to Handle Requests

1. **"show me my list"** — Display the station aliases table above
2. **"timetable of A"** or **"departures at C"** — Resolve alias, run `departures` with `--format markdown`
3. **"when is the train from A to F"** or **"itinerary B to D"** — Resolve aliases, run `itinerary` with `--format markdown`
4. **"any disruptions?"** or **"is RER C running?"** — Run `status` with `--format markdown`
5. **"find stop X"** — Run `search` with `--format markdown`
6. **"nearby stops"** — Run `nearby` with `--format markdown`

Always use `--format markdown` for readable chat output.
