# Resources

Fleet 的轻量资源文件组件。

- `fleet_shared` 列举、读取或写入 `<projectRoot>/.fleet/<teamId>/` 中的任意真实文本文件；没有预定义文件名。
- `fleet_work` 声明 Agent 当前准备修改的文件或目录，并提醒路径重叠。
- `fleet_resource` 将已有文本或二进制文件注册为 `res_*` 引用，并查询或列出这些引用。

这个目录表示“Fleet 管理的 Team 资源”，不表示所有成员天然可读写。工具在具体文件上调用
Fleet 的统一授权入口；DSH Session `cwd` 与 sandbox 仍是不可绕过的上界。工作 claim 只提醒，
不阻止操作。资源引用保存原文件的路径与元数据，不复制内容，也不是不可变快照。
