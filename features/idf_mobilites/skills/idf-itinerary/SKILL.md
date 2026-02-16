---
name: idf-itinerary
description: Plan a journey between two places in Ile-de-France. Use when the user asks how to get from A to B using public transit, needs directions, or wants to plan a route in Paris/IDF. Triggers include "how to get from", "route from X to Y", "itinerary", "directions to", "plan a trip", or transit navigation queries.
allowed-tools: Bash(tinyclaw feature idf_mobilites itinerary*)
---

# IDF Mobilites - Journey Planning

Plan public transit journeys between any two places in Ile-de-France (Paris region).

## Usage

```bash
# Basic journey (depart now)
tinyclaw feature idf_mobilites itinerary "Chatelet" "Gare du Nord"

# Depart at a specific time
tinyclaw feature idf_mobilites itinerary "Chatelet" "Gare du Nord" --depart-at "14:30"

# Arrive by a specific time
tinyclaw feature idf_mobilites itinerary "Chatelet" "Gare du Nord" --arrive-by "16:00"

# Limit transfers
tinyclaw feature idf_mobilites itinerary "Chatelet" "Gare du Nord" --max-transfers 1

# Filter transport modes
tinyclaw feature idf_mobilites itinerary "Chatelet" "Gare du Nord" --modes "metro,rer"

# Multiple route options
tinyclaw feature idf_mobilites itinerary "Chatelet" "Gare du Nord" --count 3

# Markdown output (for chat)
tinyclaw feature idf_mobilites itinerary "Chatelet" "Gare du Nord" --format markdown
```

## Workflow

1. Resolve both place names to navitia IDs
2. Query the journey planner API
3. Display step-by-step route with times, transfers, and walking segments

## Output

Shows departure/arrival times, duration, number of transfers, and detailed route steps including line names, boarding/alighting stations, and walking segments.
