#!/usr/bin/env python3
"""Export official prompts and source provenance, never reference answers."""
import argparse
import ast
import hashlib
import json
import re
import subprocess
from pathlib import Path

PINNED_REVISION = "3259167b263ecd054315a41e42a726e834a9122f"


def export(checkout: Path, output: Path, revision: str = PINNED_REVISION) -> dict:
    actual = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    if actual != revision:
        raise ValueError(f"HorizonMath revision mismatch: expected {revision}, found {actual}")
    if subprocess.check_output(["git", "-C", str(checkout), "status", "--porcelain", "--untracked-files=no"], text=True).strip():
        raise ValueError("HorizonMath checkout has modified tracked files")
    source = checkout / "data/problems_full.json"
    problems = json.loads(source.read_text(encoding="utf-8"))
    # Extract only constant prompt assignments; importing the generator loads API clients.
    constants = {}
    syntax = ast.parse((checkout / "scripts/run_benchmark.py").read_text(encoding="utf-8"))
    for node in syntax.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ("_SYSTEM_MESSAGE_BASE", "SYSTEM_MESSAGES") for t in node.targets):
            exec(compile(ast.Module(body=[node], type_ignores=[]), "official-prompts", "exec"), {"__builtins__": {}}, constants)
    tasks_dir = output / "tasks"
    tasks_dir.mkdir(parents=True, exist_ok=True)
    tasks = []
    for problem in problems:
        identifier = problem["id"]
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", identifier):
            raise ValueError(f"Invalid problem identifier: {identifier!r}")
        prompt = constants["SYSTEM_MESSAGES"][problem["evaluation_mode"]] + "\n\n" + problem["prompt"]
        prompt += "\n\nSave your final answer as /workspace/solution.py, defining proposed_solution().\n"
        task_file = tasks_dir / f"{identifier}.md"
        task_file.write_text(prompt, encoding="utf-8")
        tasks.append({"id": identifier, "benchmark": "horizonmath", "domain": problem["domain"],
                      "solvability": problem["solvability"], "evaluationMode": problem["evaluation_mode"],
                      "task": str(task_file.resolve()), "promptSha256": hashlib.sha256(prompt.encode()).hexdigest()})
    manifest = {"schemaVersion": 1, "benchmark": "horizonmath", "source": "https://github.com/ewang26/HorizonMath",
                "sourceRevision": actual, "dataSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "tasks": tasks}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--revision", default=PINNED_REVISION)
    args = parser.parse_args()
    manifest = export(args.checkout.resolve(), args.output.resolve(), args.revision)
    print(json.dumps({"tasks": len(manifest["tasks"]), "sourceRevision": manifest["sourceRevision"], "dataSha256": manifest["dataSha256"]}))
