# Agent Fleet Git

Optional source-control supervision for `dsh-agent-fleet`. It adds a `fleet_git` scope checker and worktree creation service together with a read-only Fleet toolbar entry for staged and working-tree changes, member worktrees, file diffs, and a bounded Git graph. Agents continue to run ordinary Git commands through their terminal; the plugin does not provide an editor, proxy Git operations, or resolve conflicts.

When the DSH render-engine diff services are installed, file diffs use their syntax-aware renderer. The view falls back to bounded plain-text patches when those services are absent.

The package registers four Fleet capabilities: `git.inspect`, `git.scope-check`, `git.worktree-create`, and `git.worktree-manage`. Native fixed Team permissions can grant them without the optional permissions plugin; when that plugin is installed, its groups, denies, and OP expansion manage the same capability namespace.

Without this package, Fleet does not intercept Git: members use ordinary Git commands and Team rules like other DSH Agents. With it installed, Fleet can check an intended terminal operation against the member's mounted workspaces, repository, branch binding, and paths, and can explicitly create a member worktree. The UI remains a supervision surface for repository state and history.
