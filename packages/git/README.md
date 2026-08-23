# Agent Fleet Git

Optional Git services for `dsh-agent-fleet`: team-aware context, peer comparison, early conflict inspection, structured handoffs, scope checking, member worktrees, file diffs, and a bounded Git graph. Agents continue to run ordinary Git commands through their terminal; the plugin does not provide an editor, proxy Git operations, send messages on an Agent's behalf, or resolve conflicts.

The single `fleet_git` tool exposes a small collaboration loop:

- `context` reports the caller's branch, upstream distance, changes, recent commits, and member worktree locations.
- `compare` compares the caller's history and file delta with another member's worktree or Fleet branch.
- `conflicts` separates overlapping paths from conflicts that Git can already prove during a synthetic merge.
- `handoff` prepares a bounded commit/file/test/notes payload which the Agent may send through Fleet messaging.
- `scope`, `check`, and `create_worktree` retain the existing terminal-operation and worktree services.

When the DSH render-engine diff services are installed, file diffs detect them at render time and use their syntax-aware renderer regardless of plugin load order. The view falls back to bounded plain-text patches when those services are absent or reject a patch.

The package registers `git.inspect`, `git.scope-check`, `git.history-rewrite`, `git.publish`, `git.repository-manage`, `git.worktree-create`, and `git.worktree-manage` plus the `git-repository` resource kind with Fleet. Team Agent terminal calls keep using ordinary `git` commands; the plugin checks recognized commands against these actions and the member workspace/worktree scope before execution. Its safe defaults allow inspection and ordinary scoped local writes without granting history rewrites, remote publication, or repository management. Fleet Access normalizes repository resources against Team workspaces, while the DSH sandbox remains mandatory.

Fleet Core contains no Git permission, tool-group, provider, or installation special case. Installing this package contributes the `fleet_git` tool to authorized Fleet members; without it, Fleet simply has no Git-specific service. The UI remains a supervision surface for repository state and history.
