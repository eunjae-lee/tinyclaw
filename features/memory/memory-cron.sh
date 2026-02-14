#!/usr/bin/env bash
# Memory cron - runs hourly, handles all memory operations

# Use TINYCLAW_HOME if set, otherwise detect from script location
if [ -n "${TINYCLAW_HOME:-}" ]; then
    SCRIPT_DIR="$TINYCLAW_HOME"
else
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

export TINYCLAW_CONFIG_HOME="${TINYCLAW_CONFIG_HOME:-/Users/eunjae/workspace/everything/tinyclaw/config}"
export TINYCLAW_MEMORY_HOME="${TINYCLAW_MEMORY_HOME:-/Users/eunjae/workspace/everything/tinyclaw/memory}"

LOG_FILE="$TINYCLAW_CONFIG_HOME/logs/memory.log"
mkdir -p "$(dirname "$LOG_FILE")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# Always run ingestion
log "Running memory ingestion..."
node "$SCRIPT_DIR/dist/memory/index.js" ingest 2>&1 | tee -a "$LOG_FILE"

# Daily promotion at 4am
HOUR=$(date '+%H')
if [ "$HOUR" = "04" ]; then
    log "Running daily promotion..."
    node "$SCRIPT_DIR/dist/memory/index.js" promote daily 2>&1 | tee -a "$LOG_FILE"

    # Weekly promotion on Monday
    DOW=$(date '+%u')  # 1=Monday
    if [ "$DOW" = "1" ]; then
        log "Running weekly promotion..."
        node "$SCRIPT_DIR/dist/memory/index.js" promote weekly 2>&1 | tee -a "$LOG_FILE"
    fi
fi

log "Memory cron complete"
