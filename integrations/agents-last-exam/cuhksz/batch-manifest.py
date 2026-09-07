#!/usr/bin/env python3
"""Describe the four installed official ALE scenarios for the batch controller."""
import argparse
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--ale-root", type=Path, default=Path("/data/zzr/frontal-team/ale/repo"))
parser.add_argument("--configs", type=Path, default=Path("/data/zzr/frontal-team/ale/run-configs/dsh-fleet-scenarios"))
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
revision = subprocess.check_output(["git", "-C", str(args.ale_root), "rev-parse", "HEAD"], text=True).strip()
tasks = []
splits = {"data-pipeline": "train", "cost-optimization": "validation", "k8s-migration": "train", "ranking-recovery": "test"}
for name in ("data-pipeline", "cost-optimization", "k8s-migration", "ranking-recovery"):
    experiment = args.configs / (name + ".yaml")
    if not experiment.is_file():
        raise FileNotFoundError(experiment)
    tasks.append({"id": name, "benchmark": "ale", "domain": "computing_math",
                  "split": splits[name],
                  "agentPatch": "/opt/dsh-fleet-ale/headless.patch.yml",
                  "experiment": str(experiment.resolve()), "aleRoot": str(args.ale_root.resolve())})
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps({"schemaVersion": 1, "benchmark": "ale", "sourceRevision": revision,
                                 "source": "https://github.com/rdi-berkeley/agents-last-exam", "tasks": tasks}, indent=2) + "\n")
print(json.dumps({"tasks": len(tasks), "sourceRevision": revision}))
