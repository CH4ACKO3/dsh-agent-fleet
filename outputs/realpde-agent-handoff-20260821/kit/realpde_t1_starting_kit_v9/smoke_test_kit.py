#!/usr/bin/env python3
"""Clean-room smoke test for the vendored RealPDE Track-1 starting kit.

Run it from a directory that is NOT the original RealPDEBench repo, with only the
kit dir on PYTHONPATH, e.g.:

    cd /tmp/anywhere_clean
    PYTHONPATH=/path/to/kit python /path/to/kit/smoke_test_kit.py

It proves the kit imports and runs without the upstream repo:
  (0) `import realpdebench` FAILS and `rpde_baselines` resolves inside the kit;
  (A) every checkpoint loads (strict) into its model;
  (B) CNO / FNO / Transolver forward at both 32x64 and 64x128;
  (C) pack_ckpt_fp16.py round-trips FNO fp32<->fp16 with small numeric error;
  (D) submission_template.py's optional lower/upper dict output has the keys,
      dtype and shapes the scorer expects;
  (E) every baseline still imports, builds and forwards with the packages the
      evaluation image lacks (see MISSING_IN_EVAL_IMAGE) blocked.

Checkpoints/example are read from $CKPT_DIR and $EXAMPLE_H5 (they are downloaded
separately from Google Drive, per the README; they are not shipped in the kit).
Sections (A)-(C) are skipped when they are absent, so (0), (D) and (E) can be run
anywhere, including inside the evaluation image:

    docker run --rm -v /path/to/kit:/kit:ro --entrypoint python \
        pytorch/pytorch:2.2.2-cuda12.1-cudnn8-runtime /kit/smoke_test_kit.py
"""
import importlib.machinery
import importlib.util
import os
import subprocess
import sys

import numpy as np
import torch

_KIT = os.path.dirname(os.path.abspath(__file__))


class _NoSystemEinops:
    """Simulate an offline container that does NOT ship einops: reject any
    einops whose file lives outside this kit, so a successful Transolver
    forward proves the vendored copy (kit/_vendor/einops) is self-sufficient."""

    def find_spec(self, name, path=None, target=None):
        if name == "einops" or name.startswith("einops."):
            spec = importlib.machinery.PathFinder.find_spec(name, path)
            if spec and spec.origin and spec.origin not in ("built-in", "frozen"):
                if not os.path.abspath(spec.origin).startswith(_KIT):
                    raise ModuleNotFoundError(
                        "simulated container without einops: blocked %s" % spec.origin)
            return spec
        return None


# Verified by importing them inside pytorch/pytorch:2.2.2-cuda12.1-cudnn8-runtime,
# the Track 1 evaluation image: these are absent there. (einops is absent too, but
# it must still resolve from the kit's own _vendor/, so _NoSystemEinops handles it
# separately.) Packages the image does ship, and that the vendored CNO stack relies
# on, include requests, setuptools/pkg_resources and torch.utils.cpp_extension.
MISSING_IN_EVAL_IMAGE = {"scipy", "h5py", "matplotlib", "pandas"}


class _BlockedTopLevel:
    """Simulate the evaluation image's package set: reject the named top-level
    modules outright, so a successful build+forward proves the kit needs nothing
    beyond torch + numpy + its own vendored code."""

    def __init__(self, names):
        self.names = set(names)

    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in self.names:
            raise ModuleNotFoundError(
                "simulated evaluation image without %s: blocked %s"
                % (name.split(".")[0], name))
        return None


def _purge_modules(prefixes):
    """Drop already-imported modules so the next import really re-executes."""
    hit = [k for k in sys.modules
           if any(k == p or k.startswith(p + ".") for p in prefixes)]
    return {k: sys.modules.pop(k) for k in hit}


# Install the blocker before anything imports einops.
sys.meta_path.insert(0, _NoSystemEinops())

KIT = os.path.dirname(os.path.abspath(__file__))
# Default next to the kit, so the paths in this file say nothing about where the
# organizers happen to keep theirs. Override with $CKPT_DIR / $EXAMPLE_H5.
CKPT_DIR = os.environ.get("CKPT_DIR", os.path.join(KIT, "ckpts"))
EXAMPLE_H5 = os.environ.get(
    "EXAMPLE_H5", os.path.join(KIT, "example_data", "3750_0.h5"))
PACK = os.path.join(KIT, "pack_ckpt_fp16.py")


def hr(t):
    print("\n" + "=" * 70 + "\n" + t + "\n" + "=" * 70)


def main():
    torch.manual_seed(0)
    skipped = []

    hr("(0) INDEPENDENCE: no reliance on the original realpdebench repo")
    try:
        import realpdebench  # noqa: F401
        print("WARNING: `import realpdebench` unexpectedly succeeded at",
              realpdebench.__file__)
    except ModuleNotFoundError:
        print("OK: `import realpdebench` fails (repo not on path)")
    import load_baseline as lb   # prepends kit + kit/_vendor to sys.path
    import rpde_baselines
    inside = os.path.abspath(rpde_baselines.__file__).startswith(KIT)
    print("rpde_baselines resolves inside kit:", inside, "->",
          rpde_baselines.__file__)
    assert inside, "vendored package is not being imported from the kit!"

    # einops isolation: the venv actually has a site-packages einops, but with
    # the blocker active only the kit's vendored copy is allowed to load.
    import einops
    ein_inside = os.path.abspath(einops.__file__).startswith(KIT)
    print("einops blocker active; kit uses vendored einops:", ein_inside,
          "->", einops.__file__)
    assert ein_inside, "einops did not resolve to the vendored copy!"

    # Prove the blocker has teeth: drop _vendor from sys.path so only the
    # site-packages einops remains, and confirm it is rejected (i.e. the kit
    # would NOT silently fall back to a container einops).
    _saved_path, _saved_mods = list(sys.path), {
        k: v for k, v in sys.modules.items()
        if k == "einops" or k.startswith("einops.")}
    try:
        vend = os.path.join(KIT, "_vendor")
        sys.path[:] = [p for p in sys.path if os.path.abspath(p) != vend]
        for k in list(_saved_mods):
            del sys.modules[k]
        try:
            __import__("einops")
            print("  (note: no site-packages einops present to reject)")
        except ModuleNotFoundError as e:
            print("  blocker has teeth: non-kit einops rejected ->", str(e)[:70])
    finally:
        sys.path[:] = _saved_path
        for k in [k for k in sys.modules if k == "einops" or k.startswith("einops.")]:
            del sys.modules[k]
        sys.modules.update(_saved_mods)

    all_ckpts = [
        "sim_cno.pth", "sim_fno.pth", "sim_fno_fp16.pth", "sim_transolver.pth",
        "sim_real_cno.pth", "sim_real_fno.pth", "sim_real_fno_fp16.pth",
        "sim_real_transolver.pth",
    ]

    hr("(A) LOAD EVERY CHECKPOINT (strict) + (B) FORWARD AT 32x64 AND 64x128")
    have_ckpts = any(os.path.exists(os.path.join(CKPT_DIR, n)) for n in all_ckpts)
    if os.path.exists(EXAMPLE_H5):
        x32 = lb.make_example_input(EXAMPLE_H5, sub_s=2)   # (1,20,32,64,3)
        x64 = lb.make_example_input(EXAMPLE_H5, sub_s=1)   # (1,20,64,128,3)
        print("inputs:", tuple(x32.shape), "and", tuple(x64.shape))
    else:
        x32 = torch.randn(1, 20, 32, 64, 3)
        x64 = torch.randn(1, 20, 64, 128, 3)
        print("EXAMPLE_H5 not found (%s); using random inputs of the same shapes"
              % EXAMPLE_H5)
    forwarded = set()
    failures = []
    if not have_ckpts:
        print("no checkpoint found under CKPT_DIR=%s; (A)-(B) skipped "
              "(download them from Google Drive, see README)" % CKPT_DIR)
        skipped.append("(A)-(B) checkpoint load + forward")
    for name in (all_ckpts if have_ckpts else []):
        path = os.path.join(CKPT_DIR, name)
        if not os.path.exists(path):
            print("\n[%s] MISSING (download from GD) - skipped" % name)
            continue
        try:
            model, meta = lb.load_baseline(path, strict=True)
            ok = not meta["missing_keys"] and not meta["unexpected_keys"]
            extra = ""
            if meta.get("best_val_loss") is not None:
                extra = " best_val_loss=%.4f" % meta["best_val_loss"]
            print("\n[%s] type=%s fmt=%s strict=%s%s" %
                  (name, meta["model_type"], meta["format"],
                   "OK" if ok else "MISMATCH", extra))
            if meta["missing_keys"] or meta["unexpected_keys"]:
                print("    missing=%s unexpected=%s" %
                      (meta["missing_keys"][:4], meta["unexpected_keys"][:4]))
            mt = meta["model_type"]
            if mt not in forwarded:
                for tag, xin, hs, ws in (("32x64", x32, 32, 64),
                                         ("64x128", x64, 64, 128)):
                    m2, _ = lb.load_baseline(
                        path, strict=True,
                        in_shape=(20, hs, ws, 3), out_shape=(20, hs, ws, 3))
                    with torch.no_grad():
                        y = m2(xin)
                    print("    forward %-6s: %s -> %s finite=%s" %
                          (tag, tuple(xin.shape), tuple(y.shape),
                           bool(torch.isfinite(y).all())))
                    assert tuple(y.shape) == (1, 20, hs, ws, 3)
                    del m2
                forwarded.add(mt)
            del model
        except Exception as e:
            print("\n[%s] ERROR: %r" % (name, e))
            failures.append((name, repr(e)))
    assert not failures, "checkpoint(s) present but failing: %s" % failures
    if have_ckpts:
        # Every model type whose checkpoint is present must have forwarded. A
        # partial download (say CNO only) is fine; a present checkpoint that
        # failed to forward is not.
        expected = {t for t in ("cno", "fno", "transolver")
                    if any(t in n and os.path.exists(os.path.join(CKPT_DIR, n))
                           for n in all_ckpts)}
        print("\nforwarded model types:", sorted(forwarded),
              "(checkpoints present for %s)" % sorted(expected))
        assert forwarded == expected, "expected %s, forwarded %s" % (
            sorted(expected), sorted(forwarded))

    hr("(C) FP16 PACK ROUND-TRIP (FNO, via vendored pack_ckpt_fp16.py)")
    src = os.path.join(CKPT_DIR, "sim_fno.pth")
    dst = os.path.join("/tmp", "kit_smoke_fno_fp16.pth")
    packed = os.path.exists(src)
    if not packed:
        print("SKIPPED: %s not present" % src)
        skipped.append("(C) fp16 pack round-trip")
    else:
        out = subprocess.run([sys.executable, PACK, src, dst],
                             capture_output=True, text=True)
        print(out.stdout.strip() or out.stderr.strip())
        # A present source that fails to pack is a real defect, not a skip.
        assert out.returncode == 0, "pack_ckpt_fp16.py failed on %s" % src
    if packed:
        fp32, _ = lb.load_checkpoint_state(src)
        fp16 = lb.unpack_fp16(dst)
        m_abs = m_rel = 0.0
        for k, v in fp32.items():
            if torch.is_tensor(v) and (v.is_complex() or torch.is_floating_point(v)):
                d = (fp16[k] - v).abs().max().item()
                m_abs = max(m_abs, d)
                den = v.abs().max().item()
                if den > 0:
                    m_rel = max(m_rel, d / den)
        print("weight round-trip: max_abs=%.3e max_rel=%.3e" % (m_abs, m_rel))
        m32, _ = lb.load_baseline("fno", src, strict=True)
        m16 = lb.build_model("fno")
        m16.load_state_dict(fp16, strict=True)
        m16.eval()
        with torch.no_grad():
            y32, y16 = m32(x32), m16(x32)
        den = y32.abs().max().item()
        print("fp16-vs-fp32 forward: max_abs=%.3e max_rel=%.3e" %
              ((y16 - y32).abs().max().item(),
               (y16 - y32).abs().max().item() / den if den else float("nan")))
        os.remove(dst)

    hr("(D) BOUNDS: submission_template.py dict output has the shape the scorer wants")
    import submission_template as subtpl

    x_small = np.random.RandomState(0).randn(2, 20, 32, 64, 3).astype(np.float32)

    subtpl.RETURN_BOUNDS = False
    default_out = subtpl.predict(x_small)
    assert isinstance(default_out, np.ndarray), (
        "default (RETURN_BOUNDS=False) predict() should return a bare ndarray")
    print("OK: default predict() returns a bare ndarray, shape", tuple(default_out.shape))

    try:
        subtpl.RETURN_BOUNDS = True
        bounds_out = subtpl.predict(x_small)
    finally:
        subtpl.RETURN_BOUNDS = False
    assert isinstance(bounds_out, dict), "RETURN_BOUNDS=True should return a dict"
    assert set(bounds_out) == {"prediction", "lower", "upper"}
    pred, lo, up = bounds_out["prediction"], bounds_out["lower"], bounds_out["upper"]
    assert lo.shape == pred.shape == up.shape
    assert np.all(lo <= pred) and np.all(pred <= up)
    print("OK: RETURN_BOUNDS=True predict() returns prediction+lower+upper, "
          "shapes match, lower <= prediction <= upper everywhere")

    # Check the kit's own return contract, not the evaluator's internals. Real
    # floating-point arrays of one shape are what a submission owes; float32 and
    # float64 are both fine, and the template happens to return float32.
    for name, arr in (("prediction", pred), ("lower", lo), ("upper", up)):
        assert arr.dtype.kind == "f", f"{name} must be a float array, got {arr.dtype}"
        assert np.all(np.isfinite(arr)), f"{name} must be finite everywhere"
    assert set(bounds_out) == {"prediction", "lower", "upper"}, (
        "returning bounds means exactly these three keys, no more")
    assert default_out.dtype.kind == "f"
    print("OK: bounds output is finite float throughout and carries exactly "
          "prediction/lower/upper")

    hr("(E) EVAL-IMAGE PARITY: build + forward with %s blocked"
       % ", ".join(sorted(MISSING_IN_EVAL_IMAGE)))
    blocker = _BlockedTopLevel(MISSING_IN_EVAL_IMAGE)
    # Purge the kit's own modules too, so a module-level import added to
    # load_baseline.py or to the vendored tree is re-executed under the blocker
    # instead of being served from the import cache.
    saved = _purge_modules(["rpde_baselines", "load_baseline", "einops"]
                           + sorted(MISSING_IN_EVAL_IMAGE))
    sys.meta_path.insert(0, blocker)
    try:
        for mod in sorted(MISSING_IN_EVAL_IMAGE):
            try:
                __import__(mod)
                raise AssertionError("the %s blocker is not active" % mod)
            except ModuleNotFoundError:
                pass
        print("blocker active:", ", ".join(
            "`import %s`" % m for m in sorted(MISSING_IN_EVAL_IMAGE)), "rejected")
        import load_baseline as lb_eval   # re-executed under the blocker
        x_eval = torch.randn(1, 20, 32, 64, 3)
        for mt in ("fno", "transolver", "cno"):
            m = lb_eval.build_model(mt)
            with torch.no_grad():
                y = m(x_eval)
            assert tuple(y.shape) == (1, 20, 32, 64, 3)
            print("OK: %-10s builds and forwards under the eval-image package "
                  "set -> %s" % (mt, tuple(y.shape)))
            del m
    finally:
        sys.meta_path.remove(blocker)
        _purge_modules(["rpde_baselines", "load_baseline", "einops"])
        sys.modules.update(saved)

    print("\nALL KIT SMOKE CHECKS COMPLETE")
    if skipped:
        print("SKIPPED (not exercised in this run): %s" % "; ".join(skipped))


if __name__ == "__main__":
    main()
