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

## 追加：评测宿主 deadline 修复与交叉审查

主任务进一步发现 `superviseFleetEvaluationRun` 原先先无限等待助手 `whenIdle()`，之后才给 Work 启动计时器。若助手 bootstrap 卡住，内层永远没有超时结果，只能靠 Docker 外层强杀，评测状态与证据来不及导出。

本子任务已修 `src/evaluation.ts`：bootstrap、工作开始回调与 Work 等待共用从监督入口启动的一份 deadline；bootstrap 未创建 Work 也明确返回 `timed_out / 124`。超时后释放 Work 订阅，保留最后可读的团队状态。`waitForFleetEvaluationWork` 支持停止信号，处理订阅注册时同步回调先于 disposer 返回的竞态，并把订阅/状态读取异常转为可观察的 Promise 失败并清理计时器。

新增 6 项测试覆盖挂起 bootstrap、bootstrap 已消耗预算、挂起 work-start 回调、同步订阅完成、注册异常和异步事件检查异常。执行：

```text
node node_modules/vitest/vitest.mjs run --dir tests tests/evaluation.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.package.json --noEmit
```

结果：评测文件 17/17 通过，主机类型检查通过。临时主分支 worktree 存在仓库内时，未限定 `--dir tests` 的 Vitest 可能同时搜索该副本；报告采用限定目录后的结果，避免重复计算测试数量。

此外独立审查向对应作者提出了以下修复项（最终采纳状态以主报告和各作者验证为准，本子任务未越界修改它们）：ALE 失败退出仍凭结果文件判完成；grader 固定名称清理可能误删预存容器；resume 身份缺少实际输入内容哈希；group 标识可能掩盖跨 split 重复题；外层强杀绕过 Docker 清理；候选源码路径与实际评测镜像必须绑定；宿主向 Agent 可写目录导出训练摘要需要拒绝符号链接逃逸。

## 追加：第二轮部署链复核

复核运行 `node --test tests/self-evolution-curriculum.test.mjs evaluation/run-container.test.mjs`：共 19 项，17 通过、2 项 Linux 权限与符号链接测试在 Windows 跳过，无失败。确认回归覆盖了 invocation label 找回未写 cidfile 的已创建容器，以及清理未能验证时不能报告运行成功。

阅读最新实现确认已处理的路径：ALE 非零退出与不确定评分不再计作完成；grader 按 cidfile 的实例 ID 清理；batch 已有取消信号和子进程 finally 清理；输入正文/image hash 加入 resume 身份；相同正文即使不同 group 也不能跨分区；训练反馈写入宿主独立目录后只读提供给 Agent，测试循环的结果不会进入训练摘要。

同时把以下可部署性发现发给各作者继续处理；此处记录审查时状态，不能替代其最终部署验收：

- controller 镜像最初缺 PyYAML，ALE 官方 Python/venv 路径也可能不在 Compose 的挂载范围，必须验证控制器内部真正能调用 runner。
- 初版课程示例没有候选 image/buildCommand，与新加入的源码提交绑定校验冲突。
- 四个 ALE 场景在默认固定 seed 下恰好形成两 train、两 test、零 validation，初始化必然失败；小集合需要明确冻结分区，不应依赖随机碰运气。
- batch 内层最多等待 45 秒清理，curriculum 当时只给 15 秒后强杀；需要统一父子进程与 Compose 宽限时间。
- PID/hostname 锁不能区分容器重启后的 PID 复用；空 `.running` 锁在独立批测中也尚不能自动恢复。
- 候选工作区的 `.git/config` 可被候选脚本或 Agent 修改；宿主随后运行 Git 的过滤器/fsmonitor 可能执行候选命令。仅把 pnpm 放在容器内不构成完整宿主执行边界。
- 官方 HorizonMath 对数值已正确的答案还需要模型 compliance judge；离线无凭据 grader 会返回 indeterminate。严格训练完成门槛会因此阻塞推进。无 judge 的初始课程应显式选可离线权威评分的题型，不能把不确定结果改成通过。

没有运行利用载荷，也没有修改其他作者负责的部署文件。以上问题通过源码路径、配置与确定性分区计算定位；服务器侧实际修复与验证以主报告最终记录为准。

后续复核更新：演化作者已补 `python3-yaml`；上层终止宽限改为 curriculum 60 秒、Compose 120 秒；锁加入 Linux `/proc` 进程出生标识；对 Agent 可写仓库的 Git 命令改在隔离容器执行并用 bundle 导入宿主库；候选包构建增加 15 分钟默认期限和实例 cid 清理。复跑 curriculum **10/10**（含 PID 复用与运行时修改题目新测试）、HorizonMath adapter **3/3**，supervisor `node --check` 通过。这些源码与本机验证不代替服务器真实容器中的依赖、挂载和模型端点验收。

## 追加：真实部署失败的独立诊断

HorizonMath 首次启动报 `deps.messages.taskUnreadSummary is not a function`。本子任务检查调用链：`collaboration.ts` 直接实例化 `@dsh-agent-fleet/message` 的 `MessageHub` 并传入 task sync，没有替换为 mock 或删除方法。对本机打包产物与服务器 common baseline 的真实导入分别验证：后者从 `/opt/dsh-profile/profiles/headless/node_modules/dsh-agent-fleet/node_modules/@dsh-agent-fleet/message/lib/index.js` 解析；`hub.js` 的 SHA-256 均为 `cc49eac7ab72ac7b6de7fe0a3eb091261aece967238d38de2a6ad309782da480`，原型方法存在。

部署作者继而确认旧 provider overlay 同版本安装复用了过期 bundled 依赖，改为整体替换 Fleet 包目录后错误消失。没有在通用代码退回旧 unread API，因为这既掩盖部署不一致，也会损失本轮已验证的消息行为。

随后 178 毫秒 `bootstrap_incomplete` 的真实事件为 provider `NO_ADAPTER`。部署作者把仅有 evaluation runner 的 patch 与已有 provider patch 合并；本子任务在服务器最新 `dsh-horizonmath-fleet:20260908` 无网络临时容器中独立解析了最终 YAML：共四条 overlay，原 `headless-runner` 被禁用，仅插入一个 `fleet-evaluation-runner`，`llm-pi-ai` 注册 `memorax`，另有一条 `agent-default-model` 覆盖，没有重复插入。未根据快速失败猜测或修改 `followup/whenIdle` 调度，仍需以新运行实际模型事件确认端到端恢复。

最终独立读取 `runs/horizonmath-mzv-provider-fixed/mzv_reduction_zeta_3_3_3/attempt-001/results`：模型已实际执行，并在开始后约 **186 秒**调用 `fleet_run start` 创建 Work；总计 **300,108 毫秒**后按共享期限导出 `timed_out / 124`，Team 为 paused，Work 仍 running。本轮不是成功完成的基准成绩。

导出证据的计数如下：

| 项目 | 实测 |
| --- | --- |
| 团队事件 | 50 |
| 协作消息 | 2，均为 core-engineer 与 quality-engineer 之间的私聊；频道正文消息为 0 |
| 系统通知 | 8：4 个 owner-task-list wakeup，4 个 sole-active quiet FYI |
| Inbox 事件 | 4：2 次 delivered、2 次 read；最终 4 个成员/助手 Inbox 均 dormant，未读数为 0 |
| 持久任务 | 9：4 Inbox、1 根 composite、3 Goal、1 Reply |
| 完成状态 | 推导 Goal、实现 Goal 与 Reply 已完成；验证 Goal 和根 composite 仍 running |
| 团队计量 | 45 次已计量模型调用，另 1 次 unmetered；input 94,741、output 30,103、cache read 776,960 tokens |
| 启动助手计量 | 11 次调用，input 27,469、output 18,931、cache read 209,664 tokens |

团队 `used=901804` 包含 cache-read，不能当作全额新生成 token 或货币费用。助手还创建了一个普通 DSH subagent，它有独立轨迹但没有出现在这份 Team 成员用量表中；这份 Team 统计不能冒充本次容器全部调用总成本。

助手实际工具顺序为 `read → subagent → str_replace_editor → read → bash → job_output → list_agents → send_message → str_replace_editor → fleet_run`。其中 `bash` 对助手不可用，返回 `UNKNOWN_TOOL`；把 subagent ID 当成 job ID 查询也失败。三个实际 Team 成员随后使用了 `fleet_task`、`fleet_goal`、`fleet_inbox`、`fleet_send`、`fleet_reply` 及文件/命令工具。该题的主要可见延误在启动助手先自行推导、调用普通子代理并重写题面；没有证据把这次超时归因于频道刷屏。

据此仅收紧 `src/evaluation.ts` 的评测启动指令：题面角色属于执行成员，助手读取任务后直接创建有 owner、依赖与验收条件的初始 DAG，复用权威任务路径；求解、代码与验证交给现有 Team，启动前不创建普通 subagent，成功后结束启动回合。保留 standard preset 与普通产品工具权限。`evaluation.test.ts` 与 `auto-bootstrap.test.ts` 合计 **24/24** 通过；这些回归只验证运行与拼接链未被破坏，不能证明新指令已改善模型服从率或基准成功率，后续需要同题同预算实测。

最后复核服务器长跑桥接配置：server-base 的 bridge 路径和端口环境会继承到 generic generation 镜像；controller 向后代明确传 provider、模型与 API 配置，并通过既有服务器 env 文件传凭据；ALE 的官方 checkout 与绝对解释器链接目标另有只读 Compose 挂载。课程的 train 反馈在 train 阶段结束时单独导出，validation/test 结果只留宿主 ledger；Agent 挂载仍为单代 `/training-feedback`，没有发现新代码把 sealed episodes 暴露给训练代。后台 bridge 尚无专门 readiness/存活门槛，因此已要求部署作者检查 bridge 日志和真实模型请求，网页可访问本身不证明模型端点正常。本子任务没有为这个尚未实测的可能性扩大修改范围。

## 追加：长跑终态与预算边界审查

后续只读审查发现终态退出与自动重启策略的冲突，已立即提交演化作者处理。审查时 `container-controller.mjs` 使用 `Promise.race`，任一控制子进程正常退出就终止另一个并退出 0；已有 state 非 running 时则退出 1。Compose 配置 `restart: unless-stopped`，不是仅失败重试：已经进入长期监控的控制器正常退出也会被重启。Docker 文档同时说明重启策略需容器已成功运行至少 10 秒，因此不能无条件断言每种冷启动失败都会无限重启；长跑终态仍需要明确静置，而非靠进程退出表达永久完成。[Docker 官方重启策略](https://docs.docker.com/engine/containers/start-containers-automatically/)

更直接的预算缺口是：`startCandidate` 已拒绝 `nextGeneration > maxGenerations`，正常路径通常不会产生第 max+1 代；因此 curriculum 的 `stable.number > maxGenerations` 退出条件并不能终止预算已耗尽的运行。失败候选也会消耗 nextGeneration，而稳定代编号可能始终低于上限。最后稳定代及 guardian 若只失去控制进程，仍可能继续运行；supervisor 的 SIGTERM 当前只关闭 watcher 和 monitors，不能等价于停止代容器。

建议修复范围是可信控制面的终态处理：预算用尽后等待已分配候选的明确接受/拒绝及本代课程终结，持久保存停止原因，停止本次 run 的代容器并保留证据；controller 对 stopped/failed/budget_exhausted 安静驻留，等待显式恢复或退出信号，不反复 init/启动，并在状态与健康元数据中区分运行、停止和需处理的失败。本子任务未改这些跨作者文件，最终采纳和回归结果须以演化报告为准。

## 追加：首代自动停止后的模型证据

只读复核服务器 `runs/evolution-init-corrected/generations/g0001/archive/dsh-context.tar.gz`。使用已驻留 controller 内的 Node 解析归档，按 `zstdDecompressSync(..., {info:true})` 返回的实际消耗字节逐帧推进，避免只解出第一帧 session header 后误报“没有响应”。此过程未启动新容器或模型调用，输出限定为 ID、事件/工具类别、计量与错误代码。

- 归档共 14 个 session，7 个有实际模型响应；合计 **75 个唯一序号的 assistant/message**，75 个均有 usage。归档累计 input **227,858**、output **19,236**、cache-read **2,870,016** tokens，不能把 cache-read 与新生成量混为一项费用。
- 正式 Team `team_51de55c6-23cb-4649-b75c-e903b02d9854` 有 7 名成员，但这 7 个 session 都没有模型响应。活跃 session 是启动助手（37 次）以及它新建的 6 个普通 DSH subagent（合计 38 次）。正式 Team 的归档状态为 idle、Work 缺失，事件没有 `work_started`。
- 实际工具调用记录 100 条：read 42、bash 22、glob 17、subagent 6、write 6、grep 2、fleet_run 2、edit 1、fleet_send 1、fleet_task 1。工具错误记录 11 条：`UNKNOWN_TOOL` 5、`FS_NOT_FOUND` 3、`FS_NOT_OBSERVED` 2，以及 1 条无结构化 code 的错误结果。
- 助手的两次 `fleet_run` 分别是 create 和 list，从未调用 start。create 被“当前 Session 已绑定现有 Team 前台助手，创建新 Team 需独立 Session”的保护拒绝；list 成功。5 次 UNKNOWN_TOOL 是助手调用 bash 4 次、write 1 次。这是启动职责执行不正确的证据，不能描述成正式 Team 已完成演化任务。
- 最终读取的宿主 state 为 stopped，g0001 的 phase 为 stopped，源码提交 `1fb7fa4eec05a31229f92ee8122cc995154eab6e`；停止时间为 `2026-09-07T21:29:01.420Z`。驻留控制器的终态快照为 stopped、reason=existing_stopped、needsAttention=false。演化作者此前观察到预算耗尽原因，后续驻留启动可能更新了 reason；两者应按时间区分，不能用当前字段反推原始停止原因。

这些证据支持“服务器 provider 确实返回了模型响应，首代归档并停止，终态控制器驻留”的基础设施验收。它们不支持“正式 Fleet Team 完成一代递归改进”或“训练/保留集能力提升”的结论；启动助手仍绕过正式 Team，应作为后续明确的流程验收缺口保留。

根据这份归档的确定性行为证据，最后仅增强 `src/auto-bootstrap.ts` 的通用自动启动消息：明确 Team 已由宿主创建且助手已经连接；不重复 create、不用普通 subagent 模拟现有成员；必要读取与确认成员后直接以权威任务路径调用 `fleet_run start`，把调研、求解、实现、验证交给 Team 的 Goal；启动成功即结束本启动回合。该变更与 evaluation 的更具体职责说明一致，没有改普通工具权限、成员能力或非自动启动消息。再次运行现有 auto-bootstrap 与 evaluation 回归，**24/24** 通过；未额外付费重跑，不宣称提示修改已提高模型服从率或端到端成功率。
