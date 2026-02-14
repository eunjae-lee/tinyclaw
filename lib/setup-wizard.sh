#!/usr/bin/env bash
# TinyClaw Setup Wizard

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TINYCLAW_CONFIG_HOME="${TINYCLAW_CONFIG_HOME:-$HOME/.tinyclaw/config}"
TINYCLAW_CONFIG_WORKSPACE="${TINYCLAW_CONFIG_WORKSPACE:-$HOME/.tinyclaw/workspace}"
SETTINGS_FILE="$TINYCLAW_CONFIG_HOME/settings.json"
CREDENTIALS_FILE="$TINYCLAW_CONFIG_HOME/credentials.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  TinyClaw - Setup Wizard${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# --- Discord bot token ---
echo "Enter your Discord bot token:"
echo -e "${YELLOW}(Get one at: https://discord.com/developers/applications)${NC}"
echo ""
read -rp "Token: " DISCORD_TOKEN

if [ -z "$DISCORD_TOKEN" ]; then
    echo -e "${RED}Discord bot token is required${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Discord token saved${NC}"
echo ""

# Provider selection
echo "Which AI provider?"
echo ""
echo "  1) Anthropic (Claude)  (recommended)"
echo "  2) OpenAI (Codex/GPT)"
echo ""
read -rp "Choose [1-2]: " PROVIDER_CHOICE

case "$PROVIDER_CHOICE" in
    1) PROVIDER="anthropic" ;;
    2) PROVIDER="openai" ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
echo -e "${GREEN}✓ Provider: $PROVIDER${NC}"
echo ""

# Model selection based on provider
if [ "$PROVIDER" = "anthropic" ]; then
    echo "Which Claude model?"
    echo ""
    echo "  1) Sonnet  (fast, recommended)"
    echo "  2) Opus    (smartest)"
    echo ""
    read -rp "Choose [1-2]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        1) MODEL="sonnet" ;;
        2) MODEL="opus" ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
    echo -e "${GREEN}✓ Model: $MODEL${NC}"
    echo ""
else
    # OpenAI models
    echo "Which OpenAI model?"
    echo ""
    echo "  1) GPT-5.3 Codex  (recommended)"
    echo "  2) GPT-5.2"
    echo ""
    read -rp "Choose [1-2]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        1) MODEL="gpt-5.3-codex" ;;
        2) MODEL="gpt-5.2" ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
    echo -e "${GREEN}✓ Model: $MODEL${NC}"
    echo ""
fi

# --- Discord admin user ID for tool approvals ---
echo "Enter your Discord user ID for tool approvals:"
echo -e "${YELLOW}(Right-click your name in Discord → Copy User ID. Enable Developer Mode in Discord settings if needed.)${NC}"
echo ""
read -rp "Discord user ID [optional]: " ADMIN_USER_ID
if [ -n "$ADMIN_USER_ID" ]; then
    echo -e "${GREEN}✓ Admin user ID saved${NC}"
else
    echo -e "${YELLOW}⚠ Skipped — interactive tool approvals will not be available${NC}"
fi
echo ""

# Heartbeat interval
echo "Heartbeat interval (seconds)?"
echo -e "${YELLOW}(How often Claude checks in proactively)${NC}"
echo ""
read -rp "Interval in seconds [default: 3600]: " HEARTBEAT_INPUT
HEARTBEAT_INTERVAL=${HEARTBEAT_INPUT:-3600}

if ! [[ "$HEARTBEAT_INTERVAL" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}Invalid interval, using default 3600${NC}"
    HEARTBEAT_INTERVAL=3600
fi
echo -e "${GREEN}✓ Heartbeat interval: ${HEARTBEAT_INTERVAL}s${NC}"
echo ""

# Workspace configuration
echo "Workspace path (where agent directories will be stored)?"
echo -e "${YELLOW}(Default: $TINYCLAW_CONFIG_WORKSPACE)${NC}"
echo ""
read -rp "Workspace path [default: $TINYCLAW_CONFIG_WORKSPACE]: " WORKSPACE_INPUT
WORKSPACE_PATH=${WORKSPACE_INPUT:-$TINYCLAW_CONFIG_WORKSPACE}
WORKSPACE_NAME=$(basename "$WORKSPACE_PATH")
echo -e "${GREEN}✓ Workspace: $WORKSPACE_PATH${NC}"
echo ""

# Default agent name
echo "Name your default agent?"
echo -e "${YELLOW}(The main AI assistant you'll interact with)${NC}"
echo ""
read -rp "Default agent name [default: assistant]: " DEFAULT_AGENT_INPUT
DEFAULT_AGENT_NAME=${DEFAULT_AGENT_INPUT:-assistant}
# Clean agent name
DEFAULT_AGENT_NAME=$(echo "$DEFAULT_AGENT_NAME" | tr ' ' '-' | tr -cd 'a-zA-Z0-9_-' | tr '[:upper:]' '[:lower:]')
echo -e "${GREEN}✓ Default agent: $DEFAULT_AGENT_NAME${NC}"
echo ""

# --- Additional Agents (optional) ---
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Additional Agents (Optional)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "You can set up multiple agents with different roles, models, and working directories."
echo "Users route messages with '@agent_id message' in chat."
echo ""
read -rp "Set up additional agents? [y/N]: " SETUP_AGENTS

AGENTS_JSON=""
# Always create the default agent
DEFAULT_AGENT_DIR="$WORKSPACE_PATH/$DEFAULT_AGENT_NAME"
# Capitalize first letter of agent name (proper bash method)
DEFAULT_AGENT_DISPLAY="$(tr '[:lower:]' '[:upper:]' <<< "${DEFAULT_AGENT_NAME:0:1}")${DEFAULT_AGENT_NAME:1}"
AGENTS_JSON='"agents": {'
AGENTS_JSON="$AGENTS_JSON \"$DEFAULT_AGENT_NAME\": { \"name\": \"$DEFAULT_AGENT_DISPLAY\", \"provider\": \"$PROVIDER\", \"model\": \"$MODEL\", \"working_directory\": \"$DEFAULT_AGENT_DIR\" }"

ADDITIONAL_AGENTS=()  # Track additional agent IDs for directory creation

if [[ "$SETUP_AGENTS" =~ ^[yY] ]]; then

    # Add more agents
    ADDING_AGENTS=true
    while [ "$ADDING_AGENTS" = true ]; do
        echo ""
        read -rp "Add another agent? [y/N]: " ADD_MORE
        if [[ ! "$ADD_MORE" =~ ^[yY] ]]; then
            ADDING_AGENTS=false
            continue
        fi

        read -rp "  Agent ID (lowercase, no spaces): " NEW_AGENT_ID
        NEW_AGENT_ID=$(echo "$NEW_AGENT_ID" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
        if [ -z "$NEW_AGENT_ID" ]; then
            echo -e "${RED}  Invalid ID, skipping${NC}"
            continue
        fi

        read -rp "  Display name: " NEW_AGENT_NAME
        [ -z "$NEW_AGENT_NAME" ] && NEW_AGENT_NAME="$NEW_AGENT_ID"

        echo "  Provider: 1) Anthropic  2) OpenAI"
        read -rp "  Choose [1-2, default: 1]: " NEW_PROVIDER_CHOICE
        case "$NEW_PROVIDER_CHOICE" in
            2) NEW_PROVIDER="openai" ;;
            *) NEW_PROVIDER="anthropic" ;;
        esac

        if [ "$NEW_PROVIDER" = "anthropic" ]; then
            echo "  Model: 1) Sonnet  2) Opus"
            read -rp "  Choose [1-2, default: 1]: " NEW_MODEL_CHOICE
            case "$NEW_MODEL_CHOICE" in
                2) NEW_MODEL="opus" ;;
                *) NEW_MODEL="sonnet" ;;
            esac
        else
            echo "  Model: 1) GPT-5.3 Codex  2) GPT-5.2"
            read -rp "  Choose [1-2, default: 1]: " NEW_MODEL_CHOICE
            case "$NEW_MODEL_CHOICE" in
                2) NEW_MODEL="gpt-5.2" ;;
                *) NEW_MODEL="gpt-5.3-codex" ;;
            esac
        fi

        NEW_AGENT_DIR="$WORKSPACE_PATH/$NEW_AGENT_ID"

        AGENTS_JSON="$AGENTS_JSON, \"$NEW_AGENT_ID\": { \"name\": \"$NEW_AGENT_NAME\", \"provider\": \"$NEW_PROVIDER\", \"model\": \"$NEW_MODEL\", \"working_directory\": \"$NEW_AGENT_DIR\" }"

        # Track this agent for directory creation later
        ADDITIONAL_AGENTS+=("$NEW_AGENT_ID")

        echo -e "  ${GREEN}✓ Agent '${NEW_AGENT_ID}' added${NC}"
    done
fi

AGENTS_JSON="$AGENTS_JSON },"

# Write credentials.json (secrets — git-ignored)
mkdir -p "$TINYCLAW_CONFIG_HOME"

cat > "$CREDENTIALS_FILE" <<EOF
{
  "channels": {
    "discord": {
      "bot_token": "${DISCORD_TOKEN}"
    }
  }
}
EOF

# Normalize credentials JSON with jq
if command -v jq &> /dev/null; then
    tmp_file="$CREDENTIALS_FILE.tmp"
    jq '.' "$CREDENTIALS_FILE" > "$tmp_file" 2>/dev/null && mv "$tmp_file" "$CREDENTIALS_FILE"
fi

# Write settings.json (behavioral config — committable)
if [ "$PROVIDER" = "anthropic" ]; then
    MODELS_SECTION='"models": { "provider": "anthropic", "anthropic": { "model": "'"${MODEL}"'" } }'
else
    MODELS_SECTION='"models": { "provider": "openai", "openai": { "model": "'"${MODEL}"'" } }'
fi

# Build optional admin_user_id line
ADMIN_LINE=""
if [ -n "$ADMIN_USER_ID" ]; then
    ADMIN_LINE="\"admin_user_id\": \"${ADMIN_USER_ID}\","
fi

cat > "$SETTINGS_FILE" <<EOF
{
  "workspace": {
    "path": "${WORKSPACE_PATH}",
    "name": "${WORKSPACE_NAME}"
  },
  "channels": {
    "enabled": ["discord"]
  },
  ${ADMIN_LINE}
  ${AGENTS_JSON}
  ${MODELS_SECTION},
  "permissions": {
    "allowedTools": ["Read", "Grep", "Glob", "Write", "Edit"],
    "deniedTools": []
  },
  "monitoring": {
    "heartbeat_interval": ${HEARTBEAT_INTERVAL}
  }
}
EOF

# Normalize settings JSON with jq
if command -v jq &> /dev/null; then
    tmp_file="$SETTINGS_FILE.tmp"
    jq '.' "$SETTINGS_FILE" > "$tmp_file" 2>/dev/null && mv "$tmp_file" "$SETTINGS_FILE"
fi

# Create config home directories
mkdir -p "$TINYCLAW_CONFIG_HOME"
mkdir -p "$TINYCLAW_CONFIG_HOME/logs"
mkdir -p "$TINYCLAW_CONFIG_HOME/files"
if [ -d "$PROJECT_ROOT/.claude" ]; then
    cp -r "$PROJECT_ROOT/.claude" "$TINYCLAW_CONFIG_HOME/"
fi
if [ -f "$PROJECT_ROOT/templates/heartbeat.md" ]; then
    cp "$PROJECT_ROOT/templates/heartbeat.md" "$TINYCLAW_CONFIG_HOME/"
fi
if [ -f "$PROJECT_ROOT/templates/AGENTS.md" ]; then
    cp "$PROJECT_ROOT/templates/AGENTS.md" "$TINYCLAW_CONFIG_HOME/"
fi
if [ -f "$PROJECT_ROOT/templates/config.gitignore" ]; then
    cp "$PROJECT_ROOT/templates/config.gitignore" "$TINYCLAW_CONFIG_HOME/.gitignore"
fi
echo -e "${GREEN}✓ Created config home: $TINYCLAW_CONFIG_HOME${NC}"

# Create workspace directory
mkdir -p "$WORKSPACE_PATH"
echo -e "${GREEN}✓ Created workspace: $WORKSPACE_PATH${NC}"

# Create default agent directory with config files
mkdir -p "$DEFAULT_AGENT_DIR"
if [ -d "$TINYCLAW_CONFIG_HOME/.claude" ]; then
    cp -r "$TINYCLAW_CONFIG_HOME/.claude" "$DEFAULT_AGENT_DIR/"
fi
if [ -f "$TINYCLAW_CONFIG_HOME/heartbeat.md" ]; then
    cp "$TINYCLAW_CONFIG_HOME/heartbeat.md" "$DEFAULT_AGENT_DIR/"
fi
if [ -f "$TINYCLAW_CONFIG_HOME/AGENTS.md" ]; then
    cp "$TINYCLAW_CONFIG_HOME/AGENTS.md" "$DEFAULT_AGENT_DIR/"
fi
echo -e "${GREEN}✓ Created default agent directory: $DEFAULT_AGENT_DIR${NC}"

# Create directories for additional agents
for agent_id in "${ADDITIONAL_AGENTS[@]}"; do
    AGENT_DIR="$WORKSPACE_PATH/$agent_id"
    mkdir -p "$AGENT_DIR"
    if [ -d "$TINYCLAW_CONFIG_HOME/.claude" ]; then
        cp -r "$TINYCLAW_CONFIG_HOME/.claude" "$AGENT_DIR/"
    fi
    if [ -f "$TINYCLAW_CONFIG_HOME/heartbeat.md" ]; then
        cp "$TINYCLAW_CONFIG_HOME/heartbeat.md" "$AGENT_DIR/"
    fi
    if [ -f "$TINYCLAW_CONFIG_HOME/AGENTS.md" ]; then
        cp "$TINYCLAW_CONFIG_HOME/AGENTS.md" "$AGENT_DIR/"
    fi
    echo -e "${GREEN}✓ Created agent directory: $AGENT_DIR${NC}"
done

echo -e "${GREEN}✓ Credentials saved to $CREDENTIALS_FILE${NC}"
echo -e "${GREEN}✓ Settings saved to $SETTINGS_FILE${NC}"
echo ""
echo "You can manage agents later with:"
echo -e "  ${GREEN}./tinyclaw.sh agent list${NC}    - List agents"
echo -e "  ${GREEN}./tinyclaw.sh agent add${NC}     - Add more agents"
echo ""
echo "You can now start TinyClaw:"
echo -e "  ${GREEN}./tinyclaw.sh start${NC}"
echo ""
