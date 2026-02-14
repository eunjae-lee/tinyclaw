# Streaming Responses to Discord

## Goal

Stream partial/incremental responses from AI agents (Claude, Codex) to Discord in real-time, instead of waiting for the full response before sending.

## Current Architecture

```
User (Discord) → discord-client.ts → writes JSON to incoming/
                                              ↓
                                    queue-processor.ts (polls incoming/)
                                              ↓
                                    invokeAgent() → spawns `claude -p "..."` → waits for exit
                                              ↓
                                    writes complete response to outgoing/
                                              ↓
                discord-client.ts (polls outgoing/) → sends to Discord
```

The current flow is **batch**: the queue processor waits for the full agent response, writes it to a file, and the Discord client picks it up. There is no mechanism for partial results.

## Streaming Approach

### 1. Claude CLI streaming flag

Claude Code CLI supports `--output-format stream-json` which emits newline-delimited JSON events as tokens arrive:

```bash
claude -p "..." --output-format stream-json --verbose
```

### 2. Discord message editing

Instead of sending one final message:
1. Send an initial message (e.g. "Thinking..." or the first chunk)
2. Accumulate tokens from the stream
3. Call `message.edit()` to update with accumulated text every ~1-2 seconds
4. Final edit with the complete response

### 3. IPC mechanism

The file-queue model doesn't support streaming. Options:

**Option A: Streaming file (simplest)**
- Queue processor writes partial responses to a `.partial` file, appending as tokens arrive
- Discord client watches `.partial` files and edits the Discord message
- On completion, rename `.partial` → final `.json` in outgoing/
- Pro: Minimal architecture change
- Con: Polling-based, higher latency (~1s), lots of file I/O

**Option B: Unix domain socket / named pipe**
- Queue processor opens a socket/pipe per message
- Discord client connects and reads streaming tokens
- Pro: True real-time, low latency
- Con: More complex, needs connection management

**Option C: Merge queue processor into Discord client**
- Discord client spawns the agent process directly (no separate queue processor)
- Pro: Simplest streaming path, direct pipe from child process stdout to Discord
- Con: Loses separation of concerns, harder to support multiple channels

**Recommended: Option A** — it preserves the current architecture with minimal changes and is good enough for Discord's rate limits.

## Implementation Plan

### Phase 1: Refactor `invokeAgent` to support streaming

Current signature:
```ts
async function invokeAgent(...): Promise<string>
```

New signature:
```ts
async function invokeAgent(..., onChunk?: (partial: string) => void): Promise<string>
```

- When `onChunk` is provided, use `--output-format stream-json` and call `onChunk` with accumulated text as tokens arrive
- When `onChunk` is not provided, keep existing behavior (backward compatible)
- Parse the stream-json NDJSON format, accumulate `assistant` message content deltas

### Phase 2: Streaming file protocol

Define a `.streaming` file format in `outgoing/`:

```json
{"status": "streaming", "messageId": "...", "channel": "discord", "partial": "Here is the beg..."}
```

- Queue processor writes/overwrites this file every ~1 second as tokens arrive
- On completion, delete `.streaming` file and write final `.json` response as today
- On error, delete `.streaming` file and write error response

### Phase 3: Discord client streaming support

- When polling `outgoing/`, also check for `.streaming` files
- On first `.streaming` file for a messageId: send initial Discord message, store reference
- On subsequent reads: `message.edit()` with updated partial text
- Respect Discord rate limits: edit at most once per 1-2 seconds
- On final `.json` file: do final edit with complete response, clean up

### Phase 4: Typing indicator improvements

- Stop sending typing indicator once the first streaming chunk is sent
- The streaming message itself serves as the "typing" feedback

## Key Constraints

- **Discord rate limits**: `message.edit()` is rate-limited. Batch updates to ~1 edit/second.
- **Discord 2000-char limit**: If streaming text exceeds 2000 chars, need to split into new messages mid-stream (tricky — may want to send a single message and split only at the end).
- **Codex (OpenAI)**: Check if `codex exec --json` supports streaming output. If not, streaming only works for Claude agents.
- **Team chains**: Streaming only makes sense for the final agent response. Intermediate chain steps can remain batch.
- **File attachments**: `[send_file: ...]` tags appear in the response text. These should only be processed after the stream completes.

## Files to modify

- `src/lib/invoke.ts` — add streaming child process handling
- `src/lib/queue-core.ts` — pass `onChunk` callback to `invokeAgent`, write `.streaming` files
- `src/channels/discord-client.ts` — watch for `.streaming` files, edit messages
- `src/lib/types.ts` — add streaming-related types if needed

## Testing considerations

- Unit test `invokeAgent` streaming mode with mocked child process
- Unit test `.streaming` file write/read protocol
- Unit test Discord message edit batching logic
- Integration test: end-to-end with a mock agent that emits tokens
