# Resources

Fleet 的资源、工作区和存储层。

## 负责

- 管理项目工作区、代码仓库、worktree 和 Agent 的隔离执行目录。
- 管理项目索引、公共文档、共享看板和长期项目记忆。
- 保存产物、附件、日志、快照及其元数据，提供稳定的资源引用。
- 实现 Core 定义的持久化端口，使 Project 和 Team 能跨 Session 恢复。
- 管理资源所有权、访问边界、版本和生命周期。

## 不负责

- 不决定 Agent 的组织、任务分配或生命周期状态。
- 不传递消息，也不实现协调策略。
- 不直接向用户呈现状态。

完整边界见 [`../../docs/architecture/modules.md`](../../docs/architecture/modules.md)。
