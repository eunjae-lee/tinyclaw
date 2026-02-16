---
name: idf-search
description: Search for transit stops, addresses, or points of interest in Ile-de-France. Use when the user asks to find a stop, station, address, or place in Paris/IDF, or needs a stop ID for other transit queries. Triggers include "find stop", "search station", "where is", "stop ID for", or place lookup queries.
allowed-tools: Bash(tinyclaw feature idf_mobilites search*), Bash(tinyclaw feature idf_mobilites nearby*)
---

# IDF Mobilites - Place Search

Search for transit stops, addresses, and points of interest in Ile-de-France.

## Usage

```bash
# Search for stops
tinyclaw feature idf_mobilites search "gare du nord"

# Filter by type
tinyclaw feature idf_mobilites search "opera" --type stop_area

# Search for POIs
tinyclaw feature idf_mobilites search "Tour Eiffel" --type poi

# JSON output (to get IDs)
tinyclaw feature idf_mobilites search "chatelet" --format json

# Find nearby stops by coordinates
tinyclaw feature idf_mobilites nearby 48.8566,2.3522

# Find nearby stops by place name
tinyclaw feature idf_mobilites nearby "Tour Eiffel" --radius 500
```

## Place Types

- `stop_area` - Transit stations/stops
- `stop_point` - Specific platforms/quays
- `address` - Street addresses
- `poi` - Points of interest
- `administrative_region` - Cities/districts

## Output

Returns name, type, and navitia ID for each result. Use the ID with other commands (departures, itinerary).
