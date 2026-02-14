# TinyClaw 🦞

**Multi-agent, multi-channel, 24/7 AI assistant**

Run multiple AI agents simultaneously with isolated workspaces and conversation contexts. Route messages to specialized agents using simple `@agent_id` syntax.

## ✨ Features

- ✅ **Multi-agent** - Run multiple isolated AI agents with specialized roles
- ✅ **Multiple AI providers** - Anthropic Claude (Sonnet/Opus) and OpenAI (GPT/Codex)
- ✅ **Multi-channel** - Discord, WhatsApp, and Telegram
- ✅ **Parallel processing** - Agents process messages concurrently
- ✅ **Interactive tool approvals** - Approve/deny agent tool use via Discord buttons
- ✅ **Persistent sessions** - Conversation context maintained across restarts
- ✅ **File-based queue** - No race conditions, reliable message handling
- ✅ **Three-layer memory** - Automatic daily/mid-term/long-term memory across sessions
- ✅ **24/7 operation** - Runs in tmux for always-on availability

## 🚀 Quick Start

### Prerequisites

- macOS or Linux
- Node.js v14+
- tmux
- Bash 4.0+ (macOS: `brew install bash`)
- [Claude Code CLI](https://claude.com/claude-code) (for Anthropic provider)
- [Codex CLI](https://docs.openai.com/codex) (for OpenAI provider)

### Installation

**Option 1: One-line Install (Recommended)**

```bash
curl -fsSL https://raw.githubusercontent.com/jlia0/tinyclaw/main/scripts/remote-install.sh | bash
```

**Option 2: From Release**

```bash
wget https://github.com/jlia0/tinyclaw/releases/latest/download/tinyclaw-bundle.tar.gz
tar -xzf tinyclaw-bundle.tar.gz
cd tinyclaw && ./scripts/install.sh
```

**Option 3: From Source**

```bash
git clone https://github.com/jlia0/tinyclaw.git
cd tinyclaw && npm install && ./scripts/install.sh
```

### First Run

```bash
tinyclaw start  # Runs interactive setup wizard
```

The setup wizard will guide you through:

1. **Channel selection** - Choose Discord, WhatsApp, and/or Telegram
2. **Bot tokens** - Enter tokens for enabled channels
3. **Workspace setup** - Name your workspace directory
4. **Default agent** - Configure your main AI assistant
5. **AI provider** - Select Anthropic (Claude) or OpenAI
6. **Model selection** - Choose model (e.g., Sonnet, Opus, GPT-5.3)
7. **Admin user ID** - Discord user ID for interactive tool approvals (optional)
8. **Heartbeat interval** - Set proactive check-in frequency

<details>
<summary><b>📱 Channel Setup Guides</b></summary>

### Discord Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create application → Bot section → Create bot
3. Copy bot token
4. Enable "Message Content Intent"
5. Invite bot using OAuth2 URL Generator

### Telegram Setup

1. Open Telegram → Search `@BotFather`
2. Send `/newbot` → Follow prompts
3. Copy bot token
4. Start chat with your bot

### WhatsApp Setup

After starting TinyClaw, scan the QR code:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     WhatsApp QR Code
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[QR CODE HERE]

📱 Settings → Linked Devices → Link a Device
```

</details>

## 📋 Commands

Commands work with `tinyclaw` (if CLI installed) or `./tinyclaw.sh` (direct script).

### Core Commands

| Command       | Description                                               | Example               |
| ------------- | --------------------------------------------------------- | --------------------- |
| `start`       | Start TinyClaw daemon                                     | `tinyclaw start`      |
| `stop`        | Stop all processes                                        | `tinyclaw stop`       |
| `restart`     | Restart TinyClaw                                          | `tinyclaw restart`    |
| `status`      | Show current status and activity                          | `tinyclaw status`     |
| `setup`       | Run setup wizard (reconfigure)                            | `tinyclaw setup`      |
| `logs [type]` | View logs (discord/telegram/whatsapp/queue/heartbeat/all) | `tinyclaw logs queue` |
| `attach`      | Attach to tmux session                                    | `tinyclaw attach`     |

### Agent Commands

| Command             | Description                 | Example                       |
| ------------------- | --------------------------- | ----------------------------- |
| `agent list`        | List all configured agents  | `tinyclaw agent list`         |
| `agent add`         | Add new agent (interactive) | `tinyclaw agent add`          |
| `agent show <id>`   | Show agent configuration    | `tinyclaw agent show coder`   |
| `agent remove <id>` | Remove an agent             | `tinyclaw agent remove coder` |
| `agent reset <id>`  | Reset agent conversation    | `tinyclaw agent reset coder`  |

### Configuration Commands

| Command                           | Description                  | Example                                          |
| --------------------------------- | ---------------------------- | ------------------------------------------------ |
| `provider [name]`                 | Show or switch AI provider   | `tinyclaw provider anthropic`                    |
| `provider <name> --model <model>` | Switch provider and model    | `tinyclaw provider openai --model gpt-5.3-codex` |
| `model [name]`                    | Show or switch AI model      | `tinyclaw model opus`                            |
| `reset`                           | Reset all conversations      | `tinyclaw reset`                                 |
| `channels reset <channel>`        | Reset channel authentication | `tinyclaw channels reset whatsapp`               |

### Memory Commands

| Command                                  | Description                                | Example                                    |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `memory read`                            | Show today's daily + mid-term memory       | `tinyclaw memory read`                     |
| `memory read --layer <layer>`            | Read specific layer (daily/mid-term/long-term/all) | `tinyclaw memory read --layer long-term` |
| `memory write "<text>"`                  | Save a fact to long-term memory            | `tinyclaw memory write "We use Prisma"`    |
| `memory status`                          | Show memory file sizes and dates           | `tinyclaw memory status`                   |
| `memory ingest`                          | Ingest session transcripts (runs hourly via cron) | `tinyclaw memory ingest`             |
| `memory promote daily`                   | Promote daily logs to mid-term summary     | `tinyclaw memory promote daily`            |
| `memory promote weekly`                  | Promote mid-term to long-term memory       | `tinyclaw memory promote weekly`           |

### Update Commands

| Command  | Description                       | Example           |
| -------- | --------------------------------- | ----------------- |
| `update` | Update TinyClaw to latest version | `tinyclaw update` |

<details>
<summary><b>Update Details</b></summary>

**Auto-detection:** TinyClaw checks for updates on startup (once per hour).

**Manual update:**

```bash
tinyclaw update
```

This will:

1. Check for latest release
2. Show changelog URL
3. Download bundle
4. Create backup of current installation
5. Install new version

**Disable update checks:**

```bash
export TINYCLAW_SKIP_UPDATE_CHECK=1
```

</details>

### Messaging Commands

| Command          | Description                 | Example                          |
| ---------------- | --------------------------- | -------------------------------- |
| `send <message>` | Send message to AI manually | `tinyclaw send "Hello!"`         |
| `send <message>` | Route to specific agent     | `tinyclaw send "@coder fix bug"` |

### In-Chat Commands

These commands work in Discord, Telegram, and WhatsApp:

| Command             | Description                                  | Example                              |
| ------------------- | -------------------------------------------- | ------------------------------------ |
| `@agent_id message` | Route message to specific agent              | `@coder fix the bug`                 |
| `/agent`            | List all available agents                    | `/agent`                             |
| `@agent_id /reset`  | Reset specific agent conversation            | `@coder /reset`                      |
| `/reset`            | Reset conversation (WhatsApp/global)         | `/reset` or `!reset`                 |
| `message`           | Send to default agent (no prefix)            | `help me with this`                  |

**Note:** The `@agent_id` routing prefix requires a space after it (e.g., `@coder fix` not `@coderfix`).

## 🤖 Using Agents

### Routing Messages

Use `@agent_id` prefix to route messages to specific agents (see [In-Chat Commands](#in-chat-commands) table above):

```
@coder fix the authentication bug
@writer document the API endpoints
@researcher find papers on transformers
help me with this  ← goes to default agent (no prefix needed)
```

### Agent Configuration

Agents are configured in `.tinyclaw/settings.json`:

```json
{
  "workspace": {
    "path": "/Users/me/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  },
  "agents": {
    "coder": {
      "name": "Code Assistant",
      "provider": "anthropic",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/coder"
    },
    "writer": {
      "name": "Technical Writer",
      "provider": "openai",
      "model": "gpt-5.3-codex",
      "memory": 0.5,
      "working_directory": "/Users/me/tinyclaw-workspace/writer"
    }
  }
}
```

Each agent operates in isolation:

- **Separate workspace directory** - `~/tinyclaw-workspace/{agent_id}/`
- **Own conversation history** - Maintained by CLI
- **Custom configuration** - `.claude/`, `heartbeat.md` (root), `AGENTS.md`
- **Independent resets** - Reset individual agent conversations

<details>
<summary><b>📖 Learn more about agents</b></summary>

See [docs/AGENTS.md](docs/AGENTS.md) for:

- Architecture details
- Agent configuration
- Use cases and examples
- Advanced features
- Troubleshooting

</details>

## 🔐 Tool Approvals

When an agent attempts to use a tool not in its pre-approved `allowedTools` list, TinyClaw sends an interactive approval request to the admin via Discord DM.

**Three options per request:**
- **Allow this time** — approve for this invocation only
- **Always allow** — persist the tool to `settings.json` allowedTools
- **Deny** — reject the tool use

**Setup:**
1. Set your Discord user ID during setup (or add `"admin_user_id"` to settings.json)
2. Configure `allowedTools` in `permissions` (global or per-agent)
3. When an agent tries an unapproved tool, you'll get a Discord DM with buttons

**How it works:**
- A `PreToolUse` hook script checks each tool against the allowedTools list
- Unapproved tools trigger a file-based approval request
- The Discord client polls for pending requests and sends interactive button messages
- The hook blocks until you respond (or the timeout expires, default 300s)

See [docs/AGENTS.md](docs/AGENTS.md) for detailed configuration.

## 🧠 Memory System

TinyClaw includes a three-layer memory system that gives agents continuity across sessions. Memory is unified across all agents.

### Three Layers

| Layer | What it captures | Lifespan | Injected into sessions? |
|-------|-----------------|----------|------------------------|
| **Daily** | Summarized session activity per day | ~7 days | Today's log auto-injected |
| **Mid-term** | Rolling summary of last 7 days (~1000 tokens) | ~4 weeks | Always auto-injected |
| **Long-term** | Durable facts, settled decisions, preferences | Forever | On demand via CLI |

### How It Works

**Automatic pipeline** (hourly cron via launchd):
1. **Ingest**: Session JSONL transcripts are preprocessed and summarized by an LLM into daily logs
2. **Promote daily→mid-term**: At 4am, last 7 daily logs are summarized into `mid-term.md`
3. **Promote mid-term→long-term**: Monday 4am, durable facts are promoted to `long-term.md`

**Session injection**: When an agent is invoked, mid-term + today's daily log are automatically injected via `--append-system-prompt-file`. Agents can access long-term memory on demand by running `tinyclaw memory read --layer long-term`.

### Agent Memory Configuration

Each agent has an optional `memory` field (0-1, default 1):
- `1` — include everything (default)
- `0.5` — only include items the LLM rates above 0.5 importance
- `0` — skip this agent entirely (no memory processing)

### Memory Storage

Memory files are stored at `TINYCLAW_MEMORY_HOME` (default: `~/workspace/everything/tinyclaw/memory/`):

```
memory/
  daily/
    2026-02-14.md     ← entries from all agents, tagged by agent name
    2026-02-13.md
  mid-term.md           ← rolling 7-day summary (~1000 tokens)
  long-term.md          ← durable facts, preferences, decisions
```

### Setup

Memory cron is installed automatically with `npm run launchd:install` or `npm run restart`.

## 📐 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Message Channels                         │
│         (Discord, Telegram, WhatsApp, Heartbeat)            │
└────────────────────┬────────────────────────────────────────┘
                     │ Write message.json
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                   ~/.tinyclaw/queue/                         │
│                                                              │
│  incoming/          processing/         outgoing/           │
│  ├─ msg1.json  →   ├─ msg1.json   →   ├─ msg1.json        │
│  ├─ msg2.json       └─ msg2.json       └─ msg2.json        │
│  └─ msg3.json                                                │
│                                                              │
└────────────────────┬────────────────────────────────────────┘
                     │ Queue Processor
                     ↓
┌─────────────────────────────────────────────────────────────┐
│              Parallel Processing by Agent                    │
│                                                              │
│  Agent: coder        Agent: writer       Agent: assistant   │
│  ┌──────────┐       ┌──────────┐        ┌──────────┐       │
│  │ Message 1│       │ Message 1│        │ Message 1│       │
│  │ Message 2│ ...   │ Message 2│  ...   │ Message 2│ ...   │
│  │ Message 3│       │          │        │          │       │
│  └────┬─────┘       └────┬─────┘        └────┬─────┘       │
│       │                  │                     │            │
└───────┼──────────────────┼─────────────────────┼────────────┘
        ↓                  ↓                     ↓
   claude CLI         claude CLI             claude CLI
  (workspace/coder)  (workspace/writer)  (workspace/assistant)
```

**Key features:**

- **File-based queue** - Atomic operations, no race conditions
- **Parallel agents** - Different agents process messages concurrently
- **Sequential per agent** - Preserves conversation order within each agent
- **Isolated workspaces** - Each agent has its own directory and context

<details>
<summary><b>📖 Learn more about the queue system</b></summary>

See [docs/QUEUE.md](docs/QUEUE.md) for:

- Detailed message flow
- Parallel processing explanation
- Performance characteristics
- Debugging tips

</details>

## 📁 Directory Structure

```
tinyclaw/
├── .tinyclaw/            # TinyClaw data
│   ├── settings.json     # Configuration
│   ├── queue/            # Message queue
│   │   ├── incoming/
│   │   ├── processing/
│   │   └── outgoing/
│   ├── approvals/        # Tool approval IPC
│   │   ├── pending/      # Hook writes, Discord reads
│   │   └── decisions/    # Discord writes, hook reads
│   ├── logs/             # All logs
│   ├── channels/         # Channel state
│   ├── files/            # Uploaded files
│   ├── events/           # Real-time event files
│   ├── .claude/          # Template for agents
│   ├── heartbeat.md      # Template for agents
│   └── CLAUDE.md         # Template for agents
├── ~/tinyclaw-workspace/ # Agent workspaces
│   ├── coder/
│   │   ├── .claude/
│   │   ├── heartbeat.md
│   │   └── CLAUDE.md
│   ├── writer/
│   └── assistant/
├── src/                  # TypeScript sources
│   └── memory/           # Memory system modules
├── dist/                 # Compiled output
├── lib/                  # Runtime scripts
├── features/             # Feature modules
│   └── memory/           # Memory cron + launchd plist
├── scripts/              # Installation & launchd scripts
└── tinyclaw.sh           # Main script
```

## ⚙️ Configuration

### Settings File

Located at `.tinyclaw/settings.json`:

```json
{
  "channels": {
    "enabled": ["discord", "telegram", "whatsapp"],
    "discord": { "bot_token": "..." },
    "telegram": { "bot_token": "..." },
    "whatsapp": {}
  },
  "admin_user_id": "123456789012345678",
  "workspace": {
    "path": "/Users/me/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  },
  "agents": {
    "assistant": {
      "name": "Assistant",
      "provider": "anthropic",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/assistant"
    }
  },
  "permissions": {
    "allowedTools": ["Read", "Grep", "Glob", "Write", "Edit"],
    "deniedTools": []
  },
  "approvals": {
    "timeout": 300
  },
  "monitoring": {
    "heartbeat_interval": 3600
  }
}
```

### Heartbeat Configuration

Edit agent-specific heartbeat prompts:

```bash
# Edit heartbeat for specific agent
nano ~/tinyclaw-workspace/coder/heartbeat.md
```

Default heartbeat prompt:

```markdown
Check for:

1. Pending tasks
2. Errors
3. Unread messages

Take action if needed.
```

## 🎯 Use Cases

### Personal AI Assistant

```
You: "Remind me to call mom"
Claude: "I'll remind you!"
[1 hour later via heartbeat]
Claude: "Don't forget to call mom!"
```

### Multi-Agent Workflow

```
@coder Review and fix bugs in auth.ts
@writer Document the changes
@reviewer Check the documentation quality
```

### Cross-Device Access

- WhatsApp on phone
- Discord on desktop
- Telegram anywhere
- CLI for automation

All channels share agent conversations!

## 📚 Documentation

- [AGENTS.md](docs/AGENTS.md) - Agent management and routing
- [QUEUE.md](docs/QUEUE.md) - Queue system and message flow
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) - Common issues and solutions

## 🐛 Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for detailed solutions.

**Quick fixes:**

```bash
# Reset everything (preserves settings)
tinyclaw stop && rm -rf .tinyclaw/queue/* && tinyclaw start

# Reset WhatsApp
tinyclaw channels reset whatsapp

# Check status
tinyclaw status

# View logs
tinyclaw logs all
```

**Common issues:**

- Bash version error → Install bash 4.0+: `brew install bash`
- WhatsApp not connecting → Reset auth: `tinyclaw channels reset whatsapp`
- Messages stuck → Clear queue: `rm -rf .tinyclaw/queue/processing/*`
- Agent not found → Check: `tinyclaw agent list`

**Need help?**

- [GitHub Issues](https://github.com/jlia0/tinyclaw/issues)
- Check logs: `tinyclaw logs all`

## 🙏 Credits

- Inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger
- Built on [Claude Code](https://claude.com/claude-code) and [Codex CLI](https://docs.openai.com/codex)
- Uses [discord.js](https://discord.js.org/), [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)

## 📄 License

MIT

---

**TinyClaw - Tiny but mighty!** 🦞✨

[![Star History Chart](https://api.star-history.com/svg?repos=jlia0/tinyclaw&type=date&legend=top-left)](https://www.star-history.com/#jlia0/tinyclaw&type=date&legend=top-left)
