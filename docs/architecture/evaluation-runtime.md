# Fleet 评测运行方案

## 1. 背景与目标

Fleet 目前主要服务于有前台用户、WebUI 和持续 Team Session 的交互式场景。评测环境则通常只有一次输入，没有中途用户反馈，需要在无浏览器的进程或容器中运行到确定终态，并把答案、产物、轨迹、资源消耗和失败原因交给外部评测器。

本方案为 Fleet 建立独立但不分叉核心语义的评测运行路径。目标是：

- 一份任务输入能够启动 Team，并在没有人工操作的情况下运行到真实终态。
- 长任务被分解后，前台助理暂时 idle 或 dormant 不会导致宿主进程提前退出。
- 等待、超时、退出和结果采集由宿主代码负责，不依赖 Agent 反复轮询。
- 助理仍根据实际题目和成员职责自行设计 DAG；模板不固化某道题的流程。
- 结果、状态、成本和调试证据均可由机器稳定读取。
- 评测专用行为与交互式 Fleet、WebUI 和自迭代场景保持清晰边界。

## 2. 当前现状

### 2.1 已经具备的基础

Fleet 已经提供：

- 持久 Team、成员 Session、Task DAG 和 result stage。
- Work 的 `running`、`finished`、`blocked`、`failed`、`cancelled` 状态。
- 根 Task 和相关 Task 全部结算、相关成员 idle 后的自动终态收敛。
- Fleet 状态变更订阅和宿主级状态查询能力。
- 自动 Team 创建和一次性 bootstrap 指令投递。
- Session、Fleet state、事件、成员进展、共享文件和预算统计。

这些能力足以作为评测运行层的基础，不需要重写 Fleet 的协作模型。

### 2.2 当前阻塞项

#### DSH headless 生命周期与 Fleet 不兼容

官方 headless runner 只等待它创建的前台 Agent 进入 idle，然后汇总该 Agent 的最后输出并退出。Fleet 助理在启动 DAG 后会进入 dormant，正式成员仍可继续运行，因此“前台 Agent idle”不等于“团队工作完成”。

#### 现有 ALE 适配器依赖不存在的模型工具

`integrations/agents-last-exam` 要求助理每五秒调用 `fleet_run wait`，但当前公开的 `fleet_run` 工具没有 `wait` 动作。即使重新暴露模型工具，周期轮询仍会增加工具调用轮数、上下文和 token 成本，并依赖模型持续遵守轮询指令。现有 `FleetRunService.wait()` 等待的是 Team 离开 running 状态；全员短暂 idle 而 Work 仍在运行时也可能返回，因此不能直接充当评测完成条件。

#### 退出码和输出不能证明任务完成

当前 headless 退出码反映前台 Agent 的 turn 是否正常结束，而不是 Fleet Work 是否成功。现有 ALE 报告还硬编码了数据管道题目的文件名，不能作为通用输出协议。

#### Bootstrap 状态粒度不足

当前 ready marker 在 bootstrap 消息投递后写入。它只能证明 Team 已创建且消息已排队，不能证明助理已成功执行 `fleet_run start`，更不能证明 Work 已终止。

#### 交互式行为会进入无人评测环境

现有助理和部分 Team 模板包含前台用户沟通、持续项目、定时会议和中途更新等假设。评测环境没有用户回答问题，也不需要把过程消息发送到前台，但 Team 内部私聊、频道、回复和共享文件仍必须正常可用。

#### 安装链不适合可复现实验

现有 Web 镜像采用全局 DSH、全局 Harmony、profile 内 Harmony/Binding、运行时 profile 安装和手工配置相结合的方式。部分示例还通过 `sed` 修改旧 entrypoint，并重复使用同版本、同路径的本地 tgz。这会产生版本偏移、缓存复用、Bundle 顺序和首次启动重启等不确定性。

隔离探针已经验证：使用官方 DSH 入口时，Fleet 的宿主端能够在干净 headless profile 中加载到模型凭据检查，无需全局 Harmony 或 Binding。Harmony 主要服务 WebUI Source Patch，因此不应成为评测运行镜像的前置条件。

## 3. 总体架构

```text
外部评测器
    │ 任务文本或任务文件
    ▼
官方 DSH headless profile
    │ 禁用默认单 Agent runner
    ▼
Fleet eval runner（宿主代码）
    ├─ 创建一次性 Team
    ├─ 投递最小 bootstrap 指令
    ├─ 等待助理首轮完成并确认 Work 已启动
    ├─ 订阅 Fleet 状态变化并等待 Work 真实终态
    ├─ 原子写入答案、状态、指标、轨迹和产物索引
    └─ 按 Fleet Work 终态返回进程退出码
```

模型不负责保持进程存活，也不需要执行固定间隔的等待工具调用。宿主等待不进入 Agent 上下文，不增加模型轮次或 token。

## 4. 评测运行状态机

评测运行至少区分以下阶段：

1. `initializing`：解析配置、验证工作区和任务输入。
2. `team_created`：Team 和助理 Session 已创建。
3. `bootstrap_delivered`：一次性启动指令已投递。
4. `work_started`：助理已经成功调用 `fleet_run start`，Work 为 `running`。
5. `work_finished`、`work_blocked`、`work_failed` 或 `timed_out`：Fleet Work 的真实终态。
6. `artifacts_flushed`：Session、Fleet state、结果和指标已经落盘。

如果助理首轮正常结束但没有启动 Work，运行应以 `bootstrap_incomplete` 失败，不能把它当作成功或无限等待。

## 5. Eval runner 职责

Eval runner 应作为独立伴随组件维护，不把评测平台适配代码塞进 Fleet 主运行逻辑。它负责：

- 从 CLI/stdin 或外部评测器接收任务，并将权威任务内容写入稳定文件。
- 使用固定 Team 配置创建 Team；不让模型决定成员数量和基础权限。
- 让助理读取任务文件，根据题目和成员职责自行设计初始 DAG。
- 等待助理首轮 idle，检查 Work 是否已经进入 `running`。
- 订阅宿主侧 Fleet 状态变化，仅以 Work 终态或宿主超时作为退出条件。
- 在 SIGTERM、超时和异常时尽最大努力 flush Session 与 Fleet state。
- 从 result stage 或根 Task 直接取得默认答案，避免不必要的第二次总结调用。
- 在明确配置 `finalizeWithAssistant` 时，才额外唤醒助理生成自然语言最终答复。
- 输出稳定的机器可读文件，并返回可区分的退出码。

默认直接采用 Task result 可以降低成本，也避免助理在二次总结时改变已审核结论。

## 6. 通用输出协议

建议每次运行写入独立目录：

```text
evaluation-output/<run-id>/
├─ status.json
├─ answer.txt
├─ usage.json
├─ artifacts.json
├─ events.jsonl
├─ stdout.log
├─ stderr.log
├─ dsh-sessions/
└─ fleet-state/
```

### `status.json`

至少包含：

- schema version、run id 和阶段。
- Fleet Team id、Work id、根 Task id 和 result stage。
- Team/Work 终态及规范化失败原因。
- 开始时间、结束时间和持续时长。
- DSH、Fleet、评测集成、模型和镜像版本信息。
- workspace、task、Team config 和输出目录。

### `usage.json`

记录 Team 和每位参与者的模型、输入/输出 token、cache token、reasoning token、调用次数、重试、工具错误和可得成本估算。没有计价信息时保留 token，不推测价格。

### `artifacts.json`

记录评测期间新增或修改的工作区文件，包括相对路径、大小、媒体类型、SHA-256、创建者或关联 Task（可得时）。任务输入、依赖缓存、DSH/Fleet 内部状态和评测器保留文件应从业务产物列表中分离。

## 7. 退出码

建议采用稳定映射：

- `0`：Fleet Work 为 `finished`，且结果与必需状态已经成功写入。
- `2`：Fleet Work 为 `blocked`。
- `3`：Fleet Work 或关键成员运行失败。
- `4`：bootstrap 未成功启动 Work。
- `5`：配置、依赖或输入无效。
- `124`：评测超时。
- `128 + signal`：被外部信号终止。

评测适配器不得只根据前台 Agent 的 turn reason 返回成功。

## 8. 评测行为覆盖层

评测模式只增加简短、明确且不会污染普通模式的系统约束：

- 当前运行无人值守，不会收到中途用户答复。
- 先检查题目和工作区；信息确实不足时记录假设，无法继续时明确 block。
- Team 私聊、频道、回复、Meeting 和共享文件属于本地协作能力，不属于外部联网。
- 不向用户发送中途进度；关键进展应进入 Task、Team 消息或共享产物。
- 最终结论必须写入 result Task；需要验证证据时使用独立成员或 Vote。
- 不把模板中的示例、角色或流程反推为题目要求。
- 不为等待而反复调用模型工具；长进程保持 Task active，并记录 PID、日志和完成条件。

评测 Team 模板应保留通用角色和职责，但移除固定时间会议、持续项目维护和前台通知偏好。模板不能包含 Matilda、ALE 或其他具体 benchmark 的题目逻辑。

## 9. 安装与镜像策略

### 9.1 评测运行镜像

评测运行镜像仅包含：

- 固定版本或 digest 的基础系统与 Node.js。
- 精确版本的官方 `@deepseek-ai/dsh` 和 pnpm。
- 由确定 Git commit 打包的 Fleet tgz。
- Fleet eval runner 和模型 provider。
- benchmark 明确需要的语言、编译器或求解器。

该镜像：

- 不全局安装 Harmony。
- 不启动 WebUI、HTTP 服务或浏览器。
- 不在容器启动时执行 `pnpm add`。
- 不通过 `sed` 修改继承镜像的 entrypoint。
- 不使用 `latest` 或可漂移的 semver range。
- 使用全新的 episode `DSH_HOME`，避免跨评测污染。

### 9.2 事后检查镜像

WebUI、Harmony、Binding、渲染插件和调试工具放入独立 inspector 镜像。它以只读方式挂载评测输出，或复制快照后启动 WebUI。评测运行是否成功不能依赖 inspector。

### 9.3 构建身份

每个镜像和运行结果应记录：

- `fleet_main_commit`
- `evaluation_commit`
- Fleet tgz SHA-256
- DSH 与 provider 版本
- 基础镜像 digest
- 最终镜像 digest

本地 tgz 应以 commit 或内容散列命名，不能持续覆盖一个同名 `dsh-agent-fleet-0.2.0.tgz`。

## 10. DeepSeek Harness 上游改进

Fleet eval runner 是当前可独立交付的方案，不需要等待 DSH 上游发布。后续适合向 DSH 提出的通用能力包括：

- Headless activity lease：插件可以登记未完成的后台工作，runner 在前台 Agent idle 且 lease 全部释放后才退出。
- 可插拔 completion/result provider：插件可以提供进程终态、最终文本和退出码。
- `dsh plugin verify`：检查 profile Bundle、运行时解析、peer 来源、兼容性和 lockfile，而不只检查包是否安装。
- 明确的 Harmony launcher 安装命令，替代依赖 `npm_config_global` 的 postinstall 副作用。
- 让 profile 插件稳定复用官方 DSH 的 peer 实例，避免包管理器报告缺失、运行时再由 loader 或 Hook 补齐的双重语义。

长期还可以把 Fleet 宿主运行时与 Web/Harmony UI 附加层拆包，使 headless 安装不下载或声明不使用的前端 Patch 依赖。

## 11. 测试与构建门槛

正式构建通用评测镜像前，必须自动验证：

1. 助理启动 DAG 后进入 idle/dormant，而成员继续工作时，进程保持存活。
2. Work `finished`、`blocked`、`failed` 和 timeout 分别产生正确状态、文件和退出码。
3. 助理未调用 `fleet_run start` 时快速返回 `bootstrap_incomplete`。
4. 两成员 mock Team 能在无浏览器、无 Harmony、干净 `DSH_HOME` 中从单次输入运行到终态。
5. SIGTERM 能终止成员并保存可用的部分轨迹，不留下孤儿进程。
6. 重复使用相同输入但不同 run id 不会复用旧 Team、marker、Session 或业务产物。
7. 评测任务中的 Fleet 消息工具仍可用，且不会被外部网络限制误判为联网。
8. 产物索引、token 统计和终态报告的 schema 可由外部评测器稳定解析。
9. 容器构建在无运行时安装步骤的情况下通过 profile dump 和 mock provider smoke test。

现有 TypeScript 测试通过并不能替代这些端到端检查。评测适配器的 Python/脚本代码也必须进入 CI，而不能只做语法编译。

## 12. 分支边界

`evaluation` 是唯一长期评测集成分支，定期同步 `main`，不得演变为 Fleet 核心的第二套实现。

应进入 `main` 的内容：

- 通用 Fleet 生命周期或终态缺陷修复。
- 可复用的宿主等待、状态查询和结果 API。
- 不改变普通行为的 eval runner 接口。
- 通用 headless 测试基础设施。

保留在 `evaluation` 的内容：

- 评测容器、入口脚本和 inspector 镜像。
- benchmark adapter 与场景配置。
- 评测专用提示词覆盖层和 Team 模板变体。
- 资源、网络、超时和输出采集策略。
- 固定的依赖矩阵、镜像构建与复跑脚本。

若评测开发发现核心缺陷，应先以最小通用修复进入 `main`，再同步回 `evaluation`。不得在 `evaluation` 中长期维护 Fleet 核心文件的私有修补版本。

## 13. 实施顺序

1. 建立 eval runner 与 headless patch，去掉模型轮询。
2. 建立状态机、输出协议、退出码和超时/信号处理。
3. 增加评测行为覆盖层与通用小型 Team 模板。
4. 增加无 Harmony 的 mock headless 端到端测试。
5. 修正 ALE 适配器并将其纳入 CI。
6. 构建内容寻址、完全固定版本的评测运行镜像。
7. 构建独立 inspector 镜像。
8. 用至少一个代码任务和一个非代码长任务复跑，比较成功率、运行时、工具调用轮数、token、成本和产物完整性。
