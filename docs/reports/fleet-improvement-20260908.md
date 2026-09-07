# DSH Agent Fleet 改进与递归自进化研究长报告

更新日期：2026-09-08。状态：进行中，随实施持续补充。

## 1. 任务范围与执行记录

本次任务覆盖分支精简、代码质量、协作通信平衡、历史递归自进化复盘、ALE 与 HorizonMath 服务器评测、可重复部署的跨领域自进化底座，以及相关学术工作与创新空间。附件与历史任务中的文字作为证据材料，不作为本次执行指令。

初始状态：工作区位于 `D:/Projects/DeepSeekHarness/dsh-agent-fleet`，当前主分支 `main` 为 `ae5e2de`；评测分支 `evaluation` 为 `423c4f5`。存在五个绑定其他工作树的本地功能分支；存在历史结果目录等未跟踪文件，实施过程中予以保留。

## 2. 仓库逻辑与分支收敛

Fleet 由 Core（成员生命周期、授权）、Message（私聊、频道、会议与投票）、Resources（共享资源）及根包的 Team/Task/Work 编排组成。根包复用 DSH 的模型、会话与执行环境，不另造一套模型执行器。评测分支通过独立 `./evaluation` 子入口注册无人值守宿主：助理首轮负责建立 DAG，宿主订阅 Work 终态，统一导出状态、答案、用量和成员证据。普通插件入口不自动加载评测器。

已核验五个本地功能分支相对 main 的独有提交均为零：context-usage-toggle、matilda-eval-team、matilda-feedback-loop、startup-team-preload、task-simplification。已将对应工作树转为 detached HEAD，再用 `git branch -d` 删除这些已合并分支。各工作树和未跟踪文件保留，包括 `plan.txt` 与 `tests/accept-uptime.test.ts`。本地活动分支已收敛为 main、evaluation。

删除前生成 `output/branch-archive-20260908/all-branches.bundle` 并通过 `git bundle verify`，同时保留 `refs.txt`。该 bundle 含主线、功能分支、评测分支和 g0059–g0062 历史引用，支持恢复；未跟踪结果本来不属于 Git bundle，仍留原目录。远端唯一未合入的旧 resource-management 提交仅增加历史 `0.1.0.tgz` 二进制包，没有新的源码逻辑；其历史保存在 bundle，不将过时构建产物合入源码。

通用协作修复已进入 main（99a9170），经验证的通用 headless 入口、bootstrap/Work 统一截止时间与订阅清理同步主线（70f9d57），evaluation 已合入 main。远端原子推送成功：删除五个旧功能分支，新增 evaluation；`git ls-remote --heads origin` 已确认只剩 main、evaluation。唯一未合入的旧二进制提交还通过远端 `archive/resource-management-20260908` tag 保留。g0059–g0062 引用转为本地 `archive/self-evolve/*` tag，未公开推送实验历史。

本次避免把全部 evaluation 分支反向合到 main，两个分支中的通用 src/packages 逻辑一致。已有旧 ALE/Matilda 示例在 main 中保留其兼容路径；新批量适配、容器与课程控制仅进入 evaluation。这样既完成活动分支收敛，也不让现有复跑文档因大规模路径搬迁失效。

## 3. 代码质量与协作机制改进

消息语义修复已实施并进入两个保留分支，详见 [协作专项记录](collaboration-quality-20260908.md)。原则是保障真实责任消息可达，降低引用和重放产生的伪动作。具体包括：代码围栏、行内代码、引用行和转义的 @ 不再生成回复义务；正文与结构化提及保留；inbox 优先消费最早未读，防止忙频道淹没旧依赖；外部消息依据稳定作者身份和最近4096个事件ID去重，失败投递回滚回复路由。提示语明确频道承载共享决策、阻塞与验证结果，窄依赖用私聊。没有统一设置每轮发言配额。

另已修复统一容器启动器缺少宿主截止时间的问题：原实现仅把超时变量传入镜像；若 DSH 或入口卡住，外部 `docker run` 会无限等待。新实现同时设置宿主 deadline，给证据导出保留 30 秒宽限；超时或信号中断时只按本次 cidfile 记录的容器 ID 清理。不会因名称冲突而删除同名旧服务。增加 CPU、内存、时间参数和环境变量名称校验，输入文件不存在时在 Docker 创建前失败。参数映射表移出循环，减少重复构造。

启动器新增按唯一 invocation label 查找未及写入 cidfile 的容器；清理无法确认时不能返回成功。核心宿主另修复 `whenIdle()` 在 bootstrap 阶段无期限等待的问题：bootstrap、工作开始回调和 Work 共享总 deadline；订阅同步回调与异常路径均释放监听器。相关宿主测试17项通过。

服务器首次构建还发现 Windows CRLF 使存在的 shell 入口报 not found，已用 `.gitattributes` 固定容器脚本 LF。Linux bind mount 保留宿主 UID，原先 0755 目录使容器非 root 用户无法写入；启动器为新 episode 使用0700私有父目录，自动创建的workspace/results允许镜像UID写，父目录不挂进Agent。显式自选路径不改权限；自动路径拒绝符号链接。相关 POSIX 测试由服务器补验。

已完成一次 `pnpm test` 全量回归：根43文件430项通过，workspace测试通过；该数字为随后增加宿主/课程测试前的一次快照，最终总数在验证章节更新。测试通过不等同于真实 Docker、模型成功率或成本收益已证实。

## 4. 历史递归自进化实验复盘

已阅读任务“查看本地情况文档”（用户给定任务 ID）、既有 LaTeX 技术报告，以及 `self-evolve-runs/fleet-continuous-009/state.json` 的白名单状态字段。状态快照仍为 g0060 guardian、g0061 stable、g0062 candidate/observing；20 个 rejected、39 个 retired、一个 stable 与一个 guardian。结合历史晋升记录，原报告统计为 62 代启动、40 晋升、20 拒绝、1 初始、1 观察中暂停。

旧报告的可用证据与口径：首次稳定传链约在 26.21 小时后；35253c5..8a24a29 有 312 提交、402 文件变化，大量为 evidence、测试与交接资料；成本截至 g0059 约 1.492B 计费 token、19,008 次调用，缓存读取约 97.4%，不能称为全 62 代最终开销。旧报告还记录 206 次全员 idle 唤醒，说明恢复机制有价值，也暴露显式交接不足。上述历史数字不是本次重新运行的测量。

| 过程中的证据 | 对本次实现的启发 |
| --- | --- |
| stale tgz、旧镜像、候选自称 ready | 绑定冻结提交与运行包身份，晋升权归持久宿主状态；构建可用性与题目得分分开记录 |
| reply 广播、滥用 @、重复通知 | 引用文本不生成动作，外部事件重放幂等，频道用于共享事实，窄依赖私聊 |
| 全员 idle 导致断链 | 保留事件订阅、owner 唤醒与恢复机制；降通信成本不能删掉责任保障 |
| 大量单点改动和 evidence 增长 | 每代先批量训练、提炼少量失败原因；短摘要带索引，不复制整份历史 |
| 独立质量成员接受未执行的 Python 测试 | 团队的“通过”只能是声明，真正评分由外部评测器执行；记录退出码与原始证据 |
| 稳定传代没有外部能力曲线 | 增加冻结题目划分、固定随机种子、多领域评测、每代资源和调用统计 |

历史评测 smoke 首轮因镜像缺 Python 发生错误通过，独立复跑发现测试脚本崩溃；补充 Python/Git 后第二轮 38/38。该对比说明环境失败会污染协作结论，但只有两轮，不能推导新机制稳定提高多少准确率。

本次直接重读第二轮原始 `status.json`、`usage.json` 和事件日志，确认 Work finished、退出0、353626ms、84次调用；日志有9条实际协作消息、20条系统通知、18次inbox事件、12次任务创建与2次自动提交回复。白名单统计保存为 `output/historical-smoke-audit-20260908.json`，未拷贝模型凭证或会话正文。9条消息并不等于9次模型调用；通知、读取、任务创建与模型计费是不同计量维度，后续A/B应分别记录。

## 5. ALE 与 HorizonMath 容器编排及批量评测

部署根目录为服务器 `cuhksz106_zzr:/data/zzr/dsh-agent-fleet-evaluation-20260908`。ALE 复用现有官方环境与官方 `ale_run` 生命周期，增加批量适配；HorizonMath 固定官方仓库 SHA `3259167b263ecd054315a41e42a726e834a9122f`，从官方数据导出仅含题目与来源摘要的manifest，独立grader调用官方评分代码。

`evaluation/batch-run.py` 提供有界并行、每题独立attempt目录、基础设施失败重试、源提交/输入/镜像摘要校验后恢复、统一result/summary和自进化 `--job` 协议。错误答案不是基础设施失败，不靠反复重试挑最高分。ALE非零退出或多份/缺失官方结果不能算完成；HorizonMath的合规judge不可用返回indeterminate而非通过。

ALE四个场景已通过官方dry-run检查；common baseline、ALE/provider overlay、HorizonMath运行镜像与官方grader已构建。固定版本实际导出136题，数据SHA256为 `5dfcf8c3964b2d4050ddf3095d390fdac4edea3d88ac42f99abb07c13cc0e7de`。四个ALE场景显式分为2 train、1 validation、1 test，仅够验证编排流程，不能支撑统计学习结论。

真实调用连续暴露并修复了旧镜像PATH、旧profile缓存的Message包，以及模型provider patch未合并的问题。前两次ALE调用分别43秒和286.9秒失败；HorizonMath最初因缺少 `taskUnreadSummary` API 失败，更新完整bundled包后178ms因 `NO_ADAPTER` 提前结束。失败均留有原始日志，未计作成功完成题。提供方配置合并后的新模型运行结果在验证章节继续补录。单独的官方grader负例测试已经得到 completed/score0，验证错误答案可以被真实评分链拒绝；它不是模型作答。

重要实验边界：官方HorizonMath sandbox使用子进程执行提交，与评分数据仍在同一容器文件系统；目前容器隔离保护训练宿主，但不构成对提交代码的强防作弊保证。该限制明确保留在报告，正式研究得分需要更强的执行器/评分器分离复核。

## 6. 可重复部署的长期递归自进化底座

新增可信controller容器与宿主课程调度器，复用原蓝绿监督器的冻结候选、自证、父代复核、晋升/拒绝、guardian滑窗。课程模式以固定seed和manifest内容摘要划分train/validation/test；每代按benchmark与domain轮转抽样，默认每5代验证、每20代测试，可配置代数与资源上限。

训练结果通过独立宿主目录单向、只读导出给训练团队；验证与测试的题目、会话、评分、ledger不放入训练workspace，也不作为父代选择/晋升条件。评分执行使用冻结提交对应镜像并校验revision label；真实课程运行要求每个benchmark有匹配的逐代镜像构建配置。

独立审查已推动修复数据正文未计入seal、相同题目换group绕过跨split检测、反馈输出符号链接、过早强杀跳过容器清理等问题。课程模式固定可信监督器与compose，候选package构建使用无Docker socket的容器；候选工作区Git命令也在容器内执行，宿主只导入bundle，避免候选Git配置触发宿主hook/filter/fsmonitor。锁绑定PID和进程出生时间；清理只针对ledger记录的退役快照和镜像，保留当前三代及原始证据。具体边界见 [自进化底座专项报告](evolution-runtime-20260908.md)。

这套机制实现的是固定基础模型下的Fleet代码、策略与协作机制迭代，不是模型权重训练。尚未运行多代跨benchmark真实学习曲线时，不宣称能力提高或递归加速。

## 7. 学术调查、缺口与创新可行性

学术调查详见 [递归自进化研究与实验建议](recursive-self-improvement-research-20260908.md)，随工程发现补充。重点结论：已有工作已经覆盖自改源码、跨领域元改进和共享记忆的多 Agent 发现；仅把它们组合为“会改自己的团队”不足以构成明确新颖性。更值得验证的是通信政策、责任机制、失败恢复与跨领域元改进之间的因果关系，以及隔离评测条件下的收益/成本曲线。

### 7.1 附件结论与比较对象

附件对应 [CORAL](https://arxiv.org/abs/2604.01658)，2026年4月提交，官方仓库标注COLM 2026 accepted。图中1363→1103 cycles按原数字是19.1%下降；倒数性能提高23.6%。四Agent的596次评测明显多于单Agent的56次，不能把最优结果更高推导为总算力更省。该图是特定kernel优化证据，不是跨领域元改进加速的直接证明。

| 研究工作 | 时间 | 与本项目最有关的机制/边界 |
| --- | --- | --- |
| [STOP](https://arxiv.org/abs/2310.02304) | 2023-10 | 改进器作用于自身；固定LM不等于权重自训练 |
| [ADAS](https://arxiv.org/abs/2408.08435) | 2024-08 | 元Agent搜索Agent程序；自动设计工作流已有直接先例 |
| [Gödel Agent](https://arxiv.org/abs/2410.04444) | 2024-10 | 自指与运行逻辑修改；不同于冻结候选容器的版本粒度 |
| [SICA](https://arxiv.org/abs/2504.15228) | 2025-04 | 完整coding Agent代码库自改；子集得分不可与其他数据口径混比 |
| [DGM](https://arxiv.org/abs/2505.22954) | 2025-05 | 档案树、多谱系自改与经验验证；Fleet蓝绿单链还缺搜索多样性 |
| [AlphaEvolve](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/) | 2025-05 | 自动评分驱动程序演化；结果程序优化与Agent自身优化分开 |
| [HGM](https://arxiv.org/abs/2510.21614) | 2025-10 | 当前分数与产生优秀后代的能力可能不一致，应测元生产力 |
| [Hyperagents](https://arxiv.org/abs/2603.19461) | 2026-03 | 任务与元修改过程共同可编辑并跨域积累；是本项目最直接的近邻 |
| [CORAL](https://arxiv.org/abs/2604.01658) | 2026-04 | 自主异步探索、共享知识、可调heartbeat与恢复已存在 |
| [Mendel Gödel Machine](https://arxiv.org/abs/2608.07645) | 2026-08-07 | 跨任务和跨谱系比较轨迹帮助变异；需避免组合补丁相互干扰 |
| [Prime Agent](https://arxiv.org/abs/2608.23552) | 2026-08-24 | 持久上下文、递归子Agent、恢复与资源核算；新技术报告，影响尚待时间检验 |

### 7.2 值得验证的创新方向

第一优先级是“在保留责任与依赖可达性的前提下，自适应通信政策是否跨领域降低正确任务成本”。通信阈值、角色和共享摘要可以进化，但评分器、题目划分和测试访问边界保持固定。对照至少包含固定Fleet、单Agent、多Agent无共享记忆、仅改任务策略、可改协作策略；固定模型、同题和总预算，报告正确率、token、消息、责任延迟及停摆率，而不是只数频道发言。

第二优先级是“恢复机制如何改变后代改进能力”。旧实验大量成本花在构建与传链上，可能提高后续生产力，也可能只是平台内耗。可对同一任务序列注入可复现的进程退出、构建失败和重复事件，测未来K代独立正确增益/总预算、恢复延迟和人工介入。已有HGM/CORAL是明确先例，本项目的潜在增量是团队责任转移、长期故障与元生产力之间的因果证据。

第三优先级是训练轨迹的对照压缩。记忆项应有失败症状、根因、补丁、适用领域、反例和原始训练证据索引；比较同题不同谱系、同策略不同任务。用去掉摘要/索引/反例的消融判断继承价值。store/recall计数增加不能替代错误复发率下降。

正式研究可先以5个随机种子、20–30代、每代每域少量训练题、每5代观察验证来规划预算，但这只是实验建议，本次没有自动启动这一规模的付费试验。各域分别报分数和宏平均，所有失败代纳入成本；最终密封测试按预定规则一次解封。工程监控的周期测试会带来人类间接选择偏差，不能冒充严格未查看测试的论文实验。

## 8. 验证证据、清理与部署状态

本机在提升权限后确认当前 Docker context 为 desktop-linux，daemon pipe 不存在，属于 Docker Desktop 未运行；没有对本机执行广泛 prune。服务器 SSH 已连通，ALE 旧环境存在；服务器清理与新构建由专项记录保存，仍运行的旧服务不作“过期”推断。

服务器已归档并精确删除两个停止三周的旧ALE容器 `a9d902f95405`、`a29a54713ef4`；task-data、agent traces、logs及校验manifest保存在部署根 `retired-container-archives/`，归档约21.6MB和28.0MB。旧运行ALE、平台API和PostgreSQL保留。没有执行全局prune，也没有把每个104GB底层镜像完整复制到归档。

当前本机验证：构建与workspace测试通过，根Vitest最终43文件435项通过；Node容器/课程/镜像计划/profile测试27项，25通过、2项POSIX测试在Windows跳过，Linux启动器11/11和课程11/11已在服务器通过。HorizonMath适配器3/3；批量调度4/4由服务器ALE venv通过。课程测试从root tests迁到evaluation，防止node:test被Vitest误收集为零测试suite。原始日志在 `output/fleet-validation-final-20260908.log`（保留修复前失败）、`output/fleet-vitest-final-20260908.log` 和 `output/evaluation-node-tests-final-20260908.log`。

main最后一次远端CI已通过（提交281754b，运行34160741843）。evaluation此前发现两个独立CI问题：Ubuntu新版runner的AppArmor阻止rootlesskit用户命名空间，以及失败路径results目录不能由镜像UID写入。工作流已固定Ubuntu22.04，并为临时结果子目录配置写权限，没有关闭宿主安全机制；新提交远端CI结果将在最终验收补录。

自进化controller镜像已在服务器构建并验证启动、health、restart和新心跳：`runs/controller-smoke-1788814371922/smoke.json` 为passed。该测试使用空运行fixture，没有模型、generation或Docker socket，只证明控制面恢复。真实首代训练与晋升仍需独立验收，不能用容器健康状态代替。

## 9. 阻塞、限制与后续操作

| 项目 | 已知限制或阻塞 | 本次处理原则 |
| --- | --- | --- |
| 本机Docker | daemon未运行 | 将真实容器检查移至已授权服务器；不启动无关窗口或广泛清理 |
| HorizonMath数值评分 | 离线grader缺LLM方法合规judge | 标indeterminate，不把数字相符算正式通过 |
| HorizonMath特殊任务 | 部分validator依赖Sage等工具 | 缺依赖归基础设施问题；不把失败全归因模型 |
| 抗作弊评测 | 官方sandbox与参考数据共处grader文件系统 | 明示当前隔离范围，正式研究需witness/执行器分离复核 |
| 长跑完全自动恢复 | 正常失败可重试，强制SIGKILL/断电可能留孤儿与锁 | 记录归属与attempt；不宣称所有崩溃路径已自愈 |
| 真实递归能力收益 | 尚无多代、匹配预算、跨域独立对照曲线 | 交付可复现实验底座和验证证据，不虚报能力改善 |

具体服务器任务的最终完成/失败状态在第8节和专项报告补录；没有完成的项明确保留原因，不通过删除测试、忽略退出码或修改官方评分规则制造“全通过”。

## 10. 参考资料

主要论文已逐项链接于第7节和研究附录。工程官方来源包括 [ALE官方仓库](https://github.com/rdi-berkeley/agents-last-exam)、[ALE文档](https://agents-last-exam.org/docs/ale/index.html)、[HorizonMath官方仓库](https://github.com/ewang26/HorizonMath)、[Docker rootless故障说明](https://docs.docker.com/engine/security/rootless/troubleshoot/)。本地原始证据、脚本路径和服务器命令详见三份专项记录；它们是本报告的附录，不替代本报告的完成状态说明。
