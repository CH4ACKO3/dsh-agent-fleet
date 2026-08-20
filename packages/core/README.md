# Core

Fleet 的控制平面和公共基础。

当前进程内实现提供 `fleet_agent` 工具，用于：

- 将当前 DSH Agent 注册为 Fleet 成员；
- 查询、更新和注销自己的 Fleet 成员信息；
- 创建受 Core 管理的子 Agent；
- 由创建者取消或停止受管理 Agent。

Core 只保存成员名称、角色和能力等 Fleet 元数据。Agent 的实际创建、运行状态、取消
和停止均委托给 DSH 原生 `AgentRegistry`，不实现第二套 Agent loop。

## 负责

- 定义 Project、Team、Agent、Work、Decision 等公共实体与标识。
- 注册和发现 Agent，维护能力、角色、状态和所属关系。
- 控制 Team 与 Agent 的创建、连接、启动、暂停、恢复和停止。
- 管理团队结构、用户参与方式、信息量、模型和预算等配置。
- 校验并执行权威状态转换，发布统一的命令、查询和事件接口。
- 定义存储、消息和 UI 使用的公共契约及扩展端口。
- 保证 Project 和 Team 独立于单个 Session；Session 只是连接入口。

## 不负责

- 不直接创建工作区、保存文件或实现持久化后端。
- 不负责消息传输、频道、会议或通知路由。
- 不包含界面和宿主相关展示逻辑。

完整边界见 [`../../docs/architecture/modules.md`](../../docs/architecture/modules.md)。
