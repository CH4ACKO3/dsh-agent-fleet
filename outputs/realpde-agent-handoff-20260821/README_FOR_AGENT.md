# RealPDE Track 1 agent handoff

Start with `TASK.md`, then read `kit/realpde_t1_starting_kit_v9/README.md` and inspect the evaluator-facing API before editing anything.

This bundle replaces the paths used by the former container as follows:

- `/opt/realpde/kit/realpde_t1_starting_kit_v9` → `kit/realpde_t1_starting_kit_v9`
- `/work` → the writable workspace chosen for the new run
- `/runs` → a writable evidence directory chosen for the new run
- `/data` and `/checkpoints` → not included; mount or download them separately when available

The untouched official archive is retained at `official/realpde_t1_starting_kit_v9.zip`. Its expected SHA-256 is:

`c14b24d0e385d6761be5a29d721a05d2152ccda317ab3c700caad6993febf61c`

The public training data and baseline checkpoints were never embedded in the original image. When acquiring them, preserve the documented `train_sim`, `train_real`, `example_data`, and `baseline_checkpoints` layout, and do not train on `train_real/7575_0.h5` because the organizers identify it as an erroneous duplicate of `6300_0`.

The former container's editable `/work` and previous run outputs are not part of this handoff. Begin a fresh, reproducible run and record commands, configuration, evidence, and artifacts explicitly.
