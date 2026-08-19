# UI

Fleet 未来的用户交互和状态投影层。

## 负责

- 引导 Team 激活和交互式配置，包括用户角色、参与度、团队风格和成员结构。
- 展示 Project Room、组织结构、成员状态、正在执行的工作、预算和消耗。
- 展示关键决策卡、阶段结果、风险、未读消息和协作时间线。
- 提供频道、私聊、会议、留言和 Team 控制入口。
- 允许不同 Session 或宿主连接同一个持久 Project 和 Team。

## 不负责

- 不保存权威业务状态或项目文件。
- 不直接控制 Agent、操作存储或实现消息传输。
- 不在客户端复制 Core、Resources 或 Message 的领域逻辑。

完整边界见 [`../../docs/architecture/modules.md`](../../docs/architecture/modules.md)。
