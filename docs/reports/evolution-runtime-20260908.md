# 递归自进化运行底座改进（持续记录，2026-09-08）

## 目标与证据口径

保留旧蓝绿代际监督器的父代独立审查、候选自证和三代滑窗，增加每代训练抽样、跨 benchmark 的周期验证与密封测试。所谓“训练”是系统软件与协作流程的迭代，不是模型权重训练。

已阅读 `output/pdf/fleet-self-evolution-technical-report-20260906.tex`。62 代包含 40 次晋升、20 次拒绝；26.21 小时后首次达到稳定传链。312 个提交中有大量 evidence，无法用提交数或代码行数证明能力提升。截至 g0059 的同口径成本为 1.492B token、19,008 次模型调用、206 次全员 idle 恢复；g0060–g0062 不在该成本口径。不能把工程闭环稳定等同于真实任务正确率提高。

可用线索已落入本次设计：用外部真实题评估价值，训练反馈短摘要加有限证据，宿主负责超时和恢复，独立审查保持，避免每代把所有旧记录再次灌进上下文。

## 已实现

1. `scripts/curriculum.mjs` 提供固定 seed、train/validation/test 分区、按 benchmark/domain 平衡抽样、每代训练、每 5 代验证/每 20 代密封测试的默认周期。小数据集必须显式提供非空且互斥的分区，不能静默把零题评测当作通过。
2. 宿主 ledger 原子持久化抽样、源 commit、attempt、结果、课程摘要与镜像。完成 episode 在重启后直接复用，失败具有有限重试次数。PID/start-time 身份锁防止同一 run 被重复调度，也避免容器重启 PID 复用造成永远无法恢复。
3. 数据 seal 包含 manifest、题目正文和 ALE experiment 内容；跨 problem family 的精确正文重复不能分到不同 split；启动和执行前检测数据变化，运行中不能悄悄更换 holdout。
4. 每个 benchmark 支持宿主可信 `buildCommand`、`image` 的 `{commit}`/`{generation}` 模板，构建本代冻结源镜像。benchmark adapter 检查镜像 revision 等于源 commit。缺镜像或来源不匹配的 episode 明确失败，不会悄悄评测旧 Fleet。
5. 训练专用反馈导出到宿主 `curriculum-feedback/<generation>/` 并只读挂载 `/training-feedback`。摘要包含任务编号、domain、score、结构化反馈和相对证据索引；只从宿主确定路径导出有限大小的训练题正文、答案、events、solution.py、agent log，拒绝 symlink。验证与测试题/原始日志/成绩不会进入该目录，不复制到 Agent 工作区或继承链。
6. 稳定代通过 `training-feedback.mjs` 事件等待本代结果。宿主 `start-candidate` 检查自己的 ledger 中本代训练已完成，测试/验证成绩不参与晋升或版本选择；团队仍以训练诊断和独立工程审查产生下一代。
7. 课程模式冻结 supervisor/Compose/Dockerfile 控制面，禁止候选接管宿主监督器。候选的 pnpm 脚本及可能执行 hook/filter/fsmonitor 的 Git 命令放在无 socket、无密封数据挂载的构建容器。宿主只导入 Git bundle 的对象数据，不执行 Agent 工作区配置。原来的非课程模式保持兼容。
8. 修复 stop 忽略容器回收失败后仍标记 stopped 的问题；现在保留 stop_failed/retirement_failed 及异常，可重试，不伪称资源已清空。

## 可重复部署

已新增 `controller.Dockerfile`、`compose.controller.yaml`、入口 `container-controller.mjs`。控制器固定 hostname，Compose `unless-stopped`，持久状态，前台监督器和课程调度器任一退出即一起重启，健康检查只验证控制器存活。唯一的 Docker socket 留在可信控制器中，Agent 容器不挂载。

新增通用 `base.Dockerfile`、`generic.Dockerfile`、`compose.generic.yaml`，公开依赖版本固定。新的默认路径不嵌入 Memorax 包或私有令牌；provider/model/API endpoint 与凭据变量名由部署环境指定，凭据只来自服务器已有 env 文件。旧 legacy Dockerfile 仍可用于旧实验复现，但新 controller 默认走 generic runtime。

服务器文件已部署在 `/data/zzr/dsh-agent-fleet-evaluation-20260908/evolution`。`dsh-fleet-evolution-controller:20260908` 最终镜像构建成功，镜像 ID 为 `sha256:3e0eb42cd117964bc2e165b7d423e445a29d6527a95b96f7979e0d643193f3c0`。部署只使用新任务目录，没有清理无关 Docker 对象，没有上传本机私有 provider。

完整启动要求：源码需是可解析且干净的 Git commit；controller/base 镜像就绪；课程 manifest 包含明确非空分区；每代镜像构建配置与官方 benchmark 环境兼容；provider 能在通用运行时调用。绝不能用固定旧 image + 新 commit 标签代替真实源码构建。

## 验证记录（持续更新）

- 本机新增 Node 行为测试：11/11 通过。覆盖可复现抽样、domain 平衡、分区隔离、精确重复泄漏、正文变更 seal、并发锁、PID 复用、持久恢复、有限得分要求、训练只读导出、验证/测试原始日志不导出、事件等待与来源绑定。
- 服务器 Linux 最终 11/11 行为测试通过，与本机一致。
- 旧 self-evolution-control / protocol / self-evolving-template 的最终 Vitest 过滤验证：3 个文件、10 项通过。
- controller 镜像构建成功；基于预置空运行 fixture 的首次启动、健康检查、Docker restart、更新心跳全部通过。该测试无模型、无 generation、无 Docker socket，验证控制面恢复，不冒充真实模型跨代长跑。

## 当前部署阻塞和剩余边界

1. 官方 ALE 的运行器和 Python 依赖需要在 controller 内可用。现有服务器路径 `/data/zzr/frontal-team/ale/repo/.venv/bin/python` 不一定在容器 mount 中，也不能假定宿主 venv 可跨发行版搬运；需要显式挂载/安装并实际 dry-run。已为通用 controller 加 PyYAML，ALE 扩展仍须验证。
2. 服务器 ALE 四个场景若仅按默认 hash 分区会缺 validation；必须以冻结 manifest 明确分成 train/validation/test。四题只够编排冒烟，不能支撑自进化统计结论。
3. 新的 generic generation/provider 组合尚未完成真实首代 Agent 启动。服务器已有内部 provider 用于已有测试，但通用运行时不应复制其私有包；在 endpoint 不兼容时应记录 live generation 阻塞。
4. 正常超时/SIGTERM 有优雅结束和 Docker 清理路径；机器断电或 controller SIGKILL 后，仍需基于持久容器归属回收旧 attempt，当前不能声称任意硬崩溃都零孤儿。这个边界会在主报告保留。
5. 新增课程 retention 已完成并有行为测试：仅删除 ledger 中明确记录且不属于当前 stable/guardian/candidate 或保留窗口的构建镜像与源码快照；保留 episode 原始证据、Git 历史和 ledger。原蓝绿代的工作区、镜像与卷仍由原监督器管理。
6. 隔离承诺针对共享工作区/挂载/宿主程序权限；固定模型服务属于共同可信外部依赖。没有声称在恶意模型服务侧也建立信息论隔离。

## 最终服务器控制器冒烟证据

- 目录：`/data/zzr/dsh-agent-fleet-evaluation-20260908/runs/controller-smoke-1788814371922`
- 机器可读结果：上述目录 `smoke.json`。
- 构建日志：`/data/zzr/dsh-agent-fleet-evaluation-20260908/controller-build.log`。
- 结果：`status=passed, health=true, restart=true, freshHeartbeat=true`。
- 测试容器仅以本次明确创建的名称启动，结束后精确 `docker rm -f` 删除；不留下冒烟容器，不使用全局 prune。
- 尚未验证：真实 `init` 的模型团队启动、首个真实训练 episode 驱动修改、候选晋升并进入下一代。不能将空运行恢复冒烟写成完成这些步骤。

## 向主报告交接

可提交内容为 `examples/self-evolving-team/` 的新增通用容器、课程运行器和受限控制面，`tests/self-evolution-curriculum.test.mjs`，以及本报告。`outputs/evolution-controller-smoke.mjs` 和上传 tar 是本次服务器操作工件，不属于产品源码。代码未修改根 package.json、src/、integrations/，没有自行创建分支或提交。
