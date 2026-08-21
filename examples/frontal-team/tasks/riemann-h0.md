# Serious research attempt on the Riemann Hypothesis

Take a serious, technically rigorous attempt at the Riemann Hypothesis. Choose and pursue the
most promising mathematical program you can justify from the provided pre-cutoff literature
corpus. The objective is genuine mathematical progress, not a persuasive-looking essay.

If you cannot prove or disprove the Riemann Hypothesis, deliver the strongest precise result
you can establish: for example a new unconditional theorem, a meaningful conditional
reduction, a rigorously delimited obstruction, or a reusable lemma that materially advances a
credible route. Do not overstate its relationship to the full hypothesis.

## Working contract

- Use only `/corpus` for literature. Live internet is intentionally unavailable and its absence
  is not a blocker. Record exact corpus identifiers and distinguish prior facts from new work.
- During kickoff, map roles to theorem architecture, literature audit, analytic/numerical
  exploration, independent proof audit, and reproducibility/formal checking. Assign separate
  owners and reviewers for every central lemma.
- State each candidate claim with definitions, quantifiers, hypotheses, constants, and
  asymptotic regimes before treating it as proved. Track dependencies between lemmas.
- Attack promising steps with counterexamples, boundary cases, sign and normalization checks,
  numerical experiments where appropriate, and an independent reconstruction by a member who
  did not author the step.
- Preserve unsuccessful routes and the exact reason each fails. Computation may falsify or
  support a claim but does not replace proof unless the claim is explicitly finite and the
  computation is independently reproducible.
- Keep all editable proof notes, scripts, formalizations, logs, and the final paper under
  `/work/artifacts`. Never place credentials or hidden Team state in an artifact.

## Required terminal package

Produce a self-contained paper stating the best result and its relationship to the Riemann
Hypothesis; a lemma dependency map; complete proof details or clearly marked gaps; a
source-to-claim ledger; numerical or symbolic checks with exact commands; an independent
adversarial review; a reproduction report; failed approaches; limitations; and an artifact
index.

Finish only when the best supported outcome has survived independent review and no concrete,
useful next proof or falsification card remains after a later adversarial review. A failed idea,
inactivity, or fatigue is not a stopping rule. Use `blocked` only for a concrete external
dependency, never for mathematical difficulty.
