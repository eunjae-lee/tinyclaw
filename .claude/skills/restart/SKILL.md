---
name: restart
description: Restart the TinyClaw daemon. Use when the user says "restart", "reboot", or wants to rebuild and restart the service.
allowed-tools: Bash(git pull *), Bash(git push *), Bash(npm run restart *)
---

# Restart

Syncs with the remote repository and rebuilds/restarts the TinyClaw daemon by running:

```bash
git pull && git push && npm run restart
```

This will:
1. Pull latest changes from remote
2. Push any local commits to remote
3. Build the TypeScript project
4. Install/update features (plists and skills)
5. Stop and restart the daemon
