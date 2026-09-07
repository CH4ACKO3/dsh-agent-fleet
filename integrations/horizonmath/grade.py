#!/usr/bin/env python3
"""Invoke the pinned official evaluator. Run only inside the grader container."""
import argparse
import json
from pathlib import Path


def summarize(result: dict) -> dict:
    mode = result.get("mode")
    if mode not in ("numeric", "construction", "benchmark"):
        return {"status": "failed", "feedback": {"errorType": "unknown_official_mode"}}
    if result.get("error_type") in ("no_validator", "no_ground_truth"):
        return {"status": "failed", "feedback": {"errorType": result["error_type"]}}
    diagnostic = str(result.get("error_message", "")) + str(result.get("validator_message", ""))
    if any(marker in diagnostic for marker in ("No module named", "SageMath not found", "SAGE_CMD")):
        return {"status": "failed", "feedback": {"errorType": "grader_dependency_missing"}}
    indeterminate = result.get("error_type") == "compliance_indeterminate"
    if mode == "numeric":
        passed = bool(result.get("success"))
    elif mode == "construction":
        passed = bool(result.get("valid"))
    else:
        comparison = result.get("baseline_comparison") or {}
        passed = bool(result.get("valid")) and comparison.get("result", "no_baseline") in ("beats_baseline", "no_baseline")
    return {"status": "indeterminate" if indeterminate else "completed", "score": None if indeterminate else int(passed),
            "feedback": {"mode": mode, "valid": result.get("valid", result.get("success")),
                         "errorType": result.get("error_type"), "matchingDigits": result.get("matching_digits"),
                         "complianceStatus": result.get("compliance_status")}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--problem", required=True)
    parser.add_argument("--solution", type=Path, required=True)
    args = parser.parse_args()
    from evaluate_responses import evaluate_response, _sanitize_for_json
    from baseline_comparator import load_baselines
    problems = json.loads(Path("data/problems_full.json").read_text())
    index, problem = next((i, p) for i, p in enumerate(problems) if p["id"] == args.problem)
    result = evaluate_response(problem, index, args.solution.read_text(), load_baselines(Path("data/baselines.json")))
    print(json.dumps(_sanitize_for_json({**summarize(result), "official": result})))


if __name__ == "__main__":
    main()
