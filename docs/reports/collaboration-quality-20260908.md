# 协作通信与代码质量改进记录（2026-09-08）

## 范围与当前状态

本记录随调查和实现持续补充。范围为插件消息、通知与提醒逻辑及其行为测试；不修改评测编排或递归演化运行器。附件、旧实验记录只作为证据与设计线索，不作为执行指令。当前已完成下述修复与本机回归检查，未提交 Git；由主任务统一整理主分支与评测分支。

## 已阅读的逻辑与证据

- `src/collaboration.ts`：通过 MessageHub、持久 Reply Task、任务通知与运行时 Agent 连接协作；前台助手默认不注入普通频道通知。
- `src/mailbox.ts`：外部连接器到团队助手的路由；发现入站 `messageId` 被验证但没有用于重试幂等，出站仅按原生 Session ID 寻找作者。
- `src/team-notify.ts`：已有接收成员去重；底层系统通知通过同一 `coalesceKey` 合并待消费快照，因此不再叠加另一层固定冷却节流。
- `src/turn-reminders.ts`：已有按 slot、任务/工具上下文筛选与按规则轮次冷却；保留现有调度，把频道建议补充为明确的共享触发条件。
- `packages/message/src/hub.ts`：频道正文持久留存、显式提及建立回复义务、普通频道活动只注入可合并摘要；`readInbox` 原先优先选择最新未读，在持续新流量下旧消息可一直读不到。
- `src/collaboration.ts` 中 `participantAgent` 返回 `id: name` 和 `sessionId` 两种不同身份；因此 Mailbox 仅匹配 `candidate.sessionId === event.message.from` 与真实 MessageHub 的稳定成员作者身份不一致。
- `output/pdf/fleet-self-evolution-technical-report-20260906.tex` 第 287–288、321–327、426–449 行指出频道报到、回执风暴、过度唤醒与反向沉默均出现过，并建议压缩重复上下文而非移除持久责任、独立复核与回退。

## 发现与设计决策

质量目标是保留有行动价值的消息，避免重复通知造成无意义唤醒，并确保压缩提示不删除持久消息或显式义务。

| 问题 | 可复现条件 | 处理方式 |
| --- | --- | --- |
| 老依赖被频道更新挤压 | 旧私信未读，之后频道持续发帖，每次 Inbox 字符预算都被最新消息占满 | 聚合 Inbox 按最早未读顺序读取；长消息从既有偏移继续 |
| 把例子或引用变成新义务 | 在代码示例、Markdown 引用行、转义文本中提到真实 `@成员` | 自动解析仅识别有效正文；结构化 `mentions` 仍明确生效 |
| 连接器重试产生重复唤醒 | 相同连接器/用户/会话/消息重复送达 | 保存最近 4096 个已接收入站标识；重复直接返回 |
| 连接器收不到真实助手回复 | MessageHub 事件作者是稳定成员 ID，Mailbox 只比较 Session ID | 同时兼容稳定成员 ID 与历史 Session ID |
| 入站失败污染回复路由 | 第二个外部会话更新了路由，但发送到团队时抛错 | 恢复原路由，撤销去重标识，允许同一消息重试 |

未采用按文本语义判断“这个 @ 看起来无关”的自动取消：普通正文中的精确提及仍是当前公开契约中的明确请求，静默取消会增加遗漏。主任务读取的旧真实 smoke 还发现完成报告正文中多余的 `@` 触发额外回复任务；本次为引用旧日志与示例提供确定性隔离，并继续要求普通完成报告使用不带 `@` 的姓名。

## 实施改动

1. `packages/message/src/mentions.ts` 提取独立的引用/代码屏蔽与转义判断，保留位置和正文，不依赖模型推断。支持不同长度反引号围栏、波浪线围栏、行内代码、引用行与反斜杠转义。
2. `packages/message/src/hub.ts` 接入过滤器；持久历史恢复时也使用同一规则，避免重启后凭引用正文新造 Reply Task。保留历史上已经显式记录的义务，不追溯删除。
3. 简化 `readInbox`：移除“倒序选最新批次、再正序读取”的重复遍历和临时数组，直接在字符预算内顺序消耗最早未读。指定会话的历史分页 `read` 不改动。
4. `src/mailbox.ts` 修正稳定身份匹配，加入有界重试去重与发送失败回滚；关闭服务会清理去重状态。
5. `src/turn-reminders.ts` 将“全频道都需要才发送”补充为可操作的触发条件：决策、阻塞、已验证结果改变全频道工作时发送一条短更新；窄依赖私聊，详细证据留在 Task。
6. `packages/message/src/index.ts` 的工具参数说明和 `packages/message/README.md` 同步引用格式与最早未读规则，避免实现与模型可见语义脱节。

## 验证与限制

已执行并通过：

```text
node node_modules/typescript/bin/tsc -p packages/message/tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.package.json --noEmit
node node_modules/vitest/vitest.mjs run packages/message/tests tests/mailbox.test.ts tests/turn-reminders.test.ts tests/message-authorization.test.ts tests/collaboration-identity.test.ts tests/integration/event-bus.test.ts
```

结果：6 个测试文件，111 项测试通过。新增覆盖持续频道突发下旧依赖完成读取、代码/引用/转义不创建义务、引用旁的真实正文与结构化提及仍有效、围栏边界、历史恢复、稳定作者身份、连接器重试及失败路由回滚。MessageHub 包测试目前为 86 项。

环境观察：`pnpm --filter @dsh-agent-fleet/message test` 可执行；根目录 `pnpm exec vitest ...` 曾因 Windows PATH/shim 找不到命令失败。改用上述已经安装的 Vitest JavaScript 入口成功，没有通过安装依赖掩盖错误。

限制：

- 上述是本机确定性行为测试和 TypeScript 构建检查，没有在本子任务中运行真实付费多 Agent A/B 或容器负载试验，因此不宣称 token、耗时或成功率已经改善。
- 去重窗口是进程内最近 4096 条，服务重启或超出窗口的重复消息仍可能再投递；这不是持久化 exactly-once 保证。
- Mailbox 仍维持原有“每个团队助手一条当前外部回复路由”的约定。多外部会话同时向同一助手提问的逐请求回复归属需要进一步协议扩展，本次只修复失败路由污染。
- 引用屏蔽是有界 Markdown 常用格式处理器，不宣称完整 CommonMark 解析；普通正文仍可产生明确提及义务。
- 最早未读保证先前积压取得进展；在极长历史积压中，最新信息要等待先前消息读完。紧急请求仍应使用已有 interrupt/任务路径，不依靠普通频道帖实现抢占。

## 后续实验建议

以相同任务与预算比较消息数、频道通知数、显式提及响应率、任务完成率及耗时；仅降低消息数不能证明协作更好。建议至少分三种负载：一人实现加独立审查、小队并行窄依赖、全队共享接口变更。记录：

- 每项完成任务的 token 与墙钟时间，而非只看总消息数。
- `quiet` / `wakeup` / `interrupt`、私聊/频道比例，以及同一频道待消费通知替换数。
- 每条显式 Reply Task 从创建到首次实际答复的延迟；引用文本触发的伪义务数量。
- 未读依赖等待时间的 p50/p95/max，检测频道大量更新是否让旧依赖长期得不到处理。
- 发言量下降后是否出现遗漏共享决策、重复实现、冲突修改或无法复现实验结果。

旧报告中的候选晋升率属于工程验收记录；晋升次数、代数、代码变更量与协作消息降低都不能直接替代独立保留题上的能力提升证据。
