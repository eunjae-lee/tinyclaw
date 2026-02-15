#!/usr/bin/env bash
# Heartbeat - Periodically prompts all agents via queue system

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TINYCLAW_CONFIG_HOME="${TINYCLAW_CONFIG_HOME:-$HOME/workspace/everything/tinyclaw/config}"
TINYCLAW_CONFIG_WORKSPACE="${TINYCLAW_CONFIG_WORKSPACE:-$HOME/workspace/everything/tinyclaw/workspace}"
LOG_FILE="$TINYCLAW_CONFIG_HOME/logs/heartbeat.log"
QUEUE_INCOMING="$TINYCLAW_CONFIG_HOME/queue/incoming"
QUEUE_OUTGOING="$TINYCLAW_CONFIG_HOME/queue/outgoing"
SETTINGS_FILE="$TINYCLAW_CONFIG_HOME/settings.json"

# Read interval from settings.json, default to 3600
if [ -f "$SETTINGS_FILE" ]; then
    if command -v jq &> /dev/null; then
        INTERVAL=$(jq -r '.monitoring.heartbeat_interval // empty' "$SETTINGS_FILE" 2>/dev/null)
    fi
fi
INTERVAL=${INTERVAL:-3600}

mkdir -p "$(dirname "$LOG_FILE")" "$QUEUE_INCOMING" "$QUEUE_OUTGOING"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "Heartbeat started (interval: ${INTERVAL}s)"

# Check if current time falls within any active_hours window
# Returns 0 (true) if active, 1 (false) if outside active hours
is_active_hours() {
    if [ ! -f "$SETTINGS_FILE" ] || ! command -v jq &> /dev/null; then
        return 0  # No config or no jq — default to active
    fi

    local RULES
    RULES=$(jq -r '.monitoring.active_hours // empty' "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$RULES" ] || [ "$RULES" = "null" ]; then
        return 0  # No active_hours configured — always active
    fi

    local RULE_COUNT
    RULE_COUNT=$(jq -r '.monitoring.active_hours | length' "$SETTINGS_FILE" 2>/dev/null)
    if [ "$RULE_COUNT" = "0" ]; then
        return 0
    fi

    # Current day (lowercase 3-letter) and time in minutes since midnight
    local TODAY NOW_H NOW_M NOW_MINS
    TODAY=$(date '+%a' | tr '[:upper:]' '[:lower:]')
    NOW_H=$(date '+%H')
    NOW_M=$(date '+%M')
    NOW_MINS=$(( 10#$NOW_H * 60 + 10#$NOW_M ))

    for i in $(seq 0 $((RULE_COUNT - 1))); do
        # Check if today matches any day in this rule
        local DAY_MATCH
        DAY_MATCH=$(jq -r ".monitoring.active_hours[$i].days[] | select(. == \"$TODAY\")" "$SETTINGS_FILE" 2>/dev/null)
        if [ -z "$DAY_MATCH" ]; then
            continue
        fi

        # Parse start/end times
        local START_STR END_STR START_MINS END_MINS
        START_STR=$(jq -r ".monitoring.active_hours[$i].start" "$SETTINGS_FILE" 2>/dev/null)
        END_STR=$(jq -r ".monitoring.active_hours[$i].end" "$SETTINGS_FILE" 2>/dev/null)
        START_MINS=$(( 10#${START_STR%%:*} * 60 + 10#${START_STR##*:} ))
        END_MINS=$(( 10#${END_STR%%:*} * 60 + 10#${END_STR##*:} ))

        if [ $NOW_MINS -ge $START_MINS ] && [ $NOW_MINS -lt $END_MINS ]; then
            return 0  # Within this active window
        fi
    done

    return 1  # No matching window — outside active hours
}

while true; do
    sleep "$INTERVAL"

    # Skip heartbeat if outside active hours
    if ! is_active_hours; then
        log "Heartbeat skipped - outside active hours"
        continue
    fi

    log "Heartbeat check - scanning all agents..."

    # Get all agents from settings
    if [ ! -f "$SETTINGS_FILE" ]; then
        log "WARNING: No settings file found, skipping heartbeat"
        continue
    fi

    # Get workspace path
    WORKSPACE_PATH=$(jq -r '.workspace.path // empty' "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$WORKSPACE_PATH" ]; then
        WORKSPACE_PATH="$TINYCLAW_CONFIG_WORKSPACE"
    fi

    # Get all agent IDs
    AGENT_IDS=$(jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$AGENT_IDS" ]; then
        log "No agents configured - using default agent"
        AGENT_IDS="default"
    fi

    AGENT_COUNT=0

    # Send heartbeat to each agent
    for AGENT_ID in $AGENT_IDS; do
        AGENT_COUNT=$((AGENT_COUNT + 1))

        # Get agent's working directory
        AGENT_DIR=$(jq -r "(.agents // {}).\"${AGENT_ID}\".working_directory // empty" "$SETTINGS_FILE" 2>/dev/null)
        if [ -z "$AGENT_DIR" ]; then
            AGENT_DIR="$WORKSPACE_PATH/$AGENT_ID"
        fi

        # Read agent-specific heartbeat.md (skip agents without one)
        HEARTBEAT_FILE="$AGENT_DIR/heartbeat.md"
        if [ ! -f "$HEARTBEAT_FILE" ]; then
            log "  → Agent @$AGENT_ID: no heartbeat.md, skipping"
            continue
        fi
        PROMPT=$(cat "$HEARTBEAT_FILE")
        log "  → Agent @$AGENT_ID: using heartbeat.md"

        # Generate unique message ID
        MESSAGE_ID="heartbeat_${AGENT_ID}_$(date +%s)_$$"

        # Write to queue with !agent_id routing prefix
        cat > "$QUEUE_INCOMING/${MESSAGE_ID}.json" << EOF
{
  "channel": "heartbeat",
  "sender": "System",
  "senderId": "heartbeat_${AGENT_ID}",
  "message": "!${AGENT_ID} ${PROMPT}",
  "timestamp": $(date +%s)000,
  "messageId": "$MESSAGE_ID"
}
EOF

        log "  ✓ Queued for @$AGENT_ID: $MESSAGE_ID"
    done

    log "Heartbeat sent to $AGENT_COUNT agent(s)"

    # Optional: wait and log responses
    sleep 10

    # Check for responses and log brief summaries
    for AGENT_ID in $AGENT_IDS; do
        MESSAGE_ID="heartbeat_${AGENT_ID}_"

        # Find response files for this agent's heartbeat
        for RESPONSE_FILE in "$QUEUE_OUTGOING"/${MESSAGE_ID}*.json; do
            if [ -f "$RESPONSE_FILE" ]; then
                RESPONSE=$(cat "$RESPONSE_FILE" | jq -r '.message' 2>/dev/null || echo "")
                if [ -n "$RESPONSE" ]; then
                    # Parse JSON status from heartbeat response
                    HB_STATUS=$(echo "$RESPONSE" | jq -r '.status // empty' 2>/dev/null)
                    if [ "$HB_STATUS" = "ok" ]; then
                        log "  ← @$AGENT_ID: OK (nothing to report)"
                    else
                        HB_MSG=$(echo "$RESPONSE" | jq -r '.message // empty' 2>/dev/null)
                        log "  ← @$AGENT_ID: ${HB_MSG:-${RESPONSE:0:80}}..."
                    fi
                    # Clean up response file
                    rm "$RESPONSE_FILE"
                fi
            fi
        done
    done
done
