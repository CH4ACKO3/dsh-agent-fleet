from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import time
from pathlib import Path
from typing import Any, ClassVar

from ale_run.base_interface import AgentRunResult, BaseAgentDeployer, TrajectoryBuilder

from .config import DshFleetConfig


_REPORT = "dsh-fleet-report.json"
_STDOUT = "dsh-fleet-stdout.log"
_STDERR = "dsh-fleet-stderr.log"
_BRIDGE = "dsh-fleet-bridge.log"
_TASK = "dsh-fleet-task.md"
_EVALUATION = "dsh-fleet-evaluation"
_TERM_GRACE_S = 15


class DshFleetDeployer(BaseAgentDeployer):
    """Run one ALE episode through a persistent native DSH Fleet Team."""

    default_executor: ClassVar[str] = "sandbox"
    supported_executors: ClassVar[frozenset[str]] = frozenset({"sandbox"})
    hot_artifacts: ClassVar[tuple[str, ...]] = (_REPORT, _STDOUT, _STDERR, _BRIDGE, _TASK, _EVALUATION)

    @property
    def version(self) -> str | None:
        return "dsh-0.1.1-rc.2+fleet-0.2.0"

    async def install(self) -> None:
        if not self.executor.sandbox.is_linux:
            raise RuntimeError("DshFleetDeployer supports Linux sandboxes only")
        if shutil.which("dsh") is None:
            raise RuntimeError("dsh is missing; use the ALE DSH Fleet image")
        cfg: DshFleetConfig = self.config  # type: ignore[assignment]
        if not Path(cfg.team_config).is_file():
            raise RuntimeError(f"Fleet Team configuration is missing: {cfg.team_config}")
        if cfg.patch_path and not Path(cfg.patch_path).is_file():
            raise RuntimeError(f"DSH patch is missing: {cfg.patch_path}")
        if cfg.bridge_command and shutil.which(cfg.bridge_command) is None:
            raise RuntimeError(f"model bridge is missing: {cfg.bridge_command}")
        if cfg.timeout_ms <= 0:
            raise RuntimeError("Fleet evaluation timeout_ms must be positive")
        Path(self.executor.work_dir).mkdir(parents=True, exist_ok=True)

    async def launch(self, prompt: str) -> AgentRunResult:
        cfg: DshFleetConfig = self.config  # type: ignore[assignment]
        work_dir = Path(self.executor.work_dir)
        work_dir.mkdir(parents=True, exist_ok=True)
        stdout_path = work_dir / _STDOUT
        stderr_path = work_dir / _STDERR
        bridge_path = work_dir / _BRIDGE
        task_path = work_dir / _TASK
        task_path.write_text(prompt.strip() + "\n", encoding="utf-8")
        workspace = Path(self.executor.sandbox.task_data_root)
        t0 = time.monotonic()

        env = os.environ.copy()
        env.update(self.executor.env or {})
        api_key = cfg.api_key or env.get(cfg.provider_env_key)
        if not api_key:
            return self._result(
                status="failed",
                t0=t0,
                stdout_path=stdout_path,
                stderr_path=stderr_path,
                error=f"provider credential is absent: {cfg.provider_env_key}",
            )
        env[cfg.provider_env_key] = api_key
        env.update(
            {
                "DSH_HOME": cfg.dsh_home,
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_MODE": "DISABLED",
            }
        )

        evaluation_dir = work_dir / _EVALUATION
        env.update(
            {
                "FLEET_EVAL_WORKSPACE": str(workspace),
                "FLEET_EVAL_TEAM_CONFIG": cfg.team_config,
                "FLEET_EVAL_TASK_FILE": str(task_path),
                "FLEET_EVAL_OUTPUT": str(evaluation_dir),
                "FLEET_EVAL_TIMEOUT_MS": str(cfg.timeout_ms),
                "FLEET_EVAL_PROVIDER": cfg.provider,
                "FLEET_EVAL_MODEL": cfg.model,
                "FLEET_EVAL_MAX_TOKENS": str(cfg.max_tokens),
            }
        )
        bridge: asyncio.subprocess.Process | None = None
        with (
            stdout_path.open("wb") as stdout,
            stderr_path.open("wb") as stderr,
            bridge_path.open("wb") as bridge_log,
        ):
            if cfg.bridge_command:
                bridge = await asyncio.create_subprocess_exec(
                    cfg.bridge_command,
                    cwd=workspace,
                    env=env,
                    stdout=bridge_log,
                    stderr=bridge_log,
                    start_new_session=True,
                )
                await self._wait_for_bridge(bridge, cfg.bridge_port)
            command = ["dsh", "--profile", "headless"]
            if cfg.patch_path:
                command.extend(["--patch", cfg.patch_path])
            command.append("Complete the task in the configured task file.")
            process = await asyncio.create_subprocess_exec(
                *command,
                cwd=workspace,
                env=env,
                stdout=stdout,
                stderr=stderr,
                start_new_session=True,
            )
            try:
                exit_code = await process.wait()
            except asyncio.CancelledError:
                await self._stop_process(process)
                self._write_report(
                    work_dir,
                    cfg,
                    workspace,
                    status="timeout",
                    exit_code=124,
                    duration_s=time.monotonic() - t0,
                    evaluation_dir=evaluation_dir,
                )
                self._capture_durable_trace(work_dir, cfg, workspace)
                raise
            finally:
                if bridge is not None:
                    await self._stop_process(bridge)

        status = "completed" if exit_code == 0 else "failed"
        error = None if exit_code == 0 else f"dsh headless exited with code {exit_code}"
        self._write_report(
            work_dir,
            cfg,
            workspace,
            status=status,
            exit_code=exit_code,
            duration_s=time.monotonic() - t0,
            evaluation_dir=evaluation_dir,
        )
        self._capture_durable_trace(work_dir, cfg, workspace)
        return self._result(
            status=status,
            t0=t0,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
            exit_code=exit_code,
            error=error,
        )

    @classmethod
    def parse_artifacts(
        cls,
        *,
        work_dir: Path,
        config: DshFleetConfig,
        run_result: AgentRunResult,
        builder: TrajectoryBuilder,
    ) -> None:
        report: dict[str, Any] = {}
        report_path = work_dir / _REPORT
        if report_path.exists():
            try:
                report = json.loads(report_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                report = {}
        stdout_path = work_dir / _STDOUT
        stdout = stdout_path.read_text(encoding="utf-8", errors="replace") if stdout_path.exists() else ""
        builder.add_step(
            source="system",
            message=(stdout[-12_000:] or f"DSH Fleet run ended with status {run_result.status}"),
            extra={"report": report, "exit_code": run_result.exit_code},
        )
        builder.trajectory.extra["dsh_fleet"] = {
            "model": config.model,
            "provider": config.provider,
            "run_status": run_result.status,
            "report_path": str(report_path),
            "session_trace_path": str(work_dir / "dsh-sessions"),
            "fleet_trace_path": str(work_dir / "fleet-state"),
            "evaluation_output_path": str(work_dir / _EVALUATION),
        }

    @staticmethod
    async def _stop_process(process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(process.wait(), timeout=_TERM_GRACE_S)
        except TimeoutError:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()

    @staticmethod
    async def _wait_for_bridge(process: asyncio.subprocess.Process, port: int) -> None:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if process.returncode is not None:
                raise RuntimeError(f"model bridge exited during startup with code {process.returncode}")
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
            except OSError:
                await asyncio.sleep(0.2)
                continue
            writer.close()
            await writer.wait_closed()
            del reader
            return
        await DshFleetDeployer._stop_process(process)
        raise RuntimeError(f"model bridge did not listen on 127.0.0.1:{port}")

    @staticmethod
    def _capture_durable_trace(work_dir: Path, cfg: DshFleetConfig, workspace: Path) -> None:
        sources = (
            (Path(cfg.dsh_home) / "sessions", work_dir / "dsh-sessions"),
            (workspace / ".fleet", work_dir / "fleet-state"),
        )
        for source, destination in sources:
            if source.is_dir():
                shutil.copytree(source, destination, dirs_exist_ok=True)

    @staticmethod
    def _write_report(
        work_dir: Path,
        cfg: DshFleetConfig,
        workspace: Path,
        *,
        status: str,
        exit_code: int,
        duration_s: float,
        evaluation_dir: Path,
    ) -> None:
        evaluation_status: dict[str, Any] = {}
        status_path = evaluation_dir / "status.json"
        if status_path.is_file():
            try:
                evaluation_status = json.loads(status_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                evaluation_status = {}
        (work_dir / _REPORT).write_text(
            json.dumps(
                {
                    "status": status,
                    "exit_code": exit_code,
                    "duration_s": duration_s,
                    "model": cfg.model,
                    "provider": cfg.provider,
                    "workspace": str(workspace),
                    "evaluation_output": str(evaluation_dir),
                    "evaluation": evaluation_status,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    @staticmethod
    def _result(
        *,
        status: str,
        t0: float,
        stdout_path: Path,
        stderr_path: Path,
        exit_code: int | None = None,
        error: str | None = None,
    ) -> AgentRunResult:
        return AgentRunResult(
            status=status,
            transcript_path=str(stdout_path),
            stderr_path=str(stderr_path),
            exit_code=exit_code,
            duration_s=time.monotonic() - t0,
            error=error,
        )
