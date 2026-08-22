#!/usr/bin/env python3
"""Pack an fp32 checkpoint into fp16 to fit the 256 MB submission size cap.

Real float tensors are stored as float16; complex tensors (e.g. FNO spectral
weights, complex64) are stored as ``torch.view_as_real(t).half()`` pairs, since
half-precision complex serialization is not reliable across torch versions.
Integer/bool tensors and non-tensor entries pass through unchanged.

Typical size effect on the competition FNO baseline: 403 MB -> 193 MB, with a
val rel-L2 change of ~0.07 -> ~0.09 on a real validation window (quantization
plus split difference; inference still runs in fp32 after unpacking).

Usage:
    python pack_ckpt_fp16.py input.pth output_fp16.pth

Accepts either a raw ``state_dict`` or a training checkpoint dict containing
``model_state_dict``.

Load side (put this in your submission.py):

    def unpack_fp16(path):
        raw = torch.load(path, map_location="cpu")
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

    model.load_state_dict(unpack_fp16("model.pth"))
"""

import os
import sys

import torch


def pack_fp16(src: str, dst: str) -> None:
    ckpt = torch.load(src, map_location="cpu")
    sd = ckpt["model_state_dict"] if isinstance(ckpt, dict) and "model_state_dict" in ckpt else ckpt

    packed, complex_keys = {}, []
    for k, v in sd.items():
        if torch.is_tensor(v) and v.is_complex():
            packed[k] = torch.view_as_real(v).half()
            complex_keys.append(k)
        elif torch.is_tensor(v) and torch.is_floating_point(v):
            packed[k] = v.half()
        else:
            packed[k] = v
    torch.save({"state_fp16": packed, "complex_keys": complex_keys}, dst)

    # Round-trip check: max relative error introduced by the fp16 quantization.
    max_rel = 0.0
    for k, v in sd.items():
        if not torch.is_tensor(v) or not (v.is_complex() or torch.is_floating_point(v)):
            continue
        if k in complex_keys:
            back = torch.view_as_complex(torch.view_as_real(v).half().float())
        else:
            back = v.half().float()
        denom = v.abs().max().item()
        if denom > 0:
            max_rel = max(max_rel, ((back - v).abs().max().item() / denom))

    print(f"packed {len(sd)} tensors ({len(complex_keys)} complex)")
    print(f"size: {os.path.getsize(src) / 1e6:.1f} MB -> {os.path.getsize(dst) / 1e6:.1f} MB")
    print(f"round-trip max relative error: {max_rel:.2e}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    pack_fp16(sys.argv[1], sys.argv[2])
