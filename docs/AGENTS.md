# Agents

TinyClaw supports running multiple AI agents simultaneously, each with its own isolated workspace, configuration, and conversation state. This allows you to have specialized agents for different tasks while maintaining complete isolation.

## Overview

The agent management feature enables you to:

- **Run multiple agents** with different models, providers, and configurations
- **Route messages** to specific agents using `!agent_id` syntax
- **Isolate conversations** - each agent has its own workspace directory and conversation history
- **Specialize agents** - give each agent custom instructions via its CLAUDE.md
- **Switch providers** - mix Anthropic (Claude) and OpenAI (Codex) agents
- **Customize workspaces** - organize agents in your own workspace directory

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Message Channels                          │
│                  (Discord, Heartbeat)                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ User sends: "!coder fix the bug"
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                   Queue Processor                            │
│  • Parses !agent_id routing prefix                          │
│  • Falls back to default agent if no prefix                 │
│  • Loads agent configuration from settings.json             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Agent Router                              │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ !coder       │  │ !writer      │  │ !assistant   │     │
│  │              │  │              │  │ (default)    │     │
│  │ Provider:    │  │ Provider:    │  │ Provider:    │     │
│  │ anthropic    │  │ openai       │  │ anthropic    │     │
│  │ Model:       │  │ Model:       │  │ Model:       │     │
│  │ sonnet       │  │ gpt-5.3-codex│  │ opus         │     │
│  │              │  │              │  │              │     │
│  │ Workspace:   │  │ Workspace:   │  │ Workspace:   │     │
│  │ .../workspace│  │ .../workspace│  │ .../workspace│     │
│  │    /coder/   │  │    /writer/  │  │  /assistant/ │     │
│  │              │  │              │  │              │     │
│  │ Config:      │  │ Config:      │  │ Config:      │     │
│  │ .claude/     │  │ .claude/     │  │ .claude/     │     │
│  │ heartbeat.md │  │ heartbeat.md │  │ heartbeat.md │     │
│  │ CLAUDE.md    │  │ CLAUDE.md    │  │ CLAUDE.md    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  Shared: ~/workspace/everything/tinyclaw/config/ (channels, files, logs, queue)       │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

### 1. Message Routing

When a message arrives, the queue processor parses it for routing:

```typescript
// User sends: "!coder fix the authentication bug"
const routing = parseAgentRouting(rawMessage, agents);
// Result: { agentId: "coder", message: "fix the authentication bug" }
```

**Routing Rules:**
- Message starts with `!agent_id` → Routes to that agent
- No prefix → Routes to default agent (user-named during setup)
- Agent not found → Falls back to default agent
- No agents configured → Uses legacy single-agent mode

### 2. Agent Configuration

Each agent has its own configuration in `~/workspace/everything/tinyclaw/config/settings.json`:

```json
{
  "workspace": {
    "path": "~/workspace/everything/tinyclaw/workspace",
    "name": "tinyclaw-workspace"
  },
  "agents": {
    "coder": {
      "name": "Code Assistant",
      "provider": "anthropic",
      "model": "sonnet",
      "working_directory": "~/workspace/everything/tinyclaw/workspace/coder"
    },
    "writer": {
      "name": "Technical Writer",
      "provider": "openai",
      "model": "gpt-5.3-codex",
      "working_directory": "~/workspace/everything/tinyclaw/workspace/writer"
    },
    "assistant": {
      "name": "Assistant",
      "provider": "anthropic",
      "model": "opus",
      "working_directory": "~/workspace/everything/tinyclaw/workspace/assistant"
    }
  }
}
```

**Note:** The `working_directory` is automatically set to `<workspace>/<agent_id>/` when creating agents via `tinyclaw.sh agent add`.

### 3. Agent Isolation

Each agent has its own isolated workspace directory with complete copies of configuration files:

**Agent Workspaces:**
```
~/workspace/everything/tinyclaw/workspace/
├── coder/
│   ├── .claude/               # Agent's own Claude config
│   │   ├── settings.json
│   │   └── settings.local.json  # Includes PreToolUse approval hook
│   ├── heartbeat.md           # Agent-specific heartbeat
│   ├── CLAUDE.md              # Agent-specific instructions
│   └── reset_flag             # Reset signal
├── writer/
│   ├── .claude/
│   ├── heartbeat.md
│   ├── CLAUDE.md
│   └── reset_flag
└── assistant/                 # User-named default agent
    ├── .claude/
    ├── heartbeat.md
    ├── CLAUDE.md
    └── reset_flag
```

**Templates & Shared Resources:**

Agent templates live in the TinyClaw source repo and are copied to each new agent directory:

```
tinyclaw/                      # Source repo
├── .claude/                   # Template: Copied to each new agent
└── templates/
    ├── CLAUDE.md              # Template: Copied to each new agent
    ├── heartbeat.md           # Template: Copied to each new agent
    └── agent.gitignore        # Template: Copied as .gitignore
```

Shared runtime data lives in `~/workspace/everything/tinyclaw/config/`:

```
~/workspace/everything/tinyclaw/config/
├── settings.json      # Main configuration
├── credentials.json   # Bot tokens and secrets
├── approvals/         # SHARED: Tool approval IPC files
│   ├── pending/       # Hook writes pending requests here
│   └── decisions/     # Discord writes admin decisions here
├── channels/          # SHARED: Channel state
├── files/             # SHARED: Uploaded files from all channels
├── logs/              # SHARED: Log files for all agents and channels
└── queue/             # SHARED: Message queue (incoming/outgoing/processing)
```

**How it works:**
- Each agent runs CLI commands in its own workspace directory
- Each agent gets its own copy of `.claude/`, `heartbeat.md`, and `CLAUDE.md` from templates
- Agents can customize their settings, hooks, and CLAUDE.md independently
- Conversation history is isolated per agent (managed by Claude/Codex CLI via sessions)
- Reset flags allow resetting individual agent conversations
- File operations happen in the agent's directory
- Uploaded files, message queues, and logs are shared (common dependencies)

### 4. Provider Execution

The queue processor calls the appropriate CLI based on provider:

**Anthropic (Claude):**
```bash
cd "$agent_working_directory"
claude --permission-mode default \
  --model claude-sonnet-4-5 \
  --verbose --output-format stream-json \
  --append-system-prompt-file /tmp/tinyclaw-memory-*.md \
  --resume $SESSION_ID \           # or --session-id for new sessions
  -p "User message here"
```

Session management: TinyClaw tracks sessions per thread/DM using `--session-id` (new) and `--resume` (continue). Falls back to `-c` when no session key is available.

**OpenAI (Codex):**
```bash
cd "$agent_working_directory"
codex exec resume --last \
  --model gpt-5.3-codex \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  --json \
  "User message here"
```

Note: `resume --last` is only used when continuing a conversation (not after a reset).

### 5. Interactive Tool Approvals

When an agent uses a tool not in its `allowedTools` list, TinyClaw's `PreToolUse` hook intercepts the call and requests approval from the admin via Discord.

**Flow:**
```
Claude CLI → PreToolUse hook → checks allowedTools
                             ↓ (tool not pre-approved)
                       writes pending file → Discord polls pending/
                                           → sends DM with buttons
                             ↓ (admin clicks button)
                       reads decision file ← Discord writes decision
                             ↓
                       returns allow/deny to Claude
```

**File-based IPC** in `~/workspace/everything/tinyclaw/config/approvals/`:
- `pending/<request_id>.json` — hook writes, Discord reads
- `decisions/<request_id>.json` — Discord writes, hook reads

**Button options:**
| Button | Effect |
|--------|--------|
| Allow this time | Approves this single tool invocation |
| Always allow | Adds the tool to `settings.json` allowedTools and approves |
| Deny | Rejects the tool use |

**Configuration:**
```json
{
  "admin_user_id": "123456789012345678",
  "permissions": {
    "allowedTools": ["Read", "Grep", "Glob", "Write", "Edit"],
    "deniedTools": []
  },
  "approvals": {
    "timeout": 300
  }
}
```

| Field | Description |
|-------|-------------|
| `admin_user_id` | Discord user ID that receives approval DMs |
| `permissions.allowedTools` | Tools pre-approved for all agents (can be overridden per-agent) |
| `approvals.timeout` | Seconds to wait for a response before auto-denying (default: 300) |

**Agent workspace structure:**

Each agent's `.claude/settings.local.json` is automatically configured with the approval hook:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/tinyclaw/dist/lib/approval-hook.js",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

The hook script:
1. Reads tool name from stdin JSON
2. Checks if tool is in the agent's resolved `allowedTools`
3. If approved: exits silently (allows tool)
4. If not approved: writes a pending file, polls for a decision
5. Returns `{"permissionDecision": "allow"}` or `{"permissionDecision": "deny"}`

**Environment variables** passed to the hook:
- `TINYCLAW_AGENT_ID` — the agent ID (e.g., `coder`)
- `TINYCLAW_CONFIG_HOME` — path to `~/workspace/everything/tinyclaw/config`

**Getting your Discord user ID:**
1. Open Discord Settings → Advanced → Enable "Developer Mode"
2. Right-click your username → "Copy User ID"

## Configuration

### Initial Setup

During first-time setup (`./tinyclaw.sh setup`), you'll be prompted for:

1. **Workspace name** - Where to store agent directories
   - Default: `~/workspace/everything/tinyclaw/workspace`

2. **Default agent name** - Name for your main assistant
   - Default: `assistant`
   - This replaces the hardcoded "default" agent

### Adding Agents

**Interactive CLI:**
```bash
./tinyclaw.sh agent add
```

This walks you through:
1. Agent ID (e.g., `coder`)
2. Display name (e.g., `Code Assistant`)
3. Provider (Anthropic or OpenAI)
4. Model selection

**Working directory is automatically set to:** `<workspace>/<agent_id>/`

**Manual Configuration:**

Edit `~/workspace/everything/tinyclaw/config/settings.json`:

```json
{
  "workspace": {
    "path": "~/workspace/everything/tinyclaw/workspace",
    "name": "tinyclaw-workspace"
  },
  "agents": {
    "researcher": {
      "name": "Research Assistant",
      "provider": "anthropic",
      "model": "opus",
      "working_directory": "~/workspace/everything/tinyclaw/workspace/researcher"
    }
  }
}
```

### Agent Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable display name |
| `provider` | Yes | `anthropic` or `openai` |
| `model` | Yes | Model identifier (e.g., `sonnet`, `opus`, `gpt-5.3-codex`) |
| `working_directory` | Yes | Directory where agent operates (auto-set to `<workspace>/<agent_id>/`) |
| `permissions` | No | Per-agent `allowedTools` / `deniedTools` overrides |
| `memory` | No | 0-1 (default 1). Memory importance threshold. 0 = skip agent in memory processing |

**Note:**
- The `working_directory` is automatically set to `<workspace>/<agent_id>/` when creating agents
- Each agent gets its own isolated directory with copies of templates from the source repo
- Agent personality/instructions are configured via the `CLAUDE.md` file in each agent's workspace

## Usage

### Routing Messages to Agents

**In Discord:**

```
!coder fix the authentication bug in login.ts

!writer document the new API endpoints

!researcher find papers on transformer architectures

help me with this (goes to default agent - "assistant" by default)
```

### Listing Agents

**From chat:**
```
/agents
```

**From CLI:**
```bash
./tinyclaw.sh agent list
```

**Output:**
```
Configured Agents
==================

  !coder - Code Assistant
    Provider:  anthropic/sonnet
    Directory: ~/workspace/everything/tinyclaw/workspace/coder

  !writer - Technical Writer
    Provider:  openai/gpt-5.3-codex
    Directory: ~/workspace/everything/tinyclaw/workspace/writer

  !assistant - Assistant
    Provider:  anthropic/opus
    Directory: ~/workspace/everything/tinyclaw/workspace/assistant
```

### Managing Agents

**Show agent details:**
```bash
./tinyclaw.sh agent show coder
```

**Reset agent conversation:**
```bash
./tinyclaw.sh agent reset coder
```

From chat:
```
!coder /reset
```

**Remove agent:**
```bash
./tinyclaw.sh agent remove coder
```

## Use Cases

### Specialized Codebases

Have different agents for different projects:

```json
{
  "workspace": {
    "path": "/Users/me/my-workspace"
  },
  "agents": {
    "frontend": {
      "working_directory": "/Users/me/my-workspace/frontend",
      "system_prompt": "You are a React and TypeScript expert..."
    },
    "backend": {
      "working_directory": "/Users/me/my-workspace/backend",
      "system_prompt": "You are a Node.js backend engineer..."
    }
  }
}
```

Usage:
```
!frontend add a loading spinner to the dashboard

!backend optimize the database queries in user service
```

### Role-Based Agents

Assign different roles to agents:

```json
{
  "agents": {
    "reviewer": {
      "system_prompt": "You are a code reviewer. Focus on security, performance, and best practices."
    },
    "debugger": {
      "system_prompt": "You are a debugging expert. Help identify and fix bugs systematically."
    },
    "architect": {
      "model": "opus",
      "system_prompt": "You are a software architect. Design scalable, maintainable systems."
    }
  }
}
```

### Provider Mixing

Use different AI providers for different tasks:

```json
{
  "agents": {
    "quick": {
      "provider": "anthropic",
      "model": "sonnet",
      "system_prompt": "Fast, efficient responses for quick questions."
    },
    "deep": {
      "provider": "anthropic",
      "model": "opus",
      "system_prompt": "Thorough, detailed analysis for complex problems."
    },
    "codegen": {
      "provider": "openai",
      "model": "gpt-5.3-codex",
      "system_prompt": "Code generation specialist."
    }
  }
}
```

## Advanced Features

### Dynamic Agent Routing

You can pre-route messages from channel clients by setting the `agent` field:

```typescript
// In channel client (discord-client.ts, etc.)
const queueData: QueueData = {
  channel: 'discord',
  message: userMessage,
  agent: 'coder',  // Pre-route to specific agent
  // ...
};
```

### Fallback Behavior

If no agents are configured, TinyClaw automatically creates a default agent using the legacy `models` section:

```json
{
  "models": {
    "provider": "anthropic",
    "anthropic": {
      "model": "sonnet"
    }
  }
}
```

This ensures backward compatibility with older configurations.

### Reset Flags

Two types of reset flags:

1. **Global reset:** `~/workspace/everything/tinyclaw/config/reset_flag` - resets all agents
2. **Per-agent reset:** `<workspace>/<agent_id>/reset_flag` - resets specific agent

Both are automatically cleaned up after use.

### Custom Workspaces

You can create multiple workspaces for different purposes:

```json
{
  "workspace": {
    "path": "/Users/me/work-projects",
    "name": "work-projects"
  }
}
```

Or even use cloud-synced directories:
```json
{
  "workspace": {
    "path": "/Users/me/Dropbox/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  }
}
```

## File Handling

Files uploaded through messaging channels are automatically available to all agents:

```
User uploads image.png via Discord
→ Saved to ~/workspace/everything/tinyclaw/config/files/discord_123456_image.png
→ Message includes: [file: /path/to/image.png]
→ Routed to agent
→ Agent can read/process the file
```

Agents can also send files back:

```typescript
// Agent response includes:
response = "Here's the diagram [send_file: /path/to/diagram.png]";
// File is extracted and sent back through channel
```

## Troubleshooting

For detailed troubleshooting of agent-related issues, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

**Quick reference:**

- **Agent not found** → Check: `tinyclaw agent list`
- **Wrong agent responding** → Verify routing: `!agent_id message` (with space)
- **Conversation not resetting** → Send message after: `tinyclaw agent reset <id>`
- **CLI not found** → Install Claude Code or Codex CLI
- **Workspace issues** → Check: `cat ~/workspace/everything/tinyclaw/config/settings.json | jq '.workspace'`
- **Templates not copying** → Run: `tinyclaw setup`

## Implementation Details

### Code Structure

**Queue Processor** (`src/queue-processor.ts`):
- `getSettings()` - Loads settings from JSON
- `getAgents()` - Returns agent configurations (checks `.agents`)
- `parseAgentRouting()` - Parses `!agent_id` prefix
- `processMessage()` - Main routing and execution logic

**Message Interfaces:**
```typescript
interface MessageData {
  agent?: string;      // Pre-routed agent ID
  files?: string[];    // Uploaded file paths
  // ...
}

interface ResponseData {
  agent?: string;      // Which agent handled this
  files?: string[];    // Files to send back
  // ...
}
```

### Agent Directory Structure

**Templates** (from source repo):
```
tinyclaw/
├── .claude/              # Copied to new agents
└── templates/
    ├── CLAUDE.md         # Copied to new agents
    ├── heartbeat.md      # Copied to new agents
    └── agent.gitignore   # Copied as .gitignore
```

**Agent State:**
```
<workspace>/
└── {agent_id}/
    ├── .claude/       # Agent's own config
    ├── heartbeat.md   # Agent's own monitoring
    ├── CLAUDE.md      # Agent's own instructions
    └── reset_flag     # Touch to reset conversation
```

State is managed by the CLI itself (claude or codex) through session IDs and working directory isolation.

## Future Enhancements

Potential features for agent management:

- **Shared context:** Optional shared memory between agents
- **Agent scheduling:** Time-based or event-based agent activation
- **Web dashboard:** Visual agent management and monitoring
- **Agent analytics:** Track usage, performance per agent
- **Workspace templates:** Pre-configured agent workspaces for common use cases
- **Agent migration:** Export/import agent configurations

## See Also

- [README.md](../README.md) - Main project documentation
- Setup wizard: `./tinyclaw.sh setup`
- Agent CLI: `./tinyclaw.sh agent --help`
