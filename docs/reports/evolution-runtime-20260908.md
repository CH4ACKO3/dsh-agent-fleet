# 递归自进化运行底座改进（持续记录，2026-09-08）

## 结论与证据口径

已实现并部署冻结控制面、逐代构建、训练/验证/密封测试分离、有限重试、恢复及预算终止。服务器完成真实首代源码打包、镜像构建、Agent 容器健康启动、模型响应、两项有界训练任务调度和自动停止。当前保留静置控制器与证据，没有继续付费运行的代容器。本轮没有得到有效 benchmark 分数，没有发生训练结果驱动的候选晋升，也没有完成完整 Fleet Team 工作闭环。

这里的“训练”指软件与协作流程根据训练题迭代，不是模型权重训练。新增 bootstrap 提示与协作策略尚未做模型 A/B，不能据此宣称收益。

## 旧实验复盘及实际改进依据

已阅读 `output/pdf/fleet-self-evolution-technical-report-20260906.tex`。62 代包含 40 次晋升、20 次拒绝；26.21 小时后首次达到稳定传链。312 个提交中有大量 evidence，无法用提交数或代码行数证明能力提升。截至 g0059 的同口径成本为 1.492B token、19,008 次模型调用、206 次全员 idle 恢复；g0060–g0062 不在该成本口径。

由此落实的改进是：使用外部任务评估价值、把训练诊断做成短摘要加有限证据、让宿主负责期限与停止、保留独立审查，同时避免每代把所有旧记录再次灌进上下文。工程闭环稳定、模型能返回、官方任务通过和统计上能力提高是四种不同证据。

## 已实现的课程与信任边界

1. `scripts/curriculum.mjs` 提供固定 seed、train/validation/test 分区、按 benchmark/domain 平衡抽样。默认每代训练、每 5 代验证、每 20 代密封测试。小数据集必须显式提供非空且互斥的分区，不把零题评测当作通过。
2. 宿主 ledger 原子持久化抽样、源 commit、attempt、结果和镜像。重启复用已完成 episode，失败具有有限重试次数。PID 加进程 start-time 的锁既阻止并发调度，又允许重启后回收 PID 复用造成的旧锁。
3. 数据 seal 包括 manifest、题目正文和 ALE experiment 内容。相同正文不能通过不同 group 绕过分区；加载及执行前检测题目变化，更换 holdout 必须创建新 run。
4. 可信宿主 `evaluation/build-generation-image.mjs` 按冻结 commit 构建 common Fleet、服务器已有 ALE/provider overlay、HorizonMath 派生镜像，每一步核对 OCI revision。Agent 自身 pnpm 及 Git hook/filter/fsmonitor 在无 Docker socket、无密封数据挂载的容器中执行；宿主只导入 Git bundle 对象。
5. 候选源码不可替换正在运行的 supervisor、Compose、Dockerfile 控制面。课程模式禁止旧模式的 supervisor 自动接管。原非课程模式保留兼容，README 已明确界定。
6. 训练证据只导出到宿主 `curriculum-feedback/<generation>/`，只读挂载 `/training-feedback`。摘要含任务编号、domain、score、结构化反馈和相对证据索引；固定 allowlist 限量导出训练题、答案、events、solution.py 和 agent.log，拒绝 symlink。ALE 没有 manifest `task` 文件时读取可信适配器标准化的 `output/results/task.md`。验证/测试原文、分数和日志不进入 Agent、工作区或继承链。
7. `training-feedback.mjs` 等待本代训练完成。宿主拒绝在训练未获得有效评分时启动候选。结果必须回显正确的 taskId/split/sourceCommit，completed 必须有有限数值 score；测试与验证分数不用于选训练版本或晋升。
8. Agent episode、构建脚本和控制面子进程各有期限及信号清理路径；候选打包默认最多 15 分钟。最外层给清理留出宽限，不抢在 batch/launcher 清理之前强杀。
9. `maxGenerations` 按已消耗代号计算，包括失败候选。最后应执行的课程终结后，可信控制器停止本 run 的代容器并保存归档；终态进程静置，不因 Compose 自动重启而继续付费。稳定代变化竞态有检查，不能拿上一代成绩提前停新晋升代。
10. `retainGenerations` 只回收 ledger 明确记录且已退休的源码快照、最终镜像及 common/ALE 中间镜像；保留活跃代、共享 tag、Git 历史和原始证据。stop 清理失败保留 stop_failed/retirement_failed，不伪称已停止。

固定模型服务仍属于可信外部依赖；隔离承诺针对 Agent 工作区、挂载与宿主执行权限，不宣称模型供应方具有信息论隔离。机器断电、controller SIGKILL 等硬崩溃后的任意旧 attempt 容器回收仍需进一步做持久 ownership 验证，本轮没有据此声称零孤儿。

## 容器与服务器接线

`controller.Dockerfile` 固定 Node 22.22.3、pnpm 11.19.0、Docker CLI 28.5.1，安装 Git、Python 和 PyYAML。`compose.controller.yaml` 固定 hostname、持久状态、120 秒停机宽限。Docker socket 仅属于可信控制器。健康输出明确区分 initializing/running/stopped/failed，失败或过期心跳为不健康。

公开 `base.Dockerfile`、`generic.Dockerfile`、`compose.generic.yaml` 不包含私有 provider。`server-base.Dockerfile` 是可选服务器派生层，仅从服务器已经存在的 provider 镜像取用包；本次没有上传用户本机私有 provider。模型 metadata 和 endpoint 通过环境配置，凭据只来自服务器 `secrets/provider.env`（权限 600）。服务器桥接进程监听容器内 3082，继续使用原服务器供应方地址，没有把 Memorax 凭据送到公共 DeepSeek endpoint。

服务器公共前缀为 `/data/zzr/dsh-agent-fleet-evaluation-20260908`，下表均相对于该前缀：

| 用途 | 路径或身份 |
| --- | --- |
| 可信产品源码 | `source` 与最终部署模板为 `61a5d84114f452405c8ff8cb427936aabc901e55`；已运行控制面仍按 `d6e7eb4cf6713ea92e0d124b6af0ba80596b5571` 记录 |
| 本轮 Agent 源 Git clone | `seed-1fb7fa4`，`1fb7fa4eec05a31229f92ee8122cc995154eab6e` |
| 最终待启动源码 Git clone | `seed-release-61a5d841`，干净 detached HEAD，`61a5d84114f452405c8ff8cb427936aabc901e55` |
| 部署 Compose/控制器构建目录 | `evolution/examples/self-evolving-team` |
| 生产课程配置 | `curriculum-config/curriculum.json`，SHA256 `badd1b978dde344b472e44c599b71027cfab0922833b3d60f073fdb2a3630b23` |
| 本轮有限冒烟配置 | `curriculum-config/curriculum-init-smoke.json`，maxGenerations=1、maxAttempts=1、每任务 Agent 120 秒 |
| 本轮部署环境文件 | `curriculum-config/deployment-live.env`，仅路径与模型 metadata，实际凭据另存 |
| 本轮状态与证据 | `runs/evolution-init-corrected` |
| 控制器 | `evolution-final-1fb7fa4-controller-1` |
| 已停止代项目 | `self-evolve-c283d395-g0001` |

控制器镜像 `dsh-fleet-evolution-controller:20260908` 实测 ID 为 `sha256:8356313b2ec1650561ca758ef3eb48b2b4bfc443cdd691c6bb5850a3b9b8e5f1`。公开 base ID 为 `sha256:0c5910a7b73eabf745e421f2e05124c71d84e1bd890b0fdbb492d6d8026632cc`；服务器 provider base ID 为 `sha256:6f2bfe29b1a97368336774eb13b2007f3fe9b4ea616013154f2763213bf2e367`。本轮逐代 benchmark 镜像 tag 的完整后缀是上述 `1fb7fa4...`，没有以最新控制面 SHA 冒称 Agent 已更新。最后 ALE 网络与证据导出修复在本轮终止后提交，未用于本轮模型实测；最新交付 SHA 由主报告登记。

`configure-server-curriculum.mjs` 已生成真实 command/buildCommand 路径 `source/evaluation/batch-run.py` 与 `source/evaluation/build-generation-image.mjs`。ALE 四场景固定训练 2、验证 1、测试 1；HorizonMath 只选可完整离线评分的 65 题，训练 39、验证 13、测试 13。完整 136 题的原始 manifest 保留；numeric-method compliance 缺官方 judge 时保持 indeterminate，不改成通过。四个 ALE 场景仅够编排冒烟，不能支撑跨域统计结论。

ALE 使用服务器官方 `repo/.venv`，其 Python 是指向 `/home/zzr/.local/share/uv/python/cpython-3.13.9-linux-x86_64-gnu/bin/python3.13` 的绝对 symlink。`compose.controller.ale.yaml` 显式只读挂载 ALE 父目录与 uv interpreter tree；控制器内 `python -m ale_run --help` 已成功。最终增补 Linux `network_mode: host`，让官方 native ALE 的 `localhost:<动态 CUA 发布端口>` 指向宿主；Agent 容器继续使用各自网络。

## 首代真实运行及精确结果

启动前发现并修复三个工程问题：Git local clone 的 upload-pack 未继承临时 safe.directory（改为仅本 run 精确 source 路径的可信 gitconfig）；只读 `.self-evolve` 内未预建嵌套 control mountpoint（打包后可信宿主创建）；通用 runtime 需要启动已有服务器 provider 的本地 TLS bridge。旧失败尝试保留在 `runs/evolution-init-final` 等目录，没有保留旧代容器。

g0001 在 `2026-09-07T21:24:16.798Z` 写出 bootstrap-ready，团队 id 为 `team_51de55c6-23cb-4649-b75c-e903b02d9854`，源码为 `1fb7fa4...`。归档白名单统计发现 75 个实际 assistant 响应，均有 usage：input 227,858、output 19,236、cacheRead 2,870,016。这证明真实 provider 返回。14 个 session 中，活跃的是助手 37 次响应加 6 个普通 subagent 共 38 次响应；7 个正式 Team 成员响应为 0，目标 Team 仍 idle/work=null，未记录 work_started。

进一步检查工具类型：助手的两次 fleet_run 分别是被保护规则拒绝的 create（已是 foreground assistant，不能替同一原生 Session 再建团队）和成功的 list，没有 start；另外有 bash 四次、write 一次 UNKNOWN_TOOL。不能把 runtime/bootstrap-ready 和模型成功响应写成完整 Fleet 团队开始工作。这个实测诊断为下一轮 Agent 引导修复提供了具体入口。

| 训练任务 | 最终结果 | 原因与证据 |
| --- | --- | --- |
| ALE `k8s-migration` | failed，124.169 秒，官方分数缺失 | 控制器 bridge 网络内请求 `http://localhost:32904`，120 秒 CUA readiness 连接拒绝；`curriculum/episodes/g0001/train/8ce73913afbc10755cd1/attempt-1/agent.log` |
| HorizonMath `hadamard_668` | timeout，123.089 秒，exit 124 | Agent 在 bootstrap 或 Team 工作阶段达到 120 秒预算；`curriculum/episodes/g0001/train/bf623ec991be0f7406df/attempt-1/agent.log` |

两项 ledger 记录各 attempt=1、trainingComplete=false，没有把超时、缺官方成绩或基础设施失败当作零分/通过，也没有解锁下一代。未运行周期 validation/test，未产生候选晋升。

随后课程于 `21:28:57.517Z` 持久化 `generation_budget_exhausted`；宿主停止 g0001 并归档，run 于 `21:29:01.420Z` 标为 stopped，controller 于 `21:29:01.454Z` 进入 stopped 静置。最终核验本 run 的代容器和代卷均已删除，仅控制器存活。手工重启此控制器再次返回 `healthy=true, phase=stopped`，没有重新启动代或模型；当前 terminal reason 为 `existing_stopped`，原预算原因仍保存在 `curriculum/completion.json`。这里 healthy 表示终态控制器存活，并非任务通过。

ALE 网络问题已最小修复，并于 `21:35:19.714Z` 用相同 Compose 的一次性 controller 成功访问宿主 `127.0.0.1` 随机 HTTP 端口。`runs/evolution-init-corrected/ale-network-fixture.json` 记录 `status=passed, networkMode=host, reachable=true, modelsInvoked=0`，fixture 容器已精确删除。未因该修复重跑付费首代或官方完整 episode。

## 验证记录

- Node 课程行为测试 11/11：抽样、domain 平衡、分区与正文 seal、重复泄漏、锁/PID 复用、重启复用、结果绑定、训练导出、密封结果不回流、等待机制与 retention。最后增加 ALE 标准题面 fallback，训练题正常导出、密封题不导出。
- 终态预算测试 3/3：资源停止、失败健康状态、已消耗候选代数、稳定代切换竞态；中间镜像与共享 tag retention 1/1；共享 builder 行为测试通过。
- 旧 self-evolution-control / protocol / self-evolving-template：3 文件、10 项通过。全仓库与远端 CI 的最终口径由主报告记录。
- 早期无模型空状态 fixture 的启动、心跳、Docker restart 已通过，结果 `runs/controller-smoke-1788814371922/smoke.json`；不冒充学习。
- 本轮真实首代已完成源码打包、运行时包 SHA 核对、provider 响应、有界两任务调度、自动预算停止与终态 restart 验收。完整 benchmark 成功和多代学习尚未验收。

## 操作入口与最终留存状态

当前没有长跑模型任务，只有 parked controller。检查状态使用专用 health 命令，避免打印含身份令牌的原始 `state.json`：

```sh
docker exec evolution-final-1fb7fa4-controller-1 node /opt/controller/scripts/container-controller.mjs health
docker restart evolution-final-1fb7fa4-controller-1
```

本次实际启动命令如下。已有 stopped 状态执行该命令只会保留静置，不能据此“恢复学习”；它可恢复控制器与证据访问：

```sh
docker compose --env-file /data/zzr/dsh-agent-fleet-evaluation-20260908/curriculum-config/deployment-live.env \
  -f /data/zzr/dsh-agent-fleet-evaluation-20260908/evolution/examples/self-evolving-team/compose.controller.yaml \
  -f /data/zzr/dsh-agent-fleet-evaluation-20260908/evolution/examples/self-evolving-team/compose.controller.ale.yaml up -d --build
```

活动 run 若需完全停止，先执行以下可信停止命令，再对相同 Compose/env 执行 `down`。单独停止 controller 不等于停止代容器。本轮已经完成第一步，可直接 down 释放静置控制器：

```sh
docker exec evolution-final-1fb7fa4-controller-1 node /opt/controller/scripts/supervisor.mjs stop \
  --state /data/zzr/dsh-agent-fleet-evaluation-20260908/runs/evolution-init-corrected
```

新的学习 run 使用新的 state 目录、明确 Git seed/ref 和冻结 curriculum；不得修改旧 run 的 seal、ledger 或 stopped 状态冒充续跑。生产 `curriculum-config/deployment.env` 已绑定实际存在的干净 `seed-release-61a5d841` 和完整 ref `61a5d84114f452405c8ff8cb427936aabc901e55`，不再依赖缺失的 seed-final。生产 state 为 `runs/evolution-server`，目前仅有空目录、无 state.json，未开始初始化或调用模型。接下来的真实迭代仍需验证助手能正确进入 Fleet Team；当前 max=20 配置已具备启动接线，本轮未留下它后台运行。

最终发布静态验收记录在 `curriculum-config/release-ready-61a5d841.json`：完整 Git clone 的 599 个跟踪文件与 `evolution/` 部署快照逐项 SHA-256 一致；Compose host 网络、源码/课程/凭据文件/官方 ALE/uv Python 路径、69 个课程任务指向及现有基础镜像均通过检查。旧 `deployment-live.env`、有限测试配置、生产课程 JSON 哈希保持不变。原部署目录在同步前备份为 `evolution-before-release-61a5d841.tar.gz`。未重建镜像或重启 parked controller，实测镜像身份仍是上文记录值。

生产入口已准备好；以下命令会构建最终控制器并开始新的真实任务，本轮仅做了 `config --format json` 静态验收，没有执行 `up`：

```sh
docker compose --env-file /data/zzr/dsh-agent-fleet-evaluation-20260908/curriculum-config/deployment.env \
  -f /data/zzr/dsh-agent-fleet-evaluation-20260908/evolution/examples/self-evolving-team/compose.controller.yaml \
  -f /data/zzr/dsh-agent-fleet-evaluation-20260908/evolution/examples/self-evolving-team/compose.controller.ale.yaml up -d --build
```

主要证据包括 `controller-terminal.json`、`controller-health.json`、`curriculum/completion.json`、`curriculum/ledger.json`、两项 episode 的 result/log，以及 `generations/g0001/archive/dsh-context.tar.gz`。archive 排除 profile 和 node_modules，但仍可能含任务上下文，不应公开完整文件。操作脚本和 tar 在本机 `outputs/`，不作为产品源码提交。
