#!/usr/bin/env python3
"""Load RealPDE baseline checkpoints (CNO / FNO / Transolver) and run a forward
pass. Self-contained: it imports the vendored ``rpde_baselines`` package that
ships inside this starting kit, so it does NOT need the original RealPDEBench
repo on PYTHONPATH.

Checkpoint formats
------------------
  * training checkpoint : dict with key ``model_state_dict`` (+ loss metadata)
  * fp16-packed         : dict with keys ``state_fp16`` and ``complex_keys``
                          (produced by pack_ckpt_fp16.py; metadata dropped)

Foil (airfoil PIV) geometry
---------------------------
  * channels        : (u, v, p);  p = 0 for real data
  * eval resolution : 32 x 64 (native PIV 64 x 128, subsampled by sub_s_real=2)
  * T_in = T_out = 20
The baseline models are resolution-flexible (FNO uses fixed Fourier modes;
Transolver's H*W*D only has to equal T_in*H_s*W_s), so the loader derives the
Transolver reshape dims from the input shape and works at 32x64 or 64x128.

Model hyper-parameters below were read off the checkpoint state_dict shapes, NOT
the repo yaml configs. In particular configs/foil/trainsolver.yaml is stale
(n_layers=1) while the checkpoints have 3 Transolver blocks.

Usage
-----
    from load_baseline import load_baseline, make_example_input
    model, meta = load_baseline("sim_real_fno.pth")        # type auto-detected
    x = make_example_input("3750_0.h5", sub_s=2)           # (1,20,32,64,3)
    y = model(x)                                           # (1,20,32,64,3)
"""
import os
import sys

import numpy as np
import torch

# Make the vendored code importable no matter the current working directory.
# _vendor/ holds bundled third-party deps (einops) and is prepended FIRST so the
# vendored einops resolves ahead of any site-packages copy; the container is not
# required to provide einops.
_HERE = os.path.dirname(os.path.abspath(__file__))
_VENDOR = os.path.join(_HERE, "_vendor")
for _p in (_HERE, _VENDOR):          # _VENDOR ends up at sys.path[0]
    if _p not in sys.path:
        sys.path.insert(0, _p)

from rpde_baselines.model.load_model import load_model  # noqa: E402

# Default foil eval geometry (32x64 = native 64x128 with sub_s_real=2).
T_IN, T_OUT = 20, 20
H_S, W_S = 32, 64
C_IN, C_OUT = 3, 3
IN_SHAPE = (T_IN, H_S, W_S, C_IN)
OUT_SHAPE = (T_OUT, H_S, W_S, C_OUT)

# Per-baseline construction kwargs, verified against checkpoint shapes.
# (Transolver H/W/D are filled in from the input shape by build_model.)
MODEL_KWARGS = {
    "fno": dict(model_name="fno", modes1=4, modes2=12, modes3=16,
                n_layers=4, width=64),
    "cno": dict(model_name="cno", N_layers=3),
    "transolver": dict(
        model_name="transolver", space_dim=3, n_layers=3, n_hidden=256,
        n_head=8, fun_dim=0, out_dim=3, ref=4, dropout=0.1, act="gelu",
        mlp_ratio=4, slice_num=16),
}


class _FakeDataset:
    """Stand-in so load_model can read (input, target) shapes via ds[0]."""

    def __init__(self, in_shape=IN_SHAPE, out_shape=OUT_SHAPE):
        self.in_shape, self.out_shape = in_shape, out_shape

    def __getitem__(self, idx):
        return (torch.zeros(self.in_shape, dtype=torch.float32),
                torch.zeros(self.out_shape, dtype=torch.float32))

    def __len__(self):
        return 1


def detect_model_type(path):
    name = os.path.basename(path).lower()
    if "transolver" in name:
        return "transolver"
    if "cno" in name:
        return "cno"
    if "fno" in name:
        return "fno"
    raise ValueError("cannot infer model type from filename: %s" % name)


def unpack_fp16(obj_or_path):
    """Rebuild an fp32 state_dict from an fp16-packed checkpoint (see
    pack_ckpt_fp16.py): complex tensors are stored view_as_real().half() and
    restored via view_as_complex(float())."""
    raw = (torch.load(obj_or_path, map_location="cpu", weights_only=False)
           if isinstance(obj_or_path, str) else obj_or_path)
    complex_keys = set(raw["complex_keys"])
    sd = {}
    for k, v in raw["state_fp16"].items():
        if k in complex_keys:
            sd[k] = torch.view_as_complex(v.float())
        elif torch.is_tensor(v) and v.dtype == torch.float16:
            sd[k] = v.float()
        else:
            sd[k] = v
    return sd


def load_checkpoint_state(path):
    """Return (state_dict, meta) handling both on-disk formats."""
    obj = torch.load(path, map_location="cpu", weights_only=False)
    if isinstance(obj, dict) and "state_fp16" in obj:
        return unpack_fp16(obj), {"format": "fp16_packed",
                                  "n_complex": len(obj.get("complex_keys", []))}
    if isinstance(obj, dict) and "model_state_dict" in obj:
        meta = {"format": "train_ckpt"}
        for k in ("iteration", "best_iteration", "best_val_loss"):
            if k in obj:
                v = obj[k]
                meta[k] = v.item() if torch.is_tensor(v) else v
        return obj["model_state_dict"], meta
    return obj, {"format": "raw_state_dict"}


def build_model(model_type, device="cpu",
                in_shape=IN_SHAPE, out_shape=OUT_SHAPE):
    kw = dict(MODEL_KWARGS[model_type])
    if model_type == "transolver":
        # Transolver reshapes (B, N=T*H_s*W_s, C) -> (B, H, W, D, C); the product
        # must equal N. Mirror the yaml convention (time on D): H=W_s, W=H_s, D=T.
        t, hs, ws = in_shape[0], in_shape[1], in_shape[2]
        kw.update(H=ws, W=hs, D=t)
    ds = _FakeDataset(in_shape, out_shape)
    return load_model(ds, device=device, **kw)


def load_baseline(model_type_or_ckpt, ckpt_path=None, device="cpu",
                  strict=True, in_shape=IN_SHAPE, out_shape=OUT_SHAPE):
    """Build the model and load the checkpoint. Call as load_baseline(ckpt_path)
    (type auto-detected) or load_baseline(model_type, ckpt_path)."""
    if ckpt_path is None:
        ckpt_path = model_type_or_ckpt
        model_type = detect_model_type(ckpt_path)
    else:
        model_type = model_type_or_ckpt
    model = build_model(model_type, device=device,
                        in_shape=in_shape, out_shape=out_shape)
    state, meta = load_checkpoint_state(ckpt_path)
    res = model.load_state_dict(state, strict=strict)
    meta["model_type"] = model_type
    meta["missing_keys"] = list(getattr(res, "missing_keys", []))
    meta["unexpected_keys"] = list(getattr(res, "unexpected_keys", []))
    model.eval()
    return model, meta


def make_example_input(h5_path, t_start=0, t_in=T_IN, sub_s=2, device="cpu"):
    """Build a (1, T_in, H, W, 3) input tensor from an example h5 file.

    The example file stores top-level ``u``, ``v`` of shape (T, 64, 128). With
    sub_s=2 (the foil real-data pipeline) the result is (1, 20, 32, 64, 3);
    sub_s=1 keeps native (1, 20, 64, 128, 3). Channel 3 (p) is zero.
    """
    import h5py
    with h5py.File(h5_path, "r") as f:
        u = np.asarray(f["u"][t_start:t_start + t_in, ::sub_s, ::sub_s],
                       dtype=np.float32)
        v = np.asarray(f["v"][t_start:t_start + t_in, ::sub_s, ::sub_s],
                       dtype=np.float32)
    data = np.stack([u, v, np.zeros_like(u)], axis=-1)   # (t_in, H, W, 3)
    return torch.from_numpy(data).unsqueeze(0).to(device)
