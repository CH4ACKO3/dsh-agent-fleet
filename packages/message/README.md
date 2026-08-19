# Message

DSH Agent Fleet 的进程内通信组件。

当前实现提供五个模型工具：

- `fleet_send`：静默私信或频道发言；
- `fleet_followup`：唤醒指定 Agent；
- `fleet_messages`：读取私信或频道历史；
- `fleet_wait`：等待下一次消息或频道变化；
- `fleet_channel`：列出、创建和归档频道。

消息历史和频道只保存在当前进程。实际投递直接使用 DSH Agent 的 `inject` 和
`followup`；模块不维护第二套 inbox、ack、恢复或重试状态。二进制内容由 Resources
保存，消息只携带资源 ID。

Agent 目标目前使用 DSH Agent ID，例如 `@agent-id`。频道使用 `#channel`。在 Core
提供 Fleet 成员目录后，Core 可以在调用本模块前解析角色名和别名。

## 使用

将包加入 Cordis 配置：

```yaml
- name: '@dsh-agent-fleet/message'
```

模块要求同一进程中已经提供 DSH 的 `agents` 和 `tools` 服务。
