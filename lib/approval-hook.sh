#!/usr/bin/env bash
# TinyClaw PreToolUse Approval Hook
# Called by Claude Code before each tool use. Reads JSON on stdin.
# Checks if tool is pre-approved; if not, writes a pending approval file
# and polls for a decision from the Discord client.

set -euo pipefail

# Read JSON from stdin
INPUT=$(cat)

# Extract tool_name from input
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
if [ -z "$TOOL_NAME" ]; then
    # No tool name — allow by default
    exit 0
fi

# Resolve TINYCLAW_HOME
if [ -z "${TINYCLAW_HOME:-}" ]; then
    TINYCLAW_HOME="$HOME/.tinyclaw"
fi

SETTINGS_FILE="$TINYCLAW_HOME/settings.json"
AGENT_ID="${TINYCLAW_AGENT_ID:-default}"

# If no settings file, allow everything
if [ ! -f "$SETTINGS_FILE" ]; then
    exit 0
fi

# Resolve allowed tools for this agent
# Check agent-specific permissions first, fall back to global
AGENT_TOOLS=$(jq -r --arg id "$AGENT_ID" '
    (.agents[$id].permissions.allowedTools // null) as $agent_tools |
    if $agent_tools != null then $agent_tools[]
    else (.permissions.allowedTools // [])[]
    end
' "$SETTINGS_FILE" 2>/dev/null || true)

# Check if tool is in the allowed list
if [ -n "$AGENT_TOOLS" ]; then
    while IFS= read -r allowed; do
        if [ "$allowed" = "$TOOL_NAME" ]; then
            # Tool is pre-approved
            exit 0
        fi
    done <<< "$AGENT_TOOLS"
fi

# If no allowed tools configured at all, allow everything (no restrictions)
TOTAL_TOOLS=$(jq -r --arg id "$AGENT_ID" '
    (.agents[$id].permissions.allowedTools // null) as $agent_tools |
    if $agent_tools != null then ($agent_tools | length)
    else ((.permissions.allowedTools // []) | length)
    end
' "$SETTINGS_FILE" 2>/dev/null || echo "0")

if [ "$TOTAL_TOOLS" = "0" ]; then
    exit 0
fi

# Tool is NOT pre-approved — request approval via file-based IPC

APPROVALS_DIR="$TINYCLAW_HOME/approvals"
PENDING_DIR="$APPROVALS_DIR/pending"
DECISIONS_DIR="$APPROVALS_DIR/decisions"
mkdir -p "$PENDING_DIR" "$DECISIONS_DIR"

# Generate request ID (macOS-compatible, no %N)
REQUEST_ID="$(date +%s)_$$"

# Extract a short summary of tool_input for the approval message
TOOL_INPUT_SUMMARY=$(echo "$INPUT" | jq -c '.tool_input // {}' 2>/dev/null | head -c 500)

# Write pending approval file
cat > "$PENDING_DIR/$REQUEST_ID.json" <<EOF
{
    "request_id": "$REQUEST_ID",
    "tool_name": "$TOOL_NAME",
    "tool_input_summary": $(echo "$TOOL_INPUT_SUMMARY" | jq -R .),
    "agent_id": "$AGENT_ID",
    "timestamp": $(date +%s),
    "notified": false
}
EOF

# Read timeout from settings (default 300 seconds)
TIMEOUT=$(jq -r '.approvals.timeout // 300' "$SETTINGS_FILE" 2>/dev/null || echo "300")

# Poll for decision
ELAPSED=0
POLL_INTERVAL=2

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
    DECISION_FILE="$DECISIONS_DIR/$REQUEST_ID.json"

    if [ -f "$DECISION_FILE" ]; then
        DECISION=$(jq -r '.decision // "deny"' "$DECISION_FILE" 2>/dev/null || echo "deny")

        # Clean up files
        rm -f "$PENDING_DIR/$REQUEST_ID.json" "$DECISION_FILE"

        case "$DECISION" in
            allow)
                echo '{"permissionDecision":"allow"}'
                exit 0
                ;;
            always_allow)
                # Add tool to settings.json allowedTools (use TOOL_NAME from stdin input)
                # Update settings.json: add to agent-specific or global allowedTools
                if jq -e --arg id "$AGENT_ID" '.agents[$id].permissions.allowedTools' "$SETTINGS_FILE" >/dev/null 2>&1; then
                    # Agent has its own allowedTools — add there
                    jq --arg id "$AGENT_ID" --arg tool "$TOOL_NAME" \
                        '.agents[$id].permissions.allowedTools += [$tool] | .agents[$id].permissions.allowedTools |= unique' \
                        "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
                else
                    # Add to global allowedTools
                    jq --arg tool "$TOOL_NAME" \
                        '.permissions.allowedTools = ((.permissions.allowedTools // []) + [$tool] | unique)' \
                        "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
                fi

                echo '{"permissionDecision":"allow"}'
                exit 0
                ;;
            deny|*)
                echo '{"permissionDecision":"deny"}'
                exit 0
                ;;
        esac
    fi

    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

# Timeout — deny and clean up
rm -f "$PENDING_DIR/$REQUEST_ID.json"
echo '{"permissionDecision":"deny"}'
exit 0
