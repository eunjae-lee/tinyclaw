#!/usr/bin/env bash
# Centralized launchd management for all TinyClaw features
# Usage: scripts/launchd.sh {install|uninstall}

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

# Core daemon plist
CORE_PLISTS=(
    "$SCRIPT_DIR/config/com.tinyclaw.daemon.plist"
)

# Collect all feature plists
FEATURE_PLISTS=()
for plist in "$SCRIPT_DIR"/features/*/com.tinyclaw.*.plist; do
    [ -f "$plist" ] && FEATURE_PLISTS+=("$plist")
done

ALL_PLISTS=("${CORE_PLISTS[@]}" "${FEATURE_PLISTS[@]}")

install() {
    mkdir -p "$LAUNCH_AGENTS_DIR"
    for plist in "${ALL_PLISTS[@]}"; do
        local name=$(basename "$plist")
        local label="${name%.plist}"
        echo "Installing $name..."

        # Unload if already loaded
        launchctl unload "$LAUNCH_AGENTS_DIR/$name" 2>/dev/null || true

        cp "$plist" "$LAUNCH_AGENTS_DIR/"
        launchctl load "$LAUNCH_AGENTS_DIR/$name"
        echo "  ✓ $label loaded"
    done
    echo ""
    echo "All services installed. Use 'launchctl list | grep tinyclaw' to verify."
}

uninstall() {
    for plist in "${ALL_PLISTS[@]}"; do
        local name=$(basename "$plist")
        local label="${name%.plist}"
        echo "Uninstalling $name..."

        launchctl unload "$LAUNCH_AGENTS_DIR/$name" 2>/dev/null || true
        rm -f "$LAUNCH_AGENTS_DIR/$name"
        echo "  ✓ $label removed"
    done
    echo ""
    echo "All services uninstalled."
}

case "${1:-}" in
    install)
        install
        ;;
    uninstall)
        uninstall
        ;;
    *)
        echo "Usage: $0 {install|uninstall}"
        echo ""
        echo "Manages launchd services for TinyClaw core + all features."
        echo ""
        echo "Detected plists:"
        for plist in "${ALL_PLISTS[@]}"; do
            echo "  $(basename "$plist")"
        done
        exit 1
        ;;
esac
