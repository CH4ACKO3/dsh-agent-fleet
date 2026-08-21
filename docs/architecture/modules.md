# 模块职责

- `core`：Agent 注册、平级成员生命周期、共享项目根、控制和通用基础。
- `resources`：共享计划、清单、通用文件引用和修改路径提醒。
- `message`：Fleet 成员范围内的消息、频道状态、会议、Vote 和协调。
- `ui`：未来的查看和操作界面。

模块优先复用 DSH 的 Agent、session、文件系统和 sandbox 能力。Resources 只减少 Agent
无意间覆盖文件的概率，不建立额外权限、门禁或 Git 管理层。

根插件负责跨模块装配：加载 Team/任务、启动成员、把协作事件写入 `.fleet/runs`，并将
成员名称映射到 DSH 原生 Session。成员 transcript 不在 Fleet 中重复保存。
