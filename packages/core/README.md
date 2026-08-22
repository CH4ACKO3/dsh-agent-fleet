# Core

Fleet 的控制平面和公共基础。

当前进程内实现提供 `fleet_agent` 工具，用于：

- 将当前 DSH Agent 注册为 Fleet 成员；
- 查询、更新和注销自己的 Fleet 成员信息；
- 创建受 Core 管理的 Fleet Agent；
- 由创建者取消或停止受管理 Agent。

Core 保存成员的路由标识、持久显示名、姓名卡配色、角色和能力等 Fleet 元数据；未提供时会生成英文名，
并在受控的饱和度和亮度范围内生成 `#RRGGBB` 配色。
Agent 的实际创建、运行状态、取消
和停止均委托给 DSH 原生 `AgentRegistry`，并复用 DSH Subagent 的模型、工具组合与
sandbox 委派逻辑，不实现第二套 Agent loop。

受管理 Agent 的 handle 由 Fleet 插件 scope 持有，而不是挂在启动协调者的 Agent scope 下；
DSH Session 仍保留创建因果关系，但 Fleet 成员在协作关系上是平级的。

Core 还负责把 Fleet 名称解析为原生 Agent ID，并在 DSH Agent 销毁时清理对应成员。
首次注册或创建成员时，Core 会把调用者的工作目录绑定为当前 Fleet 的共享项目根，供
Resources 中的共享 plan/checklist 使用。它不保存文件、不传递消息，也不包含 UI。
