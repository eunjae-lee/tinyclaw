# Troubleshooting

Common issues and solutions for TinyClaw.

## Installation Issues

### Bash version error on macOS

If you see:
```
Error: This script requires bash 4.0 or higher (you have 3.2.57)
```

macOS ships with bash 3.2 by default. Install a newer version:

```bash
# Install bash 5.x via Homebrew
brew install bash

# Add to your PATH (add this to ~/.zshrc or ~/.bash_profile)
export PATH="/opt/homebrew/bin:$PATH"

# Or run directly with the new bash
/opt/homebrew/bin/bash ./tinyclaw.sh start
```

### Node.js dependencies not installing

```bash
# Clear npm cache and reinstall
rm -rf node_modules package-lock.json
npm cache clean --force
PUPPETEER_SKIP_DOWNLOAD=true npm install
```

## Channel Issues

### Discord bot not responding

```bash
# Check logs
tinyclaw logs discord

# Update Discord bot token
tinyclaw setup
```

**Checklist:**
- ✅ Bot token is correct
- ✅ "Message Content Intent" is enabled in Discord Developer Portal
- ✅ Bot has permissions to read/send messages
- ✅ Bot is added to your server

## Queue Issues

### Messages not processing

```bash
# Check queue processor status
tinyclaw status

# Check incoming queue
ls -la ~/workspace/everything/tinyclaw/config/queue/incoming/

# View queue logs
tinyclaw logs queue
```

**Checklist:**
- ✅ Queue processor is running
- ✅ Claude Code CLI is installed: `claude --version`
- ✅ Messages aren't stuck in processing: `ls ~/workspace/everything/tinyclaw/config/queue/processing/`

### Messages stuck in processing

This happens when the queue processor crashes mid-message:

```bash
# Clear stuck messages
rm -rf ~/workspace/everything/tinyclaw/config/queue/processing/*

# Restart TinyClaw
tinyclaw restart
```

### Responses not being sent

```bash
# Check outgoing queue
ls -la ~/workspace/everything/tinyclaw/config/queue/outgoing/

# Check channel client logs
tinyclaw logs discord
```

## Agent Issues

### Agent not found

If you see "Agent 'xyz' not found":

1. Check agent exists:
   ```bash
   tinyclaw agent list
   ```

2. Verify agent ID is lowercase and matches exactly:
   ```bash
   cat ~/workspace/everything/tinyclaw/config/settings.json | jq '.agents'
   ```

3. Check settings file is valid JSON:
   ```bash
   cat ~/workspace/everything/tinyclaw/config/settings.json | jq
   ```

### Wrong agent responding

If messages go to the wrong agent:

1. **Check routing prefix:** Must be `!agent_id` with space after
   - ✅ Correct: `!coder fix the bug`
   - ❌ Wrong: `!coderfix the bug` (no space)
   - ❌ Wrong: `! coder fix the bug` (space before agent_id)

2. **Verify agent exists:**
   ```bash
   tinyclaw agent show coder
   ```

3. **Check logs:**
   ```bash
   tail -f ~/workspace/everything/tinyclaw/config/logs/queue.log | grep "Routing"
   ```

### Conversation not resetting

If `!agent /reset` doesn't work:

1. Check reset flag exists:
   ```bash
   ls ~/workspace/everything/tinyclaw/workspace/{agent_id}/reset_flag
   ```

2. Send a new message to trigger reset (flag is checked before each message)

3. Remember: Reset is one-time only
   - First message after reset: Fresh conversation
   - Subsequent messages: Continues conversation

### CLI not found

If agent can't execute (error: `command not found`):

**For Anthropic agents:**
```bash
# Check Claude CLI is installed
claude --version

# Install if missing
# Visit: https://claude.com/claude-code
```

**For OpenAI agents:**
```bash
# Check Codex CLI is installed
codex --version

# Authenticate if needed
codex login
```

### Workspace issues

If agents aren't being created:

1. Check workspace path:
   ```bash
   cat ~/workspace/everything/tinyclaw/config/settings.json | jq '.workspace.path'
   ```

2. Verify workspace exists:
   ```bash
   ls ~/workspace/everything/tinyclaw/workspace/
   ```

3. Check permissions:
   ```bash
   ls -la ~/workspace/everything/tinyclaw/workspace/
   ```

4. Manually create if needed:
   ```bash
   mkdir -p ~/workspace/everything/tinyclaw/workspace
   ```

### Templates not copying

If new agents don't have `.claude/`, `heartbeat.md`, or `CLAUDE.md`:

1. Check templates exist:
   ```bash
   ls -la ~/workspace/everything/tinyclaw/config/{.claude,heartbeat.md,CLAUDE.md}
   ```

2. Run setup to create templates:
   ```bash
   tinyclaw setup
   ```

3. Manually copy if needed:
   ```bash
   cp -r .claude ~/workspace/everything/tinyclaw/config/
   cp heartbeat.md ~/workspace/everything/tinyclaw/config/
   cp CLAUDE.md ~/workspace/everything/tinyclaw/config/
   ```

## Tool Approval Issues

### Not receiving approval DMs

If the Discord bot isn't sending approval requests:

1. **Check admin user ID is set:**
   ```bash
   cat ~/workspace/everything/tinyclaw/config/settings.json | jq '.admin_user_id'
   ```

2. **Verify it's a valid Discord user ID:**
   - Open Discord Settings → Advanced → Enable "Developer Mode"
   - Right-click your username → "Copy User ID"
   - Update settings: edit `~/workspace/everything/tinyclaw/config/settings.json`

3. **Check the bot can DM you:**
   - Make sure you share a server with the bot
   - Check your Discord privacy settings allow DMs from server members

4. **Check approvals directories exist:**
   ```bash
   ls ~/workspace/everything/tinyclaw/config/approvals/pending/
   ls ~/workspace/everything/tinyclaw/config/approvals/decisions/
   ```

5. **Check Discord logs:**
   ```bash
   tinyclaw logs discord | grep -i approval
   ```

### Approval always timing out

If tools are always denied due to timeout:

1. **Increase timeout** in settings:
   ```json
   {
     "approvals": {
       "timeout": 600
     }
   }
   ```

2. **Check pending files are being created:**
   ```bash
   ls ~/workspace/everything/tinyclaw/config/approvals/pending/
   ```

3. **Check Discord client is running:**
   ```bash
   tinyclaw status
   ```

### "Always allow" not persisting

If clicking "Always allow" doesn't add the tool permanently:

1. **Check settings.json is writable:**
   ```bash
   ls -la ~/workspace/everything/tinyclaw/config/settings.json
   ```

2. **Verify `jq` is installed** (required by the hook script):
   ```bash
   which jq
   # Install if missing:
   brew install jq     # macOS
   sudo apt install jq # Ubuntu/Debian
   ```

3. **Check the tool was added:**
   ```bash
   cat ~/workspace/everything/tinyclaw/config/settings.json | jq '.permissions.allowedTools'
   ```

### Hook script not running

If tools are being approved without prompting:

1. **Check hook is configured in agent's settings:**
   ```bash
   cat ~/workspace/everything/tinyclaw/workspace/coder/.claude/settings.local.json | jq '.hooks'
   ```

2. **Verify hook script exists and is executable:**
   ```bash
   ls -la dist/lib/approval-hook.js
   ```

3. **Check no allowedTools are configured** (if empty, all tools are allowed by default):
   ```bash
   cat ~/workspace/everything/tinyclaw/config/settings.json | jq '.permissions.allowedTools'
   ```

### Stale pending approvals

If old approval files are accumulating:

```bash
# Clear all pending approvals
rm -f ~/workspace/everything/tinyclaw/config/approvals/pending/*.json
rm -f ~/workspace/everything/tinyclaw/config/approvals/decisions/*.json
```

## Update Issues

### Update check failing

If you see "Could not fetch latest version":

1. **Check internet connection:**
   ```bash
   curl -I https://api.github.com
   ```

2. **Check GitHub API rate limit:**
   ```bash
   curl https://api.github.com/rate_limit
   ```

3. **Disable update checks:**
   ```bash
   export TINYCLAW_SKIP_UPDATE_CHECK=1
   tinyclaw start
   ```

### Update download failing

If bundle download fails during update:

1. **Check release exists:**
   - Visit: https://github.com/jlia0/tinyclaw/releases
   - Verify bundle file is attached

2. **Manual update:**
   ```bash
   # Download bundle manually
   wget https://github.com/jlia0/tinyclaw/releases/latest/download/tinyclaw-bundle.tar.gz

   # Extract to temp directory
   mkdir temp-update
   tar -xzf tinyclaw-bundle.tar.gz -C temp-update

   # Backup current installation
   cp -r ~/tinyclaw ~/workspace/everything/tinyclaw/config/backups/manual-backup-$(date +%Y%m%d)

   # Replace files
   cp -r temp-update/tinyclaw/* ~/tinyclaw/
   ```

### Rollback after failed update

If update breaks TinyClaw:

```bash
# Find your backup
ls ~/workspace/everything/tinyclaw/config/backups/

# Restore from backup
BACKUP_DIR=$(ls -t ~/workspace/everything/tinyclaw/config/backups/ | head -1)
cp -r ~/workspace/everything/tinyclaw/config/backups/$BACKUP_DIR/* $HOME/tinyclaw/

# Restart
tinyclaw restart
```

## Performance Issues

### High CPU usage

```bash
# Check which process is using CPU
top -o cpu | grep -E 'claude|codex|node'
```

**Common causes:**
- Long-running AI tasks
- Stuck message processing
- Too many concurrent operations

**Solutions:**
- Wait for current task to complete
- Restart: `tinyclaw restart`
- Reduce heartbeat frequency in settings

### High memory usage

```bash
# Check memory usage
ps aux | grep -E 'claude|codex|node' | awk '{print $4, $11}'
```

**Solutions:**
- Restart TinyClaw: `tinyclaw restart`
- Reset conversations: `tinyclaw reset`

### Slow message responses

1. **Check queue depth:**
   ```bash
   ls ~/workspace/everything/tinyclaw/config/queue/incoming/ | wc -l
   ```

2. **Check processing queue:**
   ```bash
   ls ~/workspace/everything/tinyclaw/config/queue/processing/
   ```

3. **Monitor AI response time:**
   ```bash
   tail -f ~/workspace/everything/tinyclaw/config/logs/queue.log | grep "Processing completed"
   ```

## Log Analysis

### Enable debug logging

```bash
# Set log level (in queue-processor.ts or channel clients)
export DEBUG=tinyclaw:*

# Restart with debug logs
tinyclaw restart
```

### Useful log patterns

**Find errors:**
```bash
grep -i error ~/workspace/everything/tinyclaw/config/logs/*.log
```

**Track message routing:**
```bash
grep "Routing" ~/workspace/everything/tinyclaw/config/logs/queue.log
```

**Monitor agent activity:**
```bash
tail -f ~/workspace/everything/tinyclaw/config/logs/queue.log | grep "agent:"
```

**Check heartbeat timing:**
```bash
grep "Heartbeat" ~/workspace/everything/tinyclaw/config/logs/heartbeat.log
```

## Still Having Issues?

1. **Check status:**
   ```bash
   tinyclaw status
   ```

2. **View all logs:**
   ```bash
   tinyclaw logs all
   ```

3. **Restart from scratch:**
   ```bash
   tinyclaw stop
   rm -rf ~/workspace/everything/tinyclaw/config/queue/*
   tinyclaw start
   ```

4. **Report issue:**
   - GitHub Issues: https://github.com/jlia0/tinyclaw/issues
   - Include logs and error messages
   - Describe steps to reproduce

## Recovery Commands

Quick reference for common recovery scenarios:

```bash
# Full reset (preserves settings)
tinyclaw stop
rm -rf ~/workspace/everything/tinyclaw/config/queue/*
rm -rf ~/workspace/everything/tinyclaw/config/channels/*
tinyclaw start

# Complete reinstall
cd ~/tinyclaw
./scripts/uninstall.sh
cd ..
rm -rf tinyclaw
curl -fsSL https://raw.githubusercontent.com/jlia0/tinyclaw/main/scripts/remote-install.sh | bash

# Reset single agent
tinyclaw agent reset coder
tinyclaw restart
```
