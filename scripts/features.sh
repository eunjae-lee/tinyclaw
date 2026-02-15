#!/usr/bin/env bash
# Unified feature installer for TinyClaw
# Reads feature.json from each features/*/ directory to manage plists, skills, etc.
# Usage: scripts/features.sh {install|uninstall|list}

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
SKILLS_DIR="$HOME/.claude/skills"

# Core daemon plist
CORE_PLIST="$SCRIPT_DIR/config/com.tinyclaw.daemon.plist"

install_plist() {
    local plist="$1"
    local name=$(basename "$plist")
    local label="${name%.plist}"
    echo "  Installing $name..."

    # Unload if already loaded
    launchctl unload "$LAUNCH_AGENTS_DIR/$name" 2>/dev/null || true

    cp "$plist" "$LAUNCH_AGENTS_DIR/"
    launchctl load "$LAUNCH_AGENTS_DIR/$name"
    echo "    ✓ $label loaded"
}

uninstall_plist() {
    local plist="$1"
    local name=$(basename "$plist")
    local label="${name%.plist}"
    echo "  Uninstalling $name..."

    launchctl unload "$LAUNCH_AGENTS_DIR/$name" 2>/dev/null || true
    rm -f "$LAUNCH_AGENTS_DIR/$name"
    echo "    ✓ $label removed"
}

install() {
    mkdir -p "$LAUNCH_AGENTS_DIR"

    # Install core daemon plist
    if [ -f "$CORE_PLIST" ]; then
        echo "Core daemon:"
        install_plist "$CORE_PLIST"
        echo ""
    fi

    # Process each feature
    for feature_dir in "$SCRIPT_DIR"/features/*/; do
        [ -d "$feature_dir" ] || continue
        local feature_name=$(basename "$feature_dir")
        local feature_json="$feature_dir/feature.json"

        if [ ! -f "$feature_json" ]; then
            continue
        fi

        echo "Feature: $feature_name"

        # Install plists
        local plists=$(jq -r '.plists // [] | .[]' "$feature_json" 2>/dev/null)
        for plist_name in $plists; do
            local plist_path="$feature_dir/$plist_name"
            if [ -f "$plist_path" ]; then
                install_plist "$plist_path"
            else
                echo "  ⚠ Plist not found: $plist_name"
            fi
        done

        # Install skills
        local skills=$(jq -r '.skills // [] | .[]' "$feature_json" 2>/dev/null)
        for skill_name in $skills; do
            local skill_path="$feature_dir/skills/$skill_name"
            if [ -d "$skill_path" ]; then
                mkdir -p "$SKILLS_DIR"
                ln -sf "$skill_path" "$SKILLS_DIR/$skill_name"
                echo "  ✓ Skill linked: $skill_name"
            else
                echo "  ⚠ Skill directory not found: $skill_name"
            fi
        done

        echo ""
    done

    echo "All features installed. Use 'launchctl list | grep tinyclaw' to verify."
}

uninstall() {
    # Uninstall core daemon plist
    if [ -f "$CORE_PLIST" ]; then
        echo "Core daemon:"
        uninstall_plist "$CORE_PLIST"
        echo ""
    fi

    # Process each feature
    for feature_dir in "$SCRIPT_DIR"/features/*/; do
        [ -d "$feature_dir" ] || continue
        local feature_name=$(basename "$feature_dir")
        local feature_json="$feature_dir/feature.json"

        if [ ! -f "$feature_json" ]; then
            continue
        fi

        echo "Feature: $feature_name"

        # Uninstall plists
        local plists=$(jq -r '.plists // [] | .[]' "$feature_json" 2>/dev/null)
        for plist_name in $plists; do
            uninstall_plist "$feature_dir/$plist_name"
        done

        # Remove skill symlinks
        local skills=$(jq -r '.skills // [] | .[]' "$feature_json" 2>/dev/null)
        for skill_name in $skills; do
            if [ -L "$SKILLS_DIR/$skill_name" ]; then
                rm -f "$SKILLS_DIR/$skill_name"
                echo "  ✓ Skill unlinked: $skill_name"
            fi
        done

        echo ""
    done

    echo "All features uninstalled."
}

list() {
    echo "TinyClaw Features"
    echo "================="
    echo ""

    local found=false
    for feature_dir in "$SCRIPT_DIR"/features/*/; do
        [ -d "$feature_dir" ] || continue
        local feature_name=$(basename "$feature_dir")
        local feature_json="$feature_dir/feature.json"

        if [ ! -f "$feature_json" ]; then
            echo "  $feature_name (no feature.json)"
            continue
        fi

        found=true
        echo "  $feature_name:"

        # Show plists
        local plists=$(jq -r '.plists // [] | .[]' "$feature_json" 2>/dev/null)
        if [ -n "$plists" ]; then
            echo "    Plists:"
            for plist_name in $plists; do
                echo "      - $plist_name"
            done
        fi

        # Show skills
        local skills=$(jq -r '.skills // [] | .[]' "$feature_json" 2>/dev/null)
        if [ -n "$skills" ]; then
            echo "    Skills:"
            for skill_name in $skills; do
                echo "      - $skill_name"
            done
        fi

        # Show command
        local runner=$(jq -r '.command.runner // empty' "$feature_json" 2>/dev/null)
        if [ -n "$runner" ]; then
            local script=$(jq -r '.command.script // empty' "$feature_json" 2>/dev/null)
            echo "    Command: tinyclaw feature $feature_name [args]"
            echo "      → $runner $script"
        fi

        echo ""
    done

    if [ "$found" = false ]; then
        echo "  No features found."
    fi
}

case "${1:-}" in
    install)
        install
        ;;
    uninstall)
        uninstall
        ;;
    list)
        list
        ;;
    *)
        echo "Usage: $0 {install|uninstall|list}"
        echo ""
        echo "Manages TinyClaw features (plists, skills, CLI commands)."
        echo ""
        echo "Commands:"
        echo "  install    Install all feature plists and skill symlinks"
        echo "  uninstall  Remove all feature plists and skill symlinks"
        echo "  list       Show all features and their contributions"
        exit 1
        ;;
esac
