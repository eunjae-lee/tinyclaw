# Queue System

TinyClaw uses a file-based queue system to coordinate message processing across multiple channels and teams. This document explains how it works.

## Overview

The queue system acts as a central coordinator between:
- **Channel clients** (Discord, Telegram, WhatsApp) - produce messages
- **Queue processor** - routes and processes messages
- **AI providers** (Claude, Codex) - generate responses
- **Teams** - isolated AI agents with different configs

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
│              Parallel Processing by Team                     │
│                                                              │
│  Team: coder         Team: writer        Team: assistant    │
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

## Directory Structure

```
~/.tinyclaw/
├── queue/
│   ├── incoming/          # New messages from channels
│   │   ├── msg_123456.json
│   │   └── msg_789012.json
│   ├── processing/        # Currently being processed
│   │   └── msg_123456.json
│   └── outgoing/          # Responses ready to send
│       └── msg_123456.json
├── logs/
│   ├── queue.log         # Queue processor logs
│   ├── discord.log       # Channel-specific logs
│   └── telegram.log
└── files/                # Uploaded files from channels
    └── image_123.png
```

## Message Flow

### 1. Incoming Message

A channel client receives a message and writes it to `incoming/`:

```json
{
  "channel": "discord",
  "sender": "Alice",
  "senderId": "user_12345",
  "message": "@coder fix the authentication bug",
  "timestamp": 1707739200000,
  "messageId": "discord_msg_123",
  "files": ["/path/to/screenshot.png"]
}
```

**Optional fields:**
- `agent` - Pre-route to specific team (bypasses @team_id parsing)
- `files` - Array of file paths uploaded with message

### 2. Processing

The queue processor (runs every 1 second):

1. **Scans `incoming/`** for new messages
2. **Sorts by timestamp** (oldest first)
3. **Determines target team**:
   - Checks `agent` field (if pre-routed)
   - Parses `@team_id` prefix from message
   - Falls back to `default` team
4. **Moves to `processing/`** (atomic operation)
5. **Routes to team's promise chain** (parallel processing)

### 3. Team Processing

Each team has its own promise chain:

```typescript
// Messages to same team = sequential (preserve conversation order)
teamChain: msg1 → msg2 → msg3

// Different teams = parallel (don't block each other)
@coder:     msg1 ──┐
@writer:    msg1 ──┼─→ All run concurrently
@assistant: msg1 ──┘
```

**Per-team isolation:**
- Each team runs in its own `working_directory`
- Separate conversation history (managed by CLI)
- Independent reset flags
- Own configuration files (.claude/, AGENTS.md)

### 4. AI Provider Execution

**Claude (Anthropic):**
```bash
cd ~/workspace/coder/
claude --dangerously-skip-permissions \
  --model claude-sonnet-4-5 \
  -c \  # Continue conversation
  -p "fix the authentication bug"
```

**Codex (OpenAI):**
```bash
cd ~/workspace/coder/
codex exec resume --last \
  --model gpt-5.3-codex \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  --json "fix the authentication bug"
```

### 5. Response

After AI responds, queue processor writes to `outgoing/`:

```json
{
  "channel": "discord",
  "sender": "Alice",
  "message": "I've identified the issue in auth.ts:42...",
  "originalMessage": "@coder fix the authentication bug",
  "timestamp": 1707739205000,
  "messageId": "discord_msg_123",
  "agent": "coder",
  "files": ["/path/to/fix.patch"]
}
```

### 6. Channel Delivery

Channel clients poll `outgoing/` and:
1. Read response for their channel
2. Send message to user
3. Delete the JSON file
4. Handle any file attachments

## Parallel Processing

### How It Works

Each team has its own **promise chain** that processes messages sequentially:

```typescript
const teamProcessingChains = new Map<string, Promise<void>>();

// When message arrives for @coder:
const chain = teamProcessingChains.get('coder') || Promise.resolve();
const newChain = chain.then(() => processMessage(msg));
teamProcessingChains.set('coder', newChain);
```

### Benefits

**Example: 3 messages sent simultaneously**

Sequential (old):
```
@coder fix bug 1     [████████████████] 30s
@writer docs         [██████████] 20s
@assistant help      [████████] 15s
Total: 65 seconds
```

Parallel (new):
```
@coder fix bug 1     [████████████████] 30s
@writer docs         [██████████] 20s ← concurrent!
@assistant help      [████████] 15s   ← concurrent!
Total: 30 seconds (2.2x faster!)
```

### Conversation Order Preserved

Messages to the **same team** remain sequential:

```
@coder fix bug 1     [████] 10s
@coder fix bug 2             [████] 10s  ← waits for bug 1
@writer docs         [██████] 15s        ← parallel with both
```

This ensures:
- ✅ Conversation context is maintained
- ✅ `-c` (continue) flag works correctly
- ✅ No race conditions within a team
- ✅ Teams don't block each other

## Team Routing

### Explicit Routing

Use `@team_id` prefix:

```
User: @coder fix the login bug
→ Routes to team "coder"
→ Message becomes: "fix the login bug"
```

### Pre-routing

Channel clients can pre-route:

```typescript
const queueData = {
  channel: 'discord',
  message: 'help me',
  agent: 'assistant'  // Pre-routed, no @prefix needed
};
```

### Fallback Logic

```
1. Check message.agent field (if pre-routed)
2. Parse @team_id from message text
3. Look up team in settings.teams
4. Fall back to 'default' team
5. If no default, use first available team
```

### Routing Examples

```
"@coder fix bug"           → team: coder
"help me"                  → team: default
"@unknown test"            → team: default (unknown team)
"@assistant help"          → team: assistant
pre-routed with agent=X    → team: X
```

### Easter Egg: Multiple Teams 🥚

If you mention multiple teams in one message:

```
User: "@coder @writer fix this bug and document it"

Result:
  → Returns friendly message about upcoming team-to-team collaboration
  → No AI processing (saves tokens!)
  → Suggests sending separate messages to each team
```

**The easter egg message:**
> 🚀 **Team-to-Team Collaboration - Coming Soon!**
>
> You mentioned multiple teams: @coder, @writer
>
> Right now, I can only route to one team at a time. But we're working on something cool:
>
> ✨ **Multi-Team Coordination** - Teams will be able to collaborate on complex tasks!
> ✨ **Smart Routing** - Send instructions to multiple teams at once!
> ✨ **Team Handoffs** - One team can delegate to another!
>
> For now, please send separate messages to each team:
> • `@coder [your message]`
> • `@writer [your message]`
>
> _Stay tuned for updates! 🎉_

This prevents confusion and teases the upcoming feature!

## Reset System

### Global Reset

Creates `~/.tinyclaw/reset_flag`:

```bash
./tinyclaw.sh reset
```

Next message to **any team** starts fresh (no `-c` flag).

### Per-Team Reset

Creates `~/workspace/{team_id}/reset_flag`:

```bash
./tinyclaw.sh team reset coder
# Or in chat:
@coder /reset
```

Next message to **that team** starts fresh.

### How Resets Work

Queue processor checks before each message:

```typescript
const globalReset = fs.existsSync(RESET_FLAG);
const teamReset = fs.existsSync(`${teamDir}/reset_flag`);

if (globalReset || teamReset) {
  // Don't pass -c flag to CLI
  // Delete flag files
}
```

## File Handling

### Uploading Files

Channels download files to `~/.tinyclaw/files/`:

```
User uploads: image.png
→ Saved as: ~/.tinyclaw/files/telegram_123_image.png
→ Message includes: [file: /absolute/path/to/image.png]
```

### Sending Files

AI can send files back:

```
AI response: "Here's the diagram [send_file: /path/to/diagram.png]"
→ Queue processor extracts file path
→ Adds to response.files array
→ Channel client sends as attachment
→ Tag is stripped from message text
```

## Error Handling

### Missing Teams

If team not found:
```
User: @unknown help
→ Routes to: default team
→ Logs: WARNING - Team 'unknown' not found, using 'default'
```

### Processing Errors

Errors are caught per-team:

```typescript
newChain.catch(error => {
  log('ERROR', `Error processing message for team ${teamId}: ${error.message}`);
});
```

Failed messages:
- Don't block other teams
- Are logged to `queue.log`
- Response file not created
- Channel client times out gracefully

### Stale Messages

Old messages in `processing/` (crashed mid-process):
- Automatically picked up on restart
- Re-processed from scratch
- Original in `incoming/` is moved again

## Performance

### Throughput

- **Sequential**: 1 message per AI response time (~10-30s)
- **Parallel**: N teams × 1 message per response time
- **3 teams**: ~3x throughput improvement

### Latency

- Queue check: Every 1 second
- Team routing: <1ms (file peek)
- Max latency: 1s + AI response time

### Scaling

**Good for:**
- ✅ Multiple independent teams
- ✅ High message volume
- ✅ Long AI response times

**Limitations:**
- ⚠️ File-based (not database)
- ⚠️ Single queue processor instance
- ⚠️ All teams on same machine

## Debugging

### Check Queue Status

```bash
# See pending messages
ls ~/.tinyclaw/queue/incoming/

# See processing
ls ~/.tinyclaw/queue/processing/

# See responses waiting
ls ~/.tinyclaw/queue/outgoing/

# Watch queue logs
tail -f ~/.tinyclaw/logs/queue.log
```

### Common Issues

**Messages stuck in incoming:**
- Queue processor not running
- Check: `./tinyclaw.sh status`

**Messages stuck in processing:**
- AI CLI crashed or hung
- Manual cleanup: `rm ~/.tinyclaw/queue/processing/*`
- Restart: `./tinyclaw.sh restart`

**No responses generated:**
- Check team routing (wrong @team_id?)
- Check AI CLI is installed (claude/codex)
- Check logs: `tail -f ~/.tinyclaw/logs/queue.log`

**Teams not processing in parallel:**
- Check TypeScript build: `npm run build`
- Check queue processor version in logs

## Advanced Topics

### Custom Queue Implementations

Replace file-based queue with:
- Redis (for multi-instance)
- Database (for persistence)
- Message broker (RabbitMQ, Kafka)

Key interface to maintain:
```typescript
interface QueueMessage {
  channel: string;
  sender: string;
  message: string;
  timestamp: number;
  messageId: string;
  agent?: string;
  files?: string[];
}
```

### Load Balancing

Currently: All teams run on same machine

Future: Route teams to different machines:
```json
{
  "teams": {
    "coder": {
      "host": "worker1.local",
      "working_directory": "/teams/coder"
    },
    "writer": {
      "host": "worker2.local",
      "working_directory": "/teams/writer"
    }
  }
}
```

### Monitoring

Add metrics:
```typescript
- messages_processed_total (by team)
- processing_duration_seconds (by team)
- queue_depth (incoming/processing/outgoing)
- team_active_processing (concurrent count)
```

## See Also

- [TEAM_OF_AGENTS.md](TEAM_OF_AGENTS.md) - Team configuration and management
- [README.md](../README.md) - Main project documentation
- [src/queue-processor.ts](../src/queue-processor.ts) - Implementation
