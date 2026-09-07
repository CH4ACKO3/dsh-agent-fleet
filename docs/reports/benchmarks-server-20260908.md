# ALE / HorizonMath 服务器编排报告（2026-09-08）

状态：进行中。本文从调查开始持续记录；未验证事项不作为已完成结果。

## 目标

在 `cuhksz106_zzr` 部署可重复运行、可恢复、有资源约束及结果留存的 ALE 和 HorizonMath 批量评测，复用 evaluation 分支的 Fleet headless launcher；保留官方评分过程，区分基础设施冒烟验证与模型基准成绩。

## 官方来源

- ALE：[官方仓库](https://github.com/rdi-berkeley/agents-last-exam)、[框架文档](https://agents-last-exam.org/docs/ale/index.html)、[论文](https://arxiv.org/abs/2606.05405)。不是 Humanity’s Last Exam，也不是 ALE Robotics。
- HorizonMath：[官方仓库](https://github.com/ewang26/HorizonMath)、[论文](https://arxiv.org/abs/2603.15617)。当前仓库 README 与论文网站的问题数量有版本差异，运行必须固定 Git SHA 并记录数据文件摘要。

## 环境调查

- 整理分支时通过 `git show evaluation:...` 查阅已有 ALE adapter、Dockerfile、四个 cuhksz 场景脚本；随后在根代理切换 evaluation 后继续修改。首次文件搜索不等价于完整主线目录盘点。
- 初始沙箱账户无法读取用户 SSH 配置；按用户已授权服务器操作，通过工具审批后读取 host 配置成功，未读取或输出私钥。
- 服务器已有 ALE checkout：`/data/zzr/frontal-team/ale/repo`，官方仓库源 `rdi-berkeley/agents-last-exam`，SHA `1e615e456de7cef57706680613cb80ee13c7fc76`。
- 新部署根：`/data/zzr/dsh-agent-fleet-evaluation-20260908`。源码快照在 `source/`，manifest 在 `manifests/`，逐题结果在 `runs/`。
- 用户 zzr 属于 docker 组。`/` 初始剩余172GB，`/data` 剩余52TB。既有平台API与PostgreSQL服务保持运行；旧ALE运行容器 `788910deefb1` 保留。
- 已有provider凭证仅在服务器内从旧ALE运行环境读取并保存到新根 `secrets/provider.env`（目录0700、文件0600），没有把密钥传回本机，也没有上传本机私有provider包。

## 实现与验证

### 已实现

1. `evaluation/batch-run.py`：HorizonMath与ALE native双适配，指定并发、CPU、内存、agent截止时间；每次尝试独立目录；仅重试基础设施失败，不重复抽奖错误答案；`--resume`比对源码身份、manifest、实际task/team/config SHA256及镜像ID；`--job`支持递归课程协议。
2. 独立HorizonMath exporter：固定官方SHA `3259167b263ecd054315a41e42a726e834a9122f`，导出官方system/user prompts，manifest不包含numeric_value与source_note等参考字段，记录数据与prompt摘要。
3. 官方HorizonMath grader镜像：使用上游 `uv.lock` 安装98个依赖，不改评分实现；调用 `evaluate_responses.evaluate_response`，保留原始结果于host侧。只数字吻合但合规judge不可用时记录 `indeterminate` / `score:null`，匹配best-known baseline不算超越。
4. grading容器默认断网、只读文件系统、cap-drop ALL、pids 128、CPU2、内存4GiB、tmpfs 1GiB，仅挂载最终solution；通过本次cidfile识别和清理，无法通过固定容器名误删其他容器。
5. 课程job含generation时，必须给image，且其OCI revision与sourceCommit完全相同；否则拒绝，避免每代都评测旧baseline。宿主使用可信控制器launcher，候选源码只影响镜像/Team配置。
6. native ALE沿用官方task staging、agent deployer、官方evaluate、trajectory；由host生成每次episode配置，concurrency=1、max_attempts=1、cleanup_mode=delete。新的server overlay复用服务器已有ALE/provider镜像，并从common baseline复制新Fleet包。
7. 汇总同时给statusCounts、完成题均分与全题分母的lowerBoundScoreAllTasks，避免只呈现成功完成题造成幸存者偏差。

### 已执行验证

- 本机HorizonMath适配器3项unittest通过：官方题导出不带参考字段、numeric缺judge不误判通过、仅持平baseline不计通过。
- 服务器11项 `node --test evaluation/run-container.test.mjs` 全通过，含Linux挂载权限与符号链接防护、宿主deadline、同名容器保护、cidfile缺失时invocation label清理。
- ALE四项真实官方场景配置dry-run全通过，输出 `runs/ale-dry-run-authorized/summary.json`；此为配置检查，不是模型成绩。
- common baseline `dsh-fleet-evaluation:baseline-20260908` 已构建，OCI revision明确标为 `working-snapshot-20260908`，不冒充已提交代码版本。
- ALE overlay `ale-ubuntu22-dsh-fleet:20260908` 已构建。第一次真实cost-optimization episode在43秒内因native sandbox PATH找不到dsh失败，官方score=0.0；已定位并添加 `/usr/local/bin/dsh` 链接，正在重建和重试。该次容器由官方cleanup删除，日志保留。
- HorizonMath grader `dsh-horizonmath-grader:3259167b263e` 已构建，最终Docker显示4.56GB；导出image layers花费约444秒，上游torch/CUDA依赖为主要开销。
- 实际固定SHA导出结果为 **136题**，数据SHA256为 `5dfcf8c3964b2d4050ddf3095d390fdac4edea3d88ac42f99abb07c13cc0e7de`。这一事实优先于README旧版本113题的描述。
- 服务器新增批量控制4项回归全部通过：ALE exit3/124即使存在满分文件也不采纳；错误答案不重试；resume题面改变拒绝；截止/取消对子进程生效。本机同测试3过1跳过（未装PyYAML），服务器官方ALE venv补足覆盖。
- native ALE修PATH后第二次真实episode运行286.9秒，以agent failed结束，官方score0.0；官方清理删除新episode容器。此结果没有伪装为成功完成题。
- HorizonMath真实校准题 `mzv_reduction_zeta_3_3_3` 第一次因provider镜像旧profile缓存的message模块缺少`taskUnreadSummary`失败。逐层验证证明common baseline包含新方法，旧provider overlay不含；通过替换完整Fleet及其bundled依赖修复，保留服务器既有provider。
- 修复后HorizonMath再运行4秒退出`bootstrap_incomplete`，内部evaluation仅178ms、Team仍idle。结果保留 `runs/horizonmath-mzv-live-fresh-package/`，属于运行底座未启动任务的失败，尚未取得有效模型基准成绩，正在向根代理回传代码线索。
- 随后读事件追踪定位`bootstrap_incomplete`的具体原因是 `NO_ADAPTER: no adapter registered for provider memorax`，不是模型解题失败或whenIdle竞态。服务器既有provider注册patch与新的evaluation patch此前分开生效；现overlay合并二者，ALE每次生成agent config显式选择combined patch。两镜像重建后，新的HorizonMath与ALE五分钟真实测试正在运行，目录分别为 `runs/horizonmath-mzv-provider-fixed/`、`runs/ale-cost-provider-fixed/`。
- 官方HorizonMath grader负例冒烟验证通过：向真实 `w4_watson_integral` 输入明确错误的`return 0`，获得`completed`、score0、comparison错误。该检查验证评分管道会拒绝错误候选，不是模型成绩。
- 已实际清理两个明确停止3周的旧Fleet ALE容器：`a9d902f95405`、`a29a54713ef4`。先将官方task-data、agent traces、docker logs及SHA256 manifest保存在 `retired-container-archives/<full-container-id>/`；归档分别约21.6MB与28.0MB，之后仅删除这两个容器。没有删除底层镜像、旧运行ALE或平台服务。

### 实际发现与修复

- Windows CRLF使Linux脚本文件存在却报 `not found`。已规范LF并与根代理协作固化`.gitattributes`。
- Linux host UID1002生成0755挂载目录，容器UID10001或1000无法写。已采用0700私有episode父目录包住可写的workspace/results子目录，并在服务器测试验证。
- 原始ALE模板仍引用服务器旧provider patch；新运行需明确对齐新overlay及headless patch。实际episode已暴露并修复PATH问题，后续结果继续记录。
- 独立审查修复了固定grader名字误删风险、CLI失败却采纳score风险、resume缺少文件/镜像内容绑定、进化源码替换宿主launcher、以及SIGTERM传递中逃逸子进程问题。

## 部署记录与阻塞项

1. HorizonMath官方所谓sandbox实质为同一容器内subprocess与超时，不是强文件权限隔离。当前解题容器与grader隔离能防止训练Agent直接看到参考数据，但grader执行的恶意solution仍可能读取同容器参考文件。正式抗作弊结论前，需要另做只含数学生成环境的执行容器，将witness传给可信评分进程；当前不把container边界宣传为已解决全部防作弊。
2. 默认grader断网，numeric题必须通过的LLM方法合规审查无联网judge时标为未定。真正正式numeric成绩需单独安排可信审查服务并保留judge版本，不得向解题容器放judge密钥。
3. 某些官方validator要求SageMath；当前第一轮grader基于Python上游锁文件，还未装Sage，相关任务必须标缺依赖而非模型错误。后续需Sage扩展镜像。
4. 进程正常失败与信号可清理恢复；机器断电或SIGKILL残留`.running`锁仍需人工核实或使用新attempt目录，不能称完全自动崩溃恢复。
5. 其余旧容器基本为3周前停止的Fleet ALE实验，底层镜像显示104GB。本次清理以两只明确旧容器验证了归档流程；其余未批量删除。脚本另支持`--full-filesystem`，需要保留完整可变操作系统时可用，但可能每只复制百GB。
6. 离线numeric合规未定会让课程无法获得finite score并阻止晋升；无judge课程应先选construction/benchmark题，不能将未定当0或1蒙混过关。该限制已通知长跑编排代理。
