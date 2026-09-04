# Fleet 自我迭代蓝绿团队

这个示例从内置“中型软件工程团队”派生一个持续改进团队。每一代 DSH/Fleet 运行在独立 Docker Compose 项目、数据卷和完整 Git clone 中；宿主监督器是唯一拥有 Docker 生命周期权限的进程。

它解决的不是“让 Agent 自由重写并重启自己”，而是保证下面这条链始终成立：

```text
稳定代工作并提交代码
  -> 宿主启动隔离候选代，稳定代继续在线
  -> 候选代在自己的容器内启动并独立自检
  -> 候选代声明 ready/reject
  -> 稳定代复核 ready 证据并 promote/destroy
  -> promote 事件先交给新稳定代，宿主再停止旧代
```

没有半小时探针或五分钟轮询。监督器通过文件系统事件接收请求，通过 `docker wait` 接收容器退出；团队成员使用阻塞式 `generation-control watch` 等事件。Docker Compose 的启动健康检查只负责判断新进程能否提供服务，不参与代际决策。

## 边界

- Agent 容器不挂载 Docker socket，也不能直接启动、停止或删除任何容器。
- 每代使用新的完整 Git clone 和 DSH 数据卷；不会复制正在写入的 Session 数据。容器内可以正常执行 `git status`、`git commit` 和 `git log`。
- 宿主状态目录维护独立裸仓库。启动下一代时，宿主从稳定代工作区解析请求中的 commit，把它固化为 `generations/gNNNN` 分支，再从该分支创建候选。上一代工作区被回收后，提交历史仍然存在。
- 容器只读挂载代际裸仓库，不获得宿主 Git 凭据，也不挂载主仓库的 `.git`。本代可以 commit，但不能直接修改 `main` 或其他代的分支；跨代导入只由宿主监督器完成。
- 下一代从该代 Git commit 中构建被测 Fleet 包，因此运行时代码与其中的系统提示词修改都会进入候选。
- 当前监督器目录中的 Compose、Dockerfile、代际客户端和团队安全模板是本轮根信任，不从候选 clone 加载。团队可以提出这些控制文件的修改，但必须由宿主在下一轮明确采用；否则一个不可靠候选只需修改挂载、权限或晋升脚本就能绕过蓝绿保护。
- 同时只有一个候选。候选只能为自己提交 `ready` 或 `reject`；只有稳定代能 `start-candidate`、`destroy-candidate` 或 `promote`。
- 晋升必须同时满足候选自证和稳定代批准。先写 `generation.promoted` 事件，再停止旧代，把其成员独立上下文和 Fleet 事件导出到 `archive/dsh-context.tar.gz`，最后删除容器、网络与数据卷；拒绝、异常退出和整轮停止走同一归档清理路径。已退休代默认只保留最近两代的工作区供诊断，更旧的由监督器按明确代路径回收；Git 历史、上下文归档和事件不随工作区回收而丢失。
- 控制请求使用每代独立的 HMAC 身份。密钥只通过本代容器环境传入；包含密钥的监督器状态文件不挂载到容器。

## 文件

- `team.local.json`：基于中型开发团队的中文派生模板。角色数量与职责面保持不变，只增加代际责任和自我改进边界。
- `bootstrap.md`：第一代的持续任务。后续代由上一代提供更具体的候选 bootstrap。
- `Dockerfile`、`compose.yaml`、`compose.source.yaml`：每代隔离运行环境；默认 4 CPU、8 GiB，并在运行时只允许访问模型端点。
- `scripts/supervisor.mjs`：宿主唯一生命周期控制器。
- `scripts/generation-control.mjs`：容器内请求/事件客户端。
- `scripts/protocol.mjs`：请求认证与双确认授权规则。

## 启动第一代

监督器要求源提交可由 Git 解析。先把希望成为第一代基线的改动提交到当前仓库，再在仓库外创建状态目录：

```powershell
$env:DEEPSEEK_FLASH_API_KEY = '<runtime-key>'
node examples/self-evolving-team/scripts/supervisor.mjs init `
  --state D:/Projects/DeepSeekHarness/self-evolve-runs/fleet-001 `
  --source D:/Projects/DeepSeekHarness/dsh-agent-fleet `
  --ref main `
  --bootstrap D:/Projects/DeepSeekHarness/dsh-agent-fleet/examples/self-evolving-team/bootstrap.md `
  --port 3120 `
  --cpus 4 `
  --memory 8g `
  --retain-generations 2
```

`init` 完成五件事：复制一份宿主管理的代际裸仓库、创建 `g0001` 隔离 clone、按冻结 lockfile 安装并构建/打包 Fleet、启动隔离 Compose 项目、保持前台监督请求目录。宿主构建阶段可访问依赖源；候选容器运行时仍只允许模型端点。候选 UI 地址从 `3120` 起按代递增。容器内 Fleet 自动创建团队，并向助理注入“按 `.self-evolve/bootstrap.md` 开始任务”的一次性指令，不需要用户打开 UI 导入配置。

如果宿主进程退出，只恢复监督器，不创建新一代：

```powershell
node examples/self-evolving-team/scripts/supervisor.mjs serve `
  --state D:/Projects/DeepSeekHarness/self-evolve-runs/fleet-001
```

读取权威状态：

```powershell
node examples/self-evolving-team/scripts/supervisor.mjs status `
  --state D:/Projects/DeepSeekHarness/self-evolve-runs/fleet-001
```

停止整个循环并删除仍存活代的容器、网络和数据卷：

```powershell
node examples/self-evolving-team/scripts/supervisor.mjs stop `
  --state D:/Projects/DeepSeekHarness/self-evolve-runs/fleet-001
```

`stop` 是宿主操作，容器内成员不能调用。它保留代际裸仓库、隔离工作区、控制事件和交接文件供复盘；若不再需要，可在确认提交与工件已保存后由宿主单独删除状态目录。

## 团队使用的控制命令

这些命令由模板指定的平台工程师在容器内执行。`start-candidate` 的 `--ref` 必须是已经提交的 commit；文件参数的内容会被放入签名请求，避免把容器路径误当成宿主路径。

```sh
# 任一代：查看宿主写入的本代身份、父代、源提交和代际分支
node /opt/self-evolve/scripts/generation-control.mjs info

# 稳定代：启动一个候选
node /opt/self-evolve/scripts/generation-control.mjs start-candidate \
  --ref "$(git rev-parse HEAD)" \
  --bootstrap /workspace/evidence/next-bootstrap.md

# 稳定代：阻塞等待下一条宿主事件
node /opt/self-evolve/scripts/generation-control.mjs watch --after 3

# 候选代：自检通过或失败
node /opt/self-evolve/scripts/generation-control.mjs ready \
  --summary "启动、构建和目标回归通过" \
  --evidence /workspace/evidence/candidate-readiness.md
node /opt/self-evolve/scripts/generation-control.mjs reject \
  --reason "目标回归仍可复现"

# 稳定代：复核后晋升或淘汰
node /opt/self-evolve/scripts/generation-control.mjs promote \
  --summary "候选自证与独立复核均通过" \
  --handoff /workspace/evidence/handoff.md
node /opt/self-evolve/scripts/generation-control.mjs destroy-candidate \
  --reason "独立复核未通过"
```

命令返回 `accepted: true` 只表示请求文件已原子写入；最终结果由随后到达的事件决定。被拒绝请求会产生一次 `request.rejected`，然后移入宿主 `control/rejected`，不会因目录事件被反复处理成回复风暴。

## 失败与恢复

- 候选构建或启动失败：稳定代收到 `candidate.failed`，仍保持在线，可淘汰候选、修复并重试。
- 候选主动拒绝：宿主停止候选并把 `candidate.self_rejected` 交给稳定代。
- 候选意外退出：`docker wait` 产生 `generation.peer_exited`；稳定代继续持有控制权。
- 稳定代意外退出：候选不会被静默晋升。监督器保留候选和完整状态并发出退出事件，等待宿主判断；这比在缺少上一代批准时自动接管更安全。
- 监督器退出：容器不受影响；重新运行 `serve` 会扫描尚未归档的请求并重新挂接运行中容器的退出事件。

状态、完成请求、拒绝请求和逐代事件都保存在宿主状态目录。每代停止时会先归档除可重装依赖外的 DSH 数据，其中包含团队事件、各成员 Session 上下文和工作区索引；归档成功后才删除容器、网络和数据卷，因此 Docker 资源不随代数累积。监督器只保留 `--retain-generations` 指定数量的最近退休/失败工作区（默认 2），随后按它自己创建并验证过的精确路径回收。代际裸仓库中的 Git commit、上下文归档、控制事件以及交接摘要继续保留。
