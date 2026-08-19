# Message

Fleet 的通信和协调层。

## 负责

- 提供频道、私聊、@、通知、会议、留言和紧急升级等通信形式。
- 管理收件箱、发件箱、回复关联、未读游标和责任交接。
- 按角色、领域和用户信息偏好路由、过滤和摘要消息，控制 fan-in/fan-out。
- 支持核心成员之间的持续协作，以及临时 Agent 的派发和结果回收。
- 承载跨 Team、跨 DSH 实例和外部系统的传输适配，包括 Interconnect、MCP 和未来的飞书接入。
- 将协调结果作为命令提交给 Core，并在消息中只携带 Resources 提供的资源引用。

## 不负责

- 不保存 Project、Team 或 Agent 的权威状态。
- 不直接修改工作区或保存大文件。
- 不实现用户界面。

完整边界见 [`../../docs/architecture/modules.md`](../../docs/architecture/modules.md)。
