# Message

DSH Agent Fleet 的进程内通信组件。

当前实现提供七个模型工具：

- `fleet_send`：静默私信或频道发言；
- `fleet_followup`：唤醒指定 Agent；
- `fleet_messages`：渐进读取私信或频道历史，并按消息持久记录实际读到的正文范围；
- `fleet_wait`：等待下一次消息或频道变化；
- `fleet_channel`：列出、创建、更新和归档频道；
- `fleet_meeting`：列出、发起和结束会议。
- `fleet_vote`：在频道中创建、读取和参与一致同意 Vote。

Message 单独安装时，消息历史、频道、会议和 Vote 只保存在当前进程；由根插件启动
Team run 时，它们同时进入该 run 的持久协作轨迹。实际投递直接使用 DSH Agent 的 `inject` 和
`followup`。每条新消息会固化发送时的接收成员；回执分别记录待送达、已送达和已读，满足
`已读 ⊆ 已送达 ⊆ 接收成员`。待送达会记录当前卡点：没有活动 Session、原生 inbox 注入失败，
或成员已退休；成员重新绑定 Session 时会自动补投。完整正文被原生上下文消费，或者由
`fleet_messages read` / `fleet_messages text` 返回时，都会推进持久 `readThrough`；正文全部
进入上下文后才算已读。频道的折叠通知只表示已送达，不会把正文标成已读。读取同时受消息数
和字符数限制，长消息可从已记录的位置继续。私聊和频道消息可以设置 `must_reply`；目标读完后
仍需在同一私聊或频道发送任意消息才算完成，否则进入空闲时会再次被唤醒。该状态直接由持久
消息历史推导，不与已读状态混用。当前来自外部用户的私聊会自动设置 `must_reply`，用户频道
消息不会设置；Agent 仍可在频道或私聊中显式使用该标志。消息可以携带资源 ID，
但不负责保存文件内容。安装 Resources 后，可以先用 `fleet_resource add` 注册普通文件或
二进制文件，再由接收方用 `fleet_resource get` 解析资源 ID。

运行时指令、恢复提醒、生产力变更和消息提示统一走 `FleetSystemNotification`。它们只管理
原生 Agent 上下文的静默注入、唤醒、打断与折叠，不进入 Fleet 消息历史，也没有独立已读
状态；关联真实消息时只记录投递关系，真实消息仍必须通过 `fleet_messages read/text` 读取。
所有原生 `inject`、`followup` 和 `steer` 分发都收敛在 MessageHub 内部。

Agent 目标可以使用 Core 注册的 Fleet 名称（例如 `@reviewer`）或原生 DSH Agent ID。
频道使用 `#channel`。与 Core 一起安装时，只有已注册 Fleet 成员能够参与通信，消息中
同时保留原生 ID 并展示 Fleet 名称；Message 单独安装时仍按原生 Agent ID 工作。

频道是持久的异步协作空间，不形成 Agent 上下级关系。Agent 可以在频道中发布工作，
其他 Agent 使用 `reply_to` 认领、补充或返回结果；使用 `fleet_followup` 时，消息对所有
频道成员可见，但只有明确 `mentions` 的 Agent 会被唤醒。频道的 `createdBy` 只控制归档，
不代表频道负责人。`fleet_wait` 只响应当前 Agent 可见的消息、频道或会议变化。
频道的 `summary` 和 `body` 是可替换的当前共享状态，`revision` 随更新递增；消息仍是
独立的时间顺序记录。

会议使用 `meeting:meeting-id`。发起和结束会议会唤醒所有其他参会者；会中普通消息
会通过 `inject` 将完整正文直接加入所有其他参会者的上下文，而不是像频道广播一样
只发送历史提示。使用 `fleet_followup` 向会议发言时，会唤醒所有其他参会者。只有
发起人可以结束会议，结束后不再接受新消息。

Vote 属于频道。创建者以外、当前可读取该频道的所有在线 Fleet 成员各投一次；任一
拒绝立即结束 Vote，所有 voter 同意才通过。`finish` 和 `blocked` Vote 在根插件的 Team
run 中会驱动对应终态。

## 使用

将包加入 Cordis 配置：

```yaml
- name: '@dsh-agent-fleet/message'
```

模块要求同一进程中已经提供 DSH 的 `agents` 和 `tools` 服务。
