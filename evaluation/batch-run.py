#!/usr/bin/env python3
"""Bounded, resumable benchmark batches and the curriculum job protocol."""
import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parent.parent
CANCELLED = threading.Event()


def write_json(path: Path, value: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def run(command: list[str], log: Path, timeout: float, cwd: Path | None = None) -> int:
    if timeout <= 0:
        raise ValueError("timeout must be positive")
    if CANCELLED.is_set():
        return 130
    with log.open("wb") as stream:
        process = subprocess.Popen(command, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT, start_new_session=os.name != "nt")
        deadline = time.monotonic() + timeout
        try:
            while not CANCELLED.is_set() and time.monotonic() < deadline:
                try:
                    return process.wait(timeout=min(1, max(0.01, deadline - time.monotonic())))
                except subprocess.TimeoutExpired:
                    pass
            return 130 if CANCELLED.is_set() else 124
        finally:
            if process.poll() is None:
                if os.name == "nt":
                    process.terminate()
                else:
                    os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=45)
                except subprocess.TimeoutExpired:
                    if os.name == "nt":
                        process.kill()
                    else:
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait()


def horizonmath(job: dict, output: Path) -> dict:
    task = job["task"]
    frozen = Path(job.get("sourceWorkspace", REPOSITORY)).resolve()
    image = job.get("image") or "dsh-fleet-evaluation:baseline"
    for name in ("workspace", "results"):
        directory = output / name
        directory.mkdir(mode=0o777, exist_ok=True)
        directory.chmod(0o777)
    command = [job.get("node", "node"), str(REPOSITORY / "evaluation/run-container.mjs"), "--image", image,
               "--task", str(Path(task["task"]).resolve()), "--run-root", str(output),
               "--cpus", str(job.get("cpus", 4)), "--memory", job.get("memory", "8g"),
               "--timeout-ms", str(job.get("timeoutMs", 3600000))]
    command += ["--team", str(Path(task.get("team", frozen / "examples/frontal-team/teams/coding-small.json")).resolve())]
    for key in job.get("env", []):
        command += ["--env", key]
    if job.get("envFile"):
        command += ["--env-file", str(Path(job["envFile"]).resolve())]
    exit_code = run(command, output / "agent.log", job.get("timeoutMs", 3600000) / 1000 + 60)
    if exit_code:
        return {"status": "timeout" if exit_code == 124 else "failed", "exitCode": exit_code}
    solution = output / "workspace/solution.py"
    if not solution.is_file() or solution.is_symlink():
        return {"status": "completed", "score": 0, "feedback": {"errorType": "missing_solution"}}
    # Only the solution crosses the grading boundary, never the agent's workspace or credentials.
    grader_cid = output / ("grader-" + uuid.uuid4().hex + ".cid")
    grader = ["docker", "run", "--rm", "--init", "--cidfile", str(grader_cid), "--network", "none",
              "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128",
              "--cpus", str(job.get("graderCpus", 2)), "--memory", job.get("graderMemory", "4g"),
              "--tmpfs", "/tmp:rw,nosuid,size=1g", "--label", "io.deepseek-harness.benchmark=horizonmath",
              "-v", f"{solution.resolve()}:/submission/solution.py:ro", job.get("graderImage", "dsh-horizonmath-grader:3259167b263e"),
              "--problem", task["id"], "--solution", "/submission/solution.py"]
    try:
        grader_exit = run(grader, output / "grader.log", job.get("graderTimeoutS", 900))
    finally:
        if grader_cid.exists():
            identifier = grader_cid.read_text().strip()
            if re.fullmatch(r"[0-9a-f]{64}", identifier):
                subprocess.run(["docker", "rm", "-f", identifier], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
            grader_cid.unlink()
    if grader_exit:
        return {"status": "timeout" if grader_exit == 124 else "failed", "stage": "grader", "exitCode": grader_exit}
    lines = (output / "grader.log").read_text(encoding="utf-8").splitlines()
    graded = json.loads(next(line for line in reversed(lines) if line.startswith('{"status"')))
    write_json(output / "official-result.json", graded.pop("official"))
    return graded


def ale(job: dict, output: Path) -> dict:
    import yaml
    task = job["task"]
    source = Path(task["experiment"]).resolve()
    config = yaml.safe_load(source.read_text())
    environment_path = Path(config["environment"])
    if not environment_path.is_absolute():
        environment_path = source.parent / environment_path
    environment = yaml.safe_load(environment_path.read_text())
    for snapshot in environment.get("snapshots", {}).values():
        if snapshot.get("provider") == "docker":
            docker = snapshot.setdefault("docker", {})
            docker.update(cpus=job.get("cpus", 4), memory=job.get("memory", "8g"))
            if job.get("image"):
                docker["image_ref"] = job["image"]
    environment_file = output / "environment.yaml"
    environment_file.write_text(yaml.safe_dump(environment))
    config.update(environment=str(environment_file), concurrency=1, auto_resume=False, max_attempts=1,
                  cleanup_mode="delete", wall_time_s=int(job.get("timeoutMs", 3600000) / 1000),
                  output={"root": str(output / "official")})
    if not Path(config["agent"]).is_absolute():
        config["agent"] = str((source.parent / config["agent"]).resolve())
    if task.get("agentPatch"):
        agent_config = yaml.safe_load(Path(config["agent"]).read_text())
        agent_config.setdefault("config", {}).update(patch_path=task["agentPatch"], timeout_ms=job.get("timeoutMs", 3600000))
        agent_file = output / "agent.yaml"
        agent_file.write_text(yaml.safe_dump(agent_config))
        config["agent"] = str(agent_file)
    config_file = output / "experiment.yaml"
    config_file.write_text(yaml.safe_dump(config))
    root = Path(task.get("aleRoot", "/data/zzr/frontal-team/ale/repo"))
    command = [str(root / ".venv/bin/python"), "-m", "ale_run", "run", str(config_file), "--disable-resume"]
    if job.get("dryRun"):
        command += ["--dry-run"]
    exit_code = run(command, output / "agent.log", job.get("timeoutMs", 3600000) / 1000 + 120, cwd=root)
    if job.get("dryRun"):
        return {"status": "dry_run" if exit_code == 0 else "failed", "exitCode": exit_code}
    result_files = list((output / "official").rglob("eval_result.json"))
    if exit_code == 0 and len(result_files) == 1:
        result = json.loads(result_files[0].read_text())
        score = result.get("score")
        if result.get("eval_status") == "success" and type(score) in (int, float) and math.isfinite(score) and 0 <= score <= 1:
            return {"status": "completed", "score": score, "feedback": {"evalStatus": result.get("eval_status")}}
    return {"status": "timeout" if exit_code == 124 else "failed", "exitCode": exit_code,
            "feedback": {"errorType": "missing_or_ambiguous_official_result"}}


def execute_job(job: dict) -> dict:
    if job.get("schemaVersion") != 1:
        raise ValueError("unsupported job schemaVersion")
    output = Path(job["output"]).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    output.chmod(0o700)
    lock = output / ".running"
    # An abandoned lock requires operator inspection rather than duplicating a live episode.
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    started = time.time()
    try:
        if job.get("generation") is not None:
            expected = job.get("sourceCommit")
            if not expected or not job.get("image"):
                raise ValueError("curriculum jobs require sourceCommit and a matching frozen-source image")
            image_metadata = json.loads(subprocess.check_output(["docker", "image", "inspect", job["image"]], text=True))[0]
            actual = (image_metadata["Config"].get("Labels") or {}).get("org.opencontainers.image.revision")
            if actual != expected:
                raise ValueError(f"curriculum image source mismatch: expected {expected}, found {actual}")
        dispatch = {"horizonmath": horizonmath, "ale": ale}
        result = dispatch[job["task"]["benchmark"]](job, output)
    except Exception as error:
        result = {"status": "failed", "error": f"{type(error).__name__}: {error}"}
    finally:
        lock.unlink(missing_ok=True)
    result.update(durationS=round(time.time() - started, 3), benchmark=job["task"]["benchmark"],
                  taskId=job["task"]["id"], split=job.get("split"), sourceCommit=job.get("sourceCommit"))
    write_json(output / "result.json", result)
    return result


def batch(args) -> int:
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    tasks = manifest["tasks"]
    if args.task:
        tasks = [task for task in tasks if task["id"] in args.task]
        if {task["id"] for task in tasks} != set(args.task):
            raise ValueError("one or more requested task IDs are absent from the manifest")
    if len({task["id"] for task in tasks}) != len(tasks):
        raise ValueError("duplicate task IDs")
    if args.limit:
        tasks = tasks[:args.limit]
    args.output.mkdir(parents=True, exist_ok=True)
    source_commit = args.source_commit or subprocess.check_output(["git", "-C", str(REPOSITORY), "rev-parse", "HEAD"], text=True).strip()
    settings = {"image": args.image, "graderImage": args.grader_image, "timeoutMs": args.timeout_ms,
                "cpus": args.cpus, "memory": args.memory, "env": args.env, "envFile": args.env_file,
                "dryRun": args.dry_run, "sourceCommit": source_commit, "sourceWorkspace": str(REPOSITORY)}
    file_hashes = {}
    for task in tasks:
        for key in ("task", "team", "experiment"):
            if task.get(key):
                path = Path(task[key]).resolve()
                file_hashes[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
                if key == "experiment":
                    import yaml
                    config = yaml.safe_load(path.read_text())
                    for reference in (config["environment"], config["agent"]):
                        referenced = Path(reference)
                        if not referenced.is_absolute():
                            referenced = path.parent / referenced
                        file_hashes[str(referenced.resolve())] = hashlib.sha256(referenced.read_bytes()).hexdigest()
    default_team = REPOSITORY / "examples/frontal-team/teams/coding-small.json"
    if default_team.is_file():
        file_hashes[str(default_team)] = hashlib.sha256(default_team.read_bytes()).hexdigest()
    image_ids = {}
    for image in (args.image, args.grader_image if manifest.get("benchmark") == "horizonmath" else None):
        if image:
            metadata = json.loads(subprocess.check_output(["docker", "image", "inspect", image], text=True))[0]
            image_ids[image] = metadata["Id"]
    identity = hashlib.sha256(json.dumps({"manifest": manifest, "settings": settings, "files": file_hashes, "images": image_ids}, sort_keys=True).encode()).hexdigest()
    state_path = args.output / "batch.json"
    if state_path.exists():
        previous = json.loads(state_path.read_text())
        if not args.resume or previous.get("identity") != identity:
            raise ValueError("output already used; --resume requires identical source, manifest and settings")
    else:
        write_json(state_path, {"schemaVersion": 1, "identity": identity, "manifest": manifest, "settings": settings,
                                "fileSha256": file_hashes, "imageIds": image_ids})

    def worker(task):
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", task["id"]):
            raise ValueError("unsafe task ID")
        root = args.output / task["id"]
        last = None
        for attempt in range(args.retries + 1):
            output = root / f"attempt-{attempt + 1:03d}"
            result_file = output / "result.json"
            if result_file.exists():
                last = json.loads(result_file.read_text())
            else:
                last = execute_job({"schemaVersion": 1, **settings, "task": task, "output": str(output)})
            if last["status"] in ("completed", "indeterminate", "dry_run"):
                break
        return last

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.parallel) as pool:
        results = list(pool.map(worker, tasks))
    completed = [result for result in results if result["status"] == "completed" and isinstance(result.get("score"), (int, float))]
    summary = {"total": len(results), "completed": len(completed), "results": results,
               "statusCounts": {status: sum(r["status"] == status for r in results) for status in sorted({r["status"] for r in results})},
               "meanCompletedScore": sum(r["score"] for r in completed) / len(completed) if completed else None,
               "lowerBoundScoreAllTasks": sum(r["score"] for r in completed) / len(results) if results else None}
    write_json(args.output / "summary.json", summary)
    print(json.dumps({key: value for key, value in summary.items() if key != "results"}))
    return 0 if all(r["status"] in ("completed", "indeterminate", "dry_run") for r in results) else 1


def main():
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: CANCELLED.set())
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", type=Path, help="Execute one curriculum job JSON")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--task", action="append", default=[])
    parser.add_argument("--limit", type=int)
    parser.add_argument("--parallel", type=int, default=1)
    parser.add_argument("--retries", type=int, default=1, help="Retry infrastructure failures, never wrong answers")
    parser.add_argument("--timeout-ms", type=int, default=3600000)
    parser.add_argument("--cpus", type=float, default=4)
    parser.add_argument("--memory", default="8g")
    parser.add_argument("--image")
    parser.add_argument("--source-commit", help="Source identity for a deployed snapshot without .git")
    parser.add_argument("--grader-image", default="dsh-horizonmath-grader:3259167b263e")
    parser.add_argument("--env", action="append", default=[])
    parser.add_argument("--env-file")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Validate native ALE run matrix without model calls")
    args = parser.parse_args()
    if args.job:
        result = execute_job(json.loads(args.job.read_text(encoding="utf-8")))
        print(json.dumps(result))
        return 0 if result["status"] in ("completed", "indeterminate", "dry_run") else 1
    if not args.manifest or not args.output:
        parser.error("--manifest and --output are required unless --job is supplied")
    if args.parallel < 1 or args.retries < 0 or args.timeout_ms <= 0 or args.cpus <= 0 or (args.limit is not None and args.limit <= 0):
        parser.error("parallel, timeout, CPUs and limit must be positive; retries cannot be negative")
    return batch(args)


if __name__ == "__main__":
    sys.exit(main())
