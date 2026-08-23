# Agent Fleet Git

Optional Git services for `dsh-agent-fleet`: scope checking, member worktrees, staged and working-tree changes, file diffs, and a bounded Git graph. Agents continue to run ordinary Git commands through their terminal; the plugin does not provide an editor, proxy Git operations, or resolve conflicts.

When the DSH render-engine diff services are installed, file diffs use their syntax-aware renderer. The view falls back to bounded plain-text patches when those services are absent.

The package registers `git.inspect`, `git.scope-check`, `git.history-rewrite`, `git.publish`, `git.repository-manage`, `git.worktree-create`, and `git.worktree-manage` plus the `git-repository` resource kind with Fleet. Team Agent terminal calls keep using ordinary `git` commands; the plugin checks recognized commands against these actions and the member workspace/worktree scope before execution. Its safe defaults allow inspection and ordinary scoped local writes without granting history rewrites, remote publication, or repository management. Fleet Access normalizes repository resources against Team workspaces, while the DSH sandbox remains mandatory.

Fleet Core contains no Git permission, tool-group, provider, or installation special case. Installing this package contributes the `fleet_git` tool to authorized Fleet members; without it, Fleet simply has no Git-specific service. The UI remains a supervision surface for repository state and history.
