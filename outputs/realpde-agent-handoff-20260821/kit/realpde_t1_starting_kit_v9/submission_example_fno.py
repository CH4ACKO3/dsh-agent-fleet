"""RealPDE Track 1 Sim2Real submission: official FNO baseline (sim_real_ft, fp16-packed).

This is the exact submission the organizers ran on the Main Development
leaderboard, kept here as a worked example of wrapping a pretrained baseline
behind the Track 1 ``predict()`` API.

How to use it
-------------
1. Download ``sim_real_ft/sim_real_fno_fp16.pth`` from the competition Google
   Drive (see README).
2. Build a zip whose ROOT contains, side by side:

       submission.py                  <- this file, renamed
       sim_real_fno_fp16.pth          <- the checkpoint
       load_baseline.py               <- from this kit
       rpde_baselines/                <- from this kit
       _vendor/                       <- from this kit

3. Submit the zip. Swap ``load_baseline`` / the checkpoint for your own model
   once the round trip works.

What it does
------------
Mirrors the benchmark evaluation pipeline (realpdebench ``eval.py``): inputs are
z-scored with GaussianNormalizer statistics fitted on train_real, the FNO runs in
normalized space, and the prediction is mapped back to physical space with the
target statistics. Skipping this normalization is the single most common reason
a correctly-loaded baseline still scores badly.
"""

from __future__ import annotations

import os
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import torch  # noqa: E402

from load_baseline import load_baseline  # noqa: E402  (prepends _vendor/ for einops)

_CKPT_PATH = os.path.join(_HERE, "sim_real_fno_fp16.pth")

# GaussianNormalizer statistics fitted on train_real 32x64 windows, channel
# order [u, v, p]; extracted from the benchmark's cached mean_std_real.pt.
# The p channel is unmeasured in real data (all zeros), so its stored std is 0
# and is replaced by 1 at runtime, exactly as GaussianNormalizer.__init__ does.
_MEAN_IN = np.array([0.154960856, -0.000513992854, 0.0], dtype=np.float32)
_STD_IN = np.array([0.0968056545, 0.015960684, 1.0], dtype=np.float32)
_MEAN_TGT = np.array([0.154962569, -0.000517793698, 0.0], dtype=np.float32)
_STD_TGT = np.array([0.0968104079, 0.0159636438, 1.0], dtype=np.float32)

_BATCH = 16

_state = {"model": None, "device": None}


def _get_model():
    if _state["model"] is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model, _meta = load_baseline(_CKPT_PATH, device=device)
        model = model.to(device)
        model.eval()
        _state["model"] = model
        _state["device"] = device
    return _state["model"], _state["device"]


def predict(input_array, metadata=None):
    """Track 1 API: (N, T_in, H, W, C) raw fields -> (N, T_out, H, W, C)."""
    x = np.asarray(input_array, dtype=np.float32)
    model, device = _get_model()

    mean_in = torch.from_numpy(_MEAN_IN).to(device)
    std_in = torch.from_numpy(_STD_IN).to(device)
    mean_tgt = torch.from_numpy(_MEAN_TGT).to(device)
    std_tgt = torch.from_numpy(_STD_TGT).to(device)

    outs = []
    with torch.no_grad():
        for i in range(0, x.shape[0], _BATCH):
            xb = torch.from_numpy(np.ascontiguousarray(x[i:i + _BATCH])).to(device)
            xb = (xb - mean_in) / std_in
            yb = model(xb)
            yb = yb * std_tgt + mean_tgt
            outs.append(yb.float().cpu().numpy())

    prediction = np.concatenate(outs, axis=0).astype(np.float32)
    prediction[..., 2] = 0.0  # p is unmeasured in real data
    return prediction
