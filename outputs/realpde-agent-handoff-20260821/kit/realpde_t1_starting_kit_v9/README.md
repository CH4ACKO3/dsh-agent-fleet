# RealPDE Track 1 (Sim2Real) Starting Kit v9

Everything you need to load the official CNO / FNO / Transolver baselines, run
them, shrink an FNO checkpoint under the 256 MB submission cap, and package a
Track 1 submission. The model code is vendored, so the kit imports and runs
offline without the original RealPDEBench repo.

## Contents

```
realpde_t1_starting_kit_v9/
├── README.md
├── submission_template.py     # Track 1 predict() API; rename to submission.py
├── submission_example_fno.py  # worked example: the organizers' FNO baseline submission
├── load_baseline.py           # load CNO/FNO/Transolver checkpoints + forward
├── pack_ckpt_fp16.py          # shrink an fp32 checkpoint to fp16 (complex-safe)
├── smoke_test_kit.py          # self-check: clean-room import + load + forward
├── scoring.py                 # computes the five leaderboard subscores locally
├── _vendor/
│   └── einops/                # vendored einops (Transolver needs rearrange)
└── rpde_baselines/            # vendored model subtree (import this, offline)
    ├── model/
    │   ├── model.py           # base Model (load_checkpoint, train_loss)
    │   ├── fno.py             # FNO3d + SpectralConv3d (complex spectral weights)
    │   ├── cno.py             # CNO3d
    │   ├── load_model.py      # model factory used by load_baseline.py
    │   ├── CNO_libs/          # CNO anti-aliased filter ops (StyleGAN-derived)
    │   └── TRANSOLVER_libs/   # Transolver blocks + Physics-Attention
    └── utils/metrics.py       # mse_loss (trimmed; no matplotlib dependency)
```

The vendored package is named `rpde_baselines` (not `realpdebench`) on purpose,
so it never shadows the evaluator's own `realpdebench` inside the offline
scoring container.

## Dependencies

The Track 1 evaluation container runs `pytorch/pytorch:2.2.2-cuda12.1-cudnn8-runtime`.
Past `torch` and `numpy` it carries no scientific-Python stack: **`scipy`, `h5py`,
`einops`, `matplotlib` and `pandas` are all absent** (verified by importing them
inside the image). All three baselines still import, build and run there:

* `einops` (needed by the Transolver forward) ships in `_vendor/einops/`.
  `load_baseline.py` prepends `_vendor/` to `sys.path`, so the bundled copy
  resolves ahead of any system einops.
* `scipy` is **not** required. It is imported lazily inside
  `design_lowpass_filter()`, which is reached only by the filtered-LReLU CNO
  variant (`activation='lrelu'`); the released CNO checkpoints use
  `activation='LeakyReLU'`.
* `h5py` is used only by `make_example_input()` to read the example trajectory
  on your own machine. Do not import it from `submission.py`: it is not
  installed in the evaluation container.
* matplotlib and pandas are not required.

Anything else your submission imports must either exist in that base image or be
vendored inside your zip. `smoke_test_kit.py` checks that for the kit itself and
is the fastest way to check it for your own code too (see Self-check).

## Checkpoints (download from Google Drive; not shipped in this kit)

GD folder: `baseline_checkpoints/`
(id `1Cg23DoTuSvWXR3Mm1uRfmMNAbkyaIhrQ`)

```
baseline_checkpoints/
├── sim_pretrain/          # sim-only pretraining
│   ├── sim_cno.pth
│   ├── sim_fno.pth
│   ├── sim_fno_fp16.pth   # fp16-packed FNO (fits the 256 MB cap)
│   └── sim_transolver.pth
└── sim_real_ft/           # fine-tuned on real PIV data (use these for Track 1)
    ├── sim_real_cno.pth
    ├── sim_real_fno.pth
    ├── sim_real_fno_fp16.pth
    └── sim_real_transolver.pth
```

Sizes: CNO 32 MB, Transolver 50 MB, FNO 403 MB (fp32) / 201 MB (fp16-packed).
Only FNO needs fp16 packing to fit under the 256 MB submission cap.

## Example data (in Google Drive, not in this kit)

`example_data/3750_0.h5`. One airfoil PIV trajectory with top-level datasets
`u`, `v` of shape `(T=868, 64, 128)` (float64), plus scalars `aoa`, `re` and
grids `x`, `y`. Note the layout difference: this example stores `u`/`v` at the
top level, whereas the training tarballs store them under `measured_data/u`,
`measured_data/v`.

## Data / model geometry

* Channels: `[u, v, p]`; `p = 0` for real data.
* `T_in = T_out = 20`.
* **Eval resolution is `32 x 64`, not `64 x 128`.** The raw PIV fields are
  `64 x 128`, but the Track 1 evaluation downsamples them by 2x (for efficiency,
  per the competition pages), so scoring runs at `32 x 64`. Feed your model
  `32 x 64` inputs. The example file on Google Drive is stored at the raw
  `64 x 128`, so subsample it by 2 before use (`make_example_input(..., sub_s=2)`).
* The baselines are resolution-flexible, so `load_baseline` also runs at
  `64 x 128` if needed (FNO uses fixed Fourier modes; Transolver's `H*W*D` only
  has to equal `T_in*H_s*W_s`, and the loader derives those from the input
  shape). This flexibility is a convenience; the scored resolution is `32 x 64`.

## Model hyper-parameters (read from the checkpoints, not the yaml)

Derived from the `state_dict` shapes. The repo yaml configs are unreliable:
`configs/foil/trainsolver.yaml` says `n_layers: 1` but the checkpoints have
**3** Transolver blocks.

| model | key hyper-parameters |
|-------|----------------------|
| FNO   | modes = (4, 12, 16), width = 64, n_layers = 4, C_in = C_out = 3 |
| CNO   | N_layers = 3, channel_multiplier = 32, C_in = C_out = 3 |
| Transolver | n_layers = 3, n_hidden = 256, n_head = 8, slice_num = 16, space_dim = 3, fun_dim = 0, out_dim = 3 |

## Load a baseline and run a forward pass

```python
from load_baseline import load_baseline, make_example_input

model, meta = load_baseline("sim_real_fno.pth")   # type auto-detected by name
x = make_example_input("3750_0.h5", sub_s=2)       # (1, 20, 32, 64, 3)
y = model(x)                                        # (1, 20, 32, 64, 3)
```

Both checkpoint formats are handled automatically: training checkpoints
(`model_state_dict` + loss metadata) and fp16-packed checkpoints
(`state_fp16` + `complex_keys`).

## fp16 packing (only needed for FNO)

```bash
python pack_ckpt_fp16.py sim_real_fno.pth sim_real_fno_fp16.pth
# 403 MB -> 201 MB, round-trip max relative error ~5e-4
```

The script is complex-safe: FNO spectral weights are `complex64`, and it stores
them as `view_as_real(t).half()` with a `complex_keys` list. To load an
fp16-packed file into a model, use `load_baseline.unpack_fp16(path)` (or the
`unpack_fp16` snippet in the pack script's docstring); do not use the plain
`Model.load_checkpoint`, because packing drops the training metadata.

## Build a Track 1 submission

`submission_template.py` implements the Track 1 API:

```python
def predict(input_array, metadata=None):
    # input_array: (N, T_in, H, W, C) with channels [u, v, p]
    # returns:     (N, T_out, H, W, C)
```

The template ships a persistence baseline (repeat the last frame). To submit a
trained baseline instead, load it with `load_baseline`, convert the numpy input
to a torch tensor, run the forward pass, and convert back to numpy. Rename the
file to `submission.py` before zipping.

### Worked example: the organizers' FNO baseline

`submission_example_fno.py` is the exact submission the organizers ran on the
Main Development leaderboard. Use it as the reference for the whole round trip,
in particular the GaussianNormalizer statistics, which a wrapped baseline needs
to score sensibly. Its header documents the zip layout: `submission.py`, the
checkpoint, `load_baseline.py`, `rpde_baselines/` and `_vendor/` all sit at the
root of the archive.

## Scoring

`scoring.py` computes the same five subscores the leaderboard computes, so you can
check them locally. Put your submission's `predictions.npz` in an input directory
and a reference `targets.npz` under `<input_dir>/ref/`, then:

```bash
python scoring.py <input_dir> <output_dir>
# writes scores.json (the five subscores) and
# detailed_results.html into <output_dir>
```

The leaderboard combines them into a single `final_score`; that combination is
not published.

`predictions.npz` must contain `prediction` of shape `(N, 20, 32, 64, 3)`, plus
optionally `lower`/`upper` interval bounds and `mean_t_neural_s`. The five metrics
(Rel-L2, TKE, MVPE, Time, SPS) are defined on the Evaluation page.

### Optional: interval bounds for SPS

`predict()` may return a dict with `prediction` plus `lower`/`upper` bounds, same
shape as `prediction`. `submission_template.py` ships a runnable example behind a
`RETURN_BOUNDS` flag (default off, so the baseline's score does not change).

If you omit `lower`/`upper`, the scorer falls back to a default band
`lower = pred - 0.05*|pred|`, `upper = pred + 0.05*|pred|` (width `0.1*|pred|`).
Supplied bounds must be finite and satisfy `lower <= upper` everywhere, or the
submission scores zero on every subscore, not just SPS. Bounds whose shape does
not match the prediction fail the run outright.

**Bounds are all-or-nothing across the whole run.** `predict` may be called more
than once, and every call must make the same choice. If some calls return bounds
and others do not, all of them are discarded and every window is scored on the
default band.

`sps_score` rewards predictions that are accurate and paired with tight,
well-calibrated intervals: for an element whose target falls inside
`[lower, upper]`, a narrower interval scores higher, and an element whose target
falls outside the interval contributes 0. See the Evaluation page for the exact
formula.

## Self-check

```bash
cd /tmp && PYTHONPATH=/path/to/realpde_t1_starting_kit_v9 \
    python /path/to/realpde_t1_starting_kit_v9/smoke_test_kit.py
```

Set `CKPT_DIR` and `EXAMPLE_H5` to where you downloaded the checkpoints and the
example file. The smoke test confirms the kit imports without the original repo,
loads all baselines, runs forward passes at both resolutions, and builds and runs
each baseline with `scipy`, `h5py`, `matplotlib` and `pandas` blocked, which is
the package set of the evaluation image.

The checkpoint-dependent sections are skipped when `CKPT_DIR` / `EXAMPLE_H5` are
absent, so the same command also runs inside the evaluation image itself:

```bash
docker run --rm -v /path/to/realpde_t1_starting_kit_v9:/kit:ro \
    --entrypoint python pytorch/pytorch:2.2.2-cuda12.1-cudnn8-runtime \
    /kit/smoke_test_kit.py
```

That is the cheapest way to find out whether your own submission's imports exist
in the evaluation container before you spend a submission on it.
