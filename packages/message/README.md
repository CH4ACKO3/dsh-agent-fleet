# Message

DSH Agent Fleet 的底层进程内消息与投递组件。

该包负责消息日志、频道、按成员划分的已读进度、原生 Session 投递、重绑定补投、搜索与
分页。完整 Fleet 主机在它之上提供持久 Inbox Task、Reply Task 和 Vote Task；消息包自身
不决定 Task 稳定状态。

## Agent 工具

消息包只注册两个直接模型工具：

- `fleet_send`：静默发送私信或频道消息；
- `fleet_channel`：列出、创建、更新或归档频道。

`fleet_followup`、`fleet_messages`、`fleet_wait`、旧 `fleet_vote` 和
`fleet_meeting` 已从模型工具面删除。成员通过完整 Fleet 主机中的：

- `fleet_inbox` 聚合读取所有可见来源的未读消息；
- `fleet_reply` 发送 Reply Task 的最终内容并记录回执；
- `fleet_vote` 创建或提交持久 Vote Task。

## 消息与 Task 的边界

`to` 中的 `@target` 只负责路由。正文中成功解析的 `@Name`、`@member-id`，以及
结构化 `mentions`，由完整 Fleet 主机提升为目标成员的 Reply Task。普通消息只更新目标
成员的 Inbox Task，不创建工作 Task，也不会直接唤醒整个 Team。

外部用户发送给具体成员的私信同样创建 Reply Task。Reply 是否完成由
`fleet_reply` 的实际投递回执决定，不再由“后来是否发过任意消息”推断。

每条消息固化发送时的接收成员，并分别记录待送达、已送达和累计已读正文范围，满足：

```
已读 ⊆ 已送达 ⊆ 接收成员
```

成员没有活动 Session、原生 inbox 注入失败或成员正在重绑定时，消息保持待送达；新
Session 接入后自动补投。频道通知只表示已送达，不会把正文标记为已读。

## 使用

将包加入 Cordis 配置：

```yaml
- name: '@dsh-agent-fleet/message'
```

模块要求同一进程中已经提供 DSH 的 `agents` 和 `tools` 服务。
