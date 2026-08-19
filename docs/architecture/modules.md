# 模块职责

本文根据《[Frontal Team: 更好的持久开发平台](https://icn07qje5tl4.feishu.cn/wiki/WvzOwpWG1iDaIrkEPmScAlYfnE8)》定义 `dsh-agent-fleet` 的模块边界。

## 产品约束

1. Project 和 Team 不属于任何一个 Session。Session 只是用户或 Agent 连接持久团队的入口。
2. 核心成员长期存在并积累项目经验；临时 Agent 可以按需创建，但必须留下可追踪的交接结果。
3. 用户可以配置自己的角色、参与程度和信息量，只被关键决策、风险和阶段结果打断。
4. 协调按领域分散，跨领域信息通过有限同步和摘要传递，避免所有上下文汇聚到单一主 Agent。
5. Core 保存权威语义，Resources 提供持久化，Message 负责信息流，UI 只是状态投影和命令入口。

## 依赖方向

```text
resources ──depends on──> core
message   ──depends on──> core
ui        ──depends on──> core + resources + message
```

- `resources` 和 `message` 依赖 `core` 的公共契约及扩展端口。
- `core` 不导入任何具体存储、传输或 UI 实现。
- `message` 使用资源引用，不直接依赖具体存储后端。
- `ui` 只通过三个服务的公开接口读取投影和提交命令。

## Core

Core 是 Fleet 的控制平面和唯一领域真相来源。

### 拥有

- Project、Team、Agent、Work、Decision 的身份和状态语义。
- Agent 注册、能力发现、角色和团队拓扑。
- Team 与 Agent 的生命周期控制。
- 用户角色、信息偏好、团队风格、模型、预算和层级配置。
- 权威状态转换、命令、查询、事件以及模块扩展端口。
- Session 与持久 Project/Team 之间的连接关系。

### 不拥有

- 文件、工作区、数据库或对象存储实现。
- 消息传输、频道、会议和外部通信适配。
- 任何客户端展示状态。

## Resources

Resources 是 Fleet 的数据平面，负责 Agent 工作所需的可寻址资源和持久化实现。

### 拥有

- 项目工作区、仓库、worktree 和隔离目录。
- 项目索引、公共文档、共享看板和 repo memory。
- 产物、附件、日志、快照、版本和资源元数据。
- Core 状态及消息记录所需的持久化后端实现。
- 资源所有权、访问边界和生命周期。

### 不拥有

- Team 或 Agent 的状态转换规则。
- 任务协调、消息路由和用户通知策略。
- UI 投影。

## Message

Message 是 Fleet 的信息流和协调层，目标是降低无关信息的 fan-in/fan-out，而不是建立第二套团队状态。

### 拥有

- 频道、私聊、@、通知、会议、留言和紧急升级。
- 收件箱、发件箱、关联回复、未读游标和 handoff。
- 按角色、领域和用户偏好进行路由、过滤和摘要。
- 核心成员协作、临时 Agent 派发、等待和结果回收。
- 跨 Team、跨实例及外部系统的传输适配。
- 对 Core 命令的协调和提交。

### 不拥有

- Project、Team、Agent 或 Work 的权威状态。
- 文件内容和大对象传输；消息只携带资源引用。
- 客户端界面。

## UI

UI 是用户可选择连接的展示与控制层，不是 Fleet 的运行前提。

### 拥有

- Team 激活、配置和连接体验。
- Project Room、成员、工作、预算、风险和消耗视图。
- 关键决策卡、阶段结果、未读信息和协作时间线。
- 频道、私聊、会议、留言和控制操作入口。
- 多 Session、多宿主连接同一个持久 Team 的界面投影。

### 不拥有

- 权威状态、持久化和传输实现。
- Agent 调度或领域决策。
- Core、Resources 或 Message 已有逻辑的客户端副本。

## 状态归属规则

当一个概念可能落入多个模块时，按以下规则判断：

- 它描述“团队是什么、当前处于什么状态” → `core`。
- 它描述“数据在哪里、怎样读取和保存” → `resources`。
- 它描述“信息发给谁、何时发送、如何协调” → `message`。
- 它描述“用户看到什么、如何发出操作” → `ui`。
