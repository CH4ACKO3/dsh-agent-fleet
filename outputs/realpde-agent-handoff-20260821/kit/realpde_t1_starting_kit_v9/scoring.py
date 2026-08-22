#!/usr/bin/env python3
"""Subscore reference implementation for RealPDE Track 1 Sim2Real.

The five subscores computed here are the ones the leaderboard computes, so you
can check them locally against your own reference data. The leaderboard combines
them into a single ``final_score``; that combination is not published, and this
file stops at the subscores.
"""

from __future__ import annotations

import html
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


DEFAULT_IN_STEP = 20
T_NUMERICAL_SEC = 0.72896
# Frozen for the season: the mean of the u and v channel standard deviations on
# the official train_real split, (0.09681041 + 0.01596364) / 2.
SIGMA_GLOBAL = 0.0563870259


def find_file(root: Path, name: str) -> Path:
    direct = root / name
    if direct.exists():
        return direct
    matches = sorted(root.rglob(name))
    if not matches:
        raise FileNotFoundError(f"Could not find {name} under {root}")
    return matches[0]


def load_predictions(input_dir: Path) -> dict[str, Any]:
    path = find_file(input_dir, "predictions.npz")
    with np.load(path, allow_pickle=False) as data:
        result = {k: data[k] for k in data.files}
    if "prediction" not in result:
        raise KeyError("predictions.npz must contain key 'prediction'.")
    result["prediction"] = np.asarray(result["prediction"], dtype=np.float32)
    if "lower" in result:
        result["lower"] = np.asarray(result["lower"], dtype=np.float32)
    if "upper" in result:
        result["upper"] = np.asarray(result["upper"], dtype=np.float32)
    return result


def load_targets_from_npz(reference_dir: Path) -> np.ndarray:
    path = reference_dir / "targets.npz"
    if not path.exists():
        raise FileNotFoundError("The reference package is missing its targets file.")
    with np.load(path, allow_pickle=False) as data:
        if "target" not in data:
            raise KeyError("The reference package must contain key 'target'.")
        return np.asarray(data["target"], dtype=np.float32)


def load_targets(reference_dir: Path) -> np.ndarray:
    return load_targets_from_npz(reference_dir)


def resolve_reference_dir(input_dir: Path) -> Path:
    # Looks for targets.npz under <input>/ref, or a directory given as argv[4].
    candidates = [input_dir / "ref"]
    if len(sys.argv) > 4:
        candidates.append(Path(sys.argv[4]))
    candidates += [Path("/app/input/ref"), Path("/app/reference_data")]
    for cand in candidates:
        if (cand / "targets.npz").exists():
            return cand
    return candidates[0]


def measured_channels(target: np.ndarray) -> int:
    channels = target.shape[-1]
    active = []
    for idx in range(channels):
        active.append(not np.allclose(target[..., idx], 0.0))
    count = int(sum(active))
    return max(1, count)


def rel_l2_per_sample(pred: np.ndarray, target: np.ndarray, c: int) -> np.ndarray:
    p = pred[..., :c].reshape(pred.shape[0], -1)
    t = target[..., :c].reshape(target.shape[0], -1)
    denom = np.linalg.norm(t, axis=1).clip(min=1e-8)
    return np.linalg.norm(p - t, axis=1) / denom


def kinetic_energy(x: np.ndarray) -> np.ndarray:
    u = x[..., 0]
    v = x[..., 1]
    u_prime = np.mean((u - np.mean(u, axis=1, keepdims=True)) ** 2, axis=1)
    v_prime = np.mean((v - np.mean(v, axis=1, keepdims=True)) ** 2, axis=1)
    return 0.5 * (u_prime + v_prime)


def tke_rel_l2_per_sample(pred: np.ndarray, target: np.ndarray, c: int) -> np.ndarray:
    if c < 2:
        return np.zeros((pred.shape[0],), dtype=np.float32)
    pred_ke = kinetic_energy(pred[..., :c])
    target_ke = kinetic_energy(target[..., :c])
    p = pred_ke.reshape(pred.shape[0], -1)
    t = target_ke.reshape(target.shape[0], -1)
    denom = np.linalg.norm(t, axis=1).clip(min=1e-8)
    return np.linalg.norm(p - t, axis=1) / denom


def mvpe_rel_l2_per_sample(pred: np.ndarray, target: np.ndarray, sub_s_real: int = 2) -> np.ndarray:
    d = 16
    center_x = 10
    center_y = 32
    n_probe = 9
    N, _, h, w, _ = pred.shape
    probe_center_y = int(center_y / sub_s_real)
    interval_y = min(2, int(h / (n_probe + 1)))
    probe_y = [
        probe_center_y + interval_y * j
        for j in range(-(n_probe - 1) // 2, n_probe - (n_probe - 1) // 2)
    ]
    probe_y = [y for y in probe_y if 0 <= y < h]
    if not probe_y:
        return np.zeros((N,), dtype=np.float32)

    errors = []
    for i in range(4):
        if int((2 * d + center_x) / sub_s_real) < w:
            probe_x = int(((i + 1) * d + center_x) / sub_s_real)
        else:
            probe_x = int((0.5 * (i + 2) * d + center_x) / sub_s_real)
        if not 0 <= probe_x < w:
            continue
        pp = pred[:, :, probe_y, probe_x, :2].mean(axis=1).reshape(N, -1)
        tt = target[:, :, probe_y, probe_x, :2].mean(axis=1).reshape(N, -1)
        denom = np.linalg.norm(tt, axis=1).clip(min=1e-8)
        errors.append(np.linalg.norm(pp - tt, axis=1) / denom)
    if not errors:
        return np.zeros((N,), dtype=np.float32)
    return np.mean(np.stack(errors, axis=0), axis=0)


def mvpe_rel_l2(pred: np.ndarray, target: np.ndarray, sub_s_real: int = 2) -> float:
    return float(np.mean(mvpe_rel_l2_per_sample(pred, target, sub_s_real)))


def score_error(err: float, scale: float = 0.5) -> float:
    if not np.isfinite(err):
        return 0.0
    return float(100.0 / (1.0 + abs(scale) * max(float(err), 0.0)))


def score_time(t_neural: float, r_min: float = 1.0) -> float:
    # ST = 1 / (1 + sqrt(r)), r = t_neural / t_numerical; score = 100 * ST.
    # A missing, zero, negative or non-finite time scores 0.
    if not np.isfinite(t_neural) or t_neural <= 0.0:
        return 0.0
    r = float(t_neural) / T_NUMERICAL_SEC
    st = 1.0 / (1.0 + (r / r_min) ** 0.5)
    return float(100.0 * st)


def aggregate_sps(
    pred: np.ndarray,
    target: np.ndarray,
    c: int,
    lower: np.ndarray | None = None,
    upper: np.ndarray | None = None,
    normalize_factor: float = 0.5,
    weight_dm: float = 0.5,
    weight_tke: float = 0.3,
    weight_mvpe: float = 0.2,
) -> tuple[float, float]:
    p = pred[..., :c]
    t = target[..., :c]
    sigma = SIGMA_GLOBAL
    if lower is None and upper is None:
        interval = 0.1 * np.abs(p)
        lower = p - interval / 2.0
        upper = p + interval / 2.0
    else:
        if lower is None or upper is None:
            raise ValueError("SPS bounds require both lower and upper, or neither.")
        # Participant-supplied bounds must be per-element (same shape as the measured
        # prediction), finite, and correctly ordered; reject anything else rather than
        # broadcasting a scalar or silently accepting a reversed interval.
        lower = np.asarray(lower, dtype=np.float32)[..., :c]
        upper = np.asarray(upper, dtype=np.float32)[..., :c]
        if lower.shape != p.shape or upper.shape != p.shape:
            raise ValueError(
                f"SPS bounds have per-sample shape {tuple(lower.shape[1:])}/"
                f"{tuple(upper.shape[1:])}, which must match the prediction's "
                f"{tuple(p.shape[1:])}"
            )
        if not (np.all(np.isfinite(lower)) and np.all(np.isfinite(upper))):
            raise ValueError("SPS bounds must be finite.")
        if np.any(lower > upper):
            raise ValueError("SPS bounds require lower <= upper for every element.")

    inside = (t >= lower) & (t <= upper)
    nil = (upper - lower) / sigma

    # Targets outside the PIV field of view or inside the airfoil body are not
    # scored: they leave the interval average and the coverage, numerator and
    # denominator both. The accuracy factors below are per-window norms over the
    # whole measured field and are not masked.
    scored = t != 0.0
    n_scored = int(np.count_nonzero(scored))
    if n_scored == 0:
        raise ValueError(
            "Reference has no measured element with a non-zero target, so there "
            "is nothing for SPS to score."
        )

    dm = rel_l2_per_sample(pred, target, c)
    tke = tke_rel_l2_per_sample(pred, target, c)
    mvpe = mvpe_rel_l2_per_sample(pred, target)

    dm = dm / (normalize_factor + dm)
    tke = tke / (normalize_factor + tke)
    mvpe = mvpe / (normalize_factor + mvpe)


    def branch(pm: np.ndarray) -> float:
        shaped_pm = pm.reshape((pm.shape[0],) + (1,) * (p.ndim - 1))
        elem = (1.0 - shaped_pm) * np.exp(-nil)
        elem = np.where(inside, elem, 0.0)
        # A sample whose metric is not finite scores zero here; it stays in
        # the average rather than leaving it.
        elem = np.where(np.isfinite(shaped_pm), elem, 0.0)
        val = float(np.sum(elem, where=scored, dtype=np.float64) / n_scored)
        return val if np.isfinite(val) else 0.0

    sps_dm = branch(dm)
    sps_tke = branch(tke)
    sps_mvpe = branch(mvpe)
    weighted = weight_dm * sps_dm + weight_tke * sps_tke + weight_mvpe * sps_mvpe
    # Coverage counts the same element set the interval average does, not the
    # set the accuracy factors do.
    coverage = float(np.count_nonzero(inside & scored) / n_scored)
    return weighted, coverage


def score_sps(value: float) -> float:
    # The aggregate already lies in [0, 1]; the score is that value read directly.
    if not np.isfinite(value):
        return 0.0
    return float(100.0 * min(max(float(value), 0.0), 1.0))


def validate_shapes(pred: np.ndarray, target: np.ndarray) -> None:
    if pred.ndim != 5:
        raise ValueError(f"Prediction must have shape (N,T,H,W,C); this one has {pred.ndim} axes.")
    if target.ndim != 5:
        raise ValueError("Reference target array is malformed.")
    if pred.shape != target.shape:
        raise ValueError(
            f"Prediction has per-sample shape {tuple(pred.shape[1:])}, which does "
            "not match the reference."
        )


def _fmt(value: Any) -> str:
    return f"{value:.6f}" if isinstance(value, (int, float)) else str(value)


def write_detailed_results(output_dir: Path, scores: dict[str, Any]) -> None:
    # Escape key and value; html.escape is the identity on ordinary subscores.
    rows = "\n".join(
        f"<tr><th>{html.escape(key)}</th><td>{html.escape(_fmt(value))}</td></tr>"
        for key, value in scores.items()
    )
    document = f"""<!doctype html>
<html>
<head><meta charset="utf-8"><title>RealPDE Sim2Real Results</title></head>
<body>
<h1>RealPDE Track 1 Sim2Real Results</h1>
<table>{rows}</table>
</body>
</html>
"""
    (output_dir / "detailed_results.html").write_text(document, encoding="utf-8")


ZERO_SCORES = {
    "rel_l2_score": 0.0, "tke_score": 0.0, "mvpe_score": 0.0,
    "time_score": 0.0, "sps_score": 0.0,
}


def _write(output_dir: Path, scores: dict) -> None:
    with open(output_dir / "scores.json", "w", encoding="utf-8") as f:
        json.dump(scores, f, indent=2)
    write_detailed_results(output_dir, scores)


def _score_submission(input_dir: Path, reference_dir: Path) -> dict:
    pred_bundle = load_predictions(input_dir)
    pred = np.asarray(pred_bundle["prediction"], dtype=np.float32)
    target = load_targets(reference_dir)
    validate_shapes(pred, target)

    # A valid submission must produce finite predictions everywhere; a non-finite
    # prediction is invalid and scores zero on every subscore.
    if not np.all(np.isfinite(pred)):
        return dict(ZERO_SCORES)

    c = measured_channels(target)
    rel_l2 = float(np.mean(rel_l2_per_sample(pred, target, c)))
    tke = float(np.mean(tke_rel_l2_per_sample(pred, target, c)))
    mvpe = mvpe_rel_l2(pred, target)
    mean_t_neural_s = float(np.asarray(pred_bundle.get("mean_t_neural_s", [0.0])).reshape(-1)[0])
    sps, coverage = aggregate_sps(
        pred,
        target,
        c,
        lower=pred_bundle.get("lower"),
        upper=pred_bundle.get("upper"),
    )

    # The five 0-100 subscores. The leaderboard combines them into final_score
    # by a rule that is not published, so this file stops here.
    return {
        "rel_l2_score": score_error(rel_l2),
        "tke_score": score_error(tke),
        "mvpe_score": score_error(mvpe),
        "time_score": score_time(mean_t_neural_s),
        "sps_score": score_sps(sps),
    }


def main() -> None:
    input_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/app/input")
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("/app/output")
    reference_dir = resolve_reference_dir(input_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Any failure parsing/validating the submission bundle yields a controlled
    # zero-score result rather than an uncaught crash. SystemExit is re-raised.
    try:
        scores = _score_submission(input_dir, reference_dir)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - untrusted input, degrade to zero
        scores = dict(ZERO_SCORES)
        scores["error"] = f"{type(exc).__name__}: {exc}"[:200]
    _write(output_dir, scores)


if __name__ == "__main__":
    main()
