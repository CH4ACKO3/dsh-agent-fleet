# RealPDE Track 1 research objective

Develop the strongest reproducible Track 1 (simulation-to-real transfer) submission supported by the available evidence, and continue hypothesis-driven improvement until the agreed stopping rule says that no useful next trial is warranted.

The immutable official starting kit is at `/opt/realpde/kit/realpde_t1_starting_kit_v9`. Read its README and evaluator-facing API before changing anything. The working tree is `/work`; store every editable source file there. Official data, when provided, is mounted read-only at `/data`, and baseline checkpoints, when provided, are mounted read-only at `/checkpoints`. Store durable run evidence and the final artifact under the run directory printed by the launcher in `/runs`.

Only the competition's released `train_sim` and `train_real` trajectories may contribute training samples. Standard on-the-fly augmentation of those samples is allowed, but external or self-generated data and models pretrained on other data are not. Exclude `train_real/7575_0.h5`: the organizers report that it duplicates `6300_0` rather than containing the stated case.

Required outcome:

- Establish a runnable baseline and a documented development/held-out evaluation contract before broad optimization.
- Keep evaluator-driven search free of leakage: use development evidence to choose trials and independent held-out evidence to admit a candidate.
- Treat each material trial as a falsifiable, bounded hypothesis; retain exact commands, configurations, seeds, logs, negative results, timing, and GPU/resource measurements.
- Use the eight GPUs where measured parallel work benefits, without making uncontrolled multi-change comparisons.
- Produce a Codabench-ready `submission.zip` whose root layout and `predict()` contract match the starting kit. The archive must be at most 256 MB and must run using only packages available in `pytorch/pytorch:2.2.2-cuda12.1-cudnn8-runtime` plus code vendored in the archive.
- Independently reproduce the selected candidate and report the baseline, best held-out result, explored directions, remaining limitations, and artifact paths.

Do not claim an improvement without a reproducible score comparison. Do not modify an evaluator, use private evaluation targets, upload restricted data, or treat missing data/checkpoints as a passing smoke test. If essential benchmark inputs are unavailable after checking the documented mounts, conclude with an approved `blocked` vote that names the missing resource and the exact work that remains. Otherwise conclude only through an approved `finish` vote when the best artifact and independent evidence are inspectable.
