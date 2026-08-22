"""Minimal metrics used by the vendored baselines.

The upstream realpdebench.utils.metrics also defines eval_metrics /
probe_diagnostic and imports matplotlib at module load. The baselines only need
``mse_loss`` (referenced in FNO3d / CNO3d ``train_loss``), so this trimmed copy
keeps the starting-kit dependency set to torch/numpy/h5py/einops only.
"""
import torch
from torch import nn


def mse_loss(pred, target):
    return nn.MSELoss(reduction="none")(pred, target)
