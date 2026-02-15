# TinyClaw

A lightweight agent framework that bridges chat channels (Discord) to AI backends (Claude, Codex) via a file-based message queue.

## Architecture

```
Discord Client  -->  queue/incoming/  -->  Queue Processor  -->  queue/outgoing/  -->  Discord Client
                                                |
                                          invokeAgent()
                                          (Claude / Codex CLI)
```

- **Queue Processor** (`src/queue-processor.ts`): Polls `queue/incoming/`, routes messages to agents, writes responses to `queue/outgoing/`.
- **Discord Client** (`src/channels/discord-client.ts`): Bridges Discord to the file queue. Handles streaming messages, cancel buttons, and tool approval UI.
- **invoke** (`src/lib/invoke.ts`): Spawns Claude/Codex CLI subprocesses. Supports streaming and abort signals.
- **queue-core** (`src/lib/queue-core.ts`): Core processing logic — agent routing, streaming callbacks, idle notifications, cancel handling.
- **config** (`src/lib/config.ts`): All path constants and settings helpers.
- **types** (`src/lib/types.ts`): Shared TypeScript interfaces.

## Key Directories

All runtime data lives under `TINYCLAW_CONFIG_HOME` (default: `~/.tinyclaw/config`, overridable via env var).

| Path | Purpose |
|------|---------|
| `$TINYCLAW_CONFIG_HOME/settings.json` | Main configuration (agents, channels, permissions) |
| `$TINYCLAW_CONFIG_HOME/credentials.json` | Bot tokens and secrets |
| `$TINYCLAW_CONFIG_HOME/queue/incoming/` | Inbound message queue |
| `$TINYCLAW_CONFIG_HOME/queue/outgoing/` | Outbound response queue |
| `$TINYCLAW_CONFIG_HOME/queue/processing/` | Messages currently being processed |
| `$TINYCLAW_CONFIG_HOME/queue/cancel/` | Cancel signal files (written by Discord, read by queue processor) |
| `$TINYCLAW_CONFIG_HOME/queue/dead-letter/` | Messages that failed after max retries |
| `$TINYCLAW_CONFIG_HOME/logs/queue.log` | Queue processor log |
| `$TINYCLAW_CONFIG_HOME/logs/discord.log` | Discord client log |
| `$TINYCLAW_CONFIG_HOME/approvals/` | Tool approval request/decision files |
| `$TINYCLAW_CONFIG_HOME/events/` | Event files for monitoring |

## IPC Patterns

The system uses file-based IPC between the Discord client and queue processor:

- **Streaming**: Queue processor writes `.streaming` files to `queue/outgoing/`; Discord client polls and updates messages.
- **Cancel**: Discord writes `queue/cancel/{messageId}.json`; queue processor's idle timer picks it up and aborts the child process.
- **Approvals**: Queue processor writes to `approvals/pending/`; Discord client polls, shows buttons, writes decisions to `approvals/decisions/`.

## Development

```bash
npm run build    # TypeScript compilation
npm test         # Run vitest suite
```
