# Resources

Fleet 的轻量共享工作区组件。

- `fleet_shared` 在当前 Agent 的工作区中读写 `.fleet/plan.md` 和 `.fleet/checklist.md`。
- `fleet_work` 声明 Agent 当前准备修改的文件或目录，并提醒路径重叠。
- `fleet_resource` 将已有文件注册为 `res_*` 引用，并查询或列出这些引用。

共享文件使用 DSH 原生文件系统和 sandbox；路径声明只提醒，不阻止任何操作。项目规则继续使用 DSH 原生的 `AGENTS.md`。
与 Core 一起安装时，首次注册或创建成员的工作目录会成为共享项目根，因此处在其它 cwd
的成员仍解析到同一份 plan/checklist；实际写入继续服从调用 Agent 的 DSH sandbox。

资源引用适用于文本、图片、压缩包等任意普通文件。它保存的是文件在当前 DSH 执行环境中的路径和元数据，不复制内容，也不是不可变快照；消息可携带资源 ID，接收方再用 `fleet_resource get` 取得路径。
