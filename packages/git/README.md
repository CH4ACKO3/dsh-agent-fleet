# Agent Fleet Git

Optional Git services for `dsh-agent-fleet`: scope checking, member worktrees, staged and working-tree changes, file diffs, and a bounded Git graph. Agents continue to run ordinary Git commands through their terminal; the plugin does not provide an editor, proxy Git operations, or resolve conflicts.

When the DSH render-engine diff services are installed, file diffs use their syntax-aware renderer. The view falls back to bounded plain-text patches when those services are absent.

The package registers `git.inspect`, `git.scope-check`, `git.worktree-create`, and `git.worktree-manage` plus the `git-repository` resource kind with Fleet. Its own safe defaults keep it usable without Fleet Authorization. That plugin may narrow action and concrete repository decisions, while the DSH sandbox remains mandatory.

When Agent Fleet Authorization is present, the Git plugin registers its Access repository adapter automatically. Authorization remains an optional peer and is not required for Git tools or the repository view.

Fleet Core contains no Git permission, tool-group, provider, or installation special case. Installing this package contributes the `fleet_git` tool to authorized Fleet members; without it, Fleet simply has no Git-specific service. The UI remains a supervision surface for repository state and history.
