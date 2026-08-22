"""RealPDE Track 1 Sim2Real submission template.

Rename this file to ``submission.py`` before zipping your submission.
"""

from __future__ import annotations

import numpy as np

# Set True to return interval bounds alongside the prediction (see the
# Evaluation page's SPS section). Default is False, so the baseline's score is
# unchanged. The example band below is the same default the scorer already
# falls back to when bounds are omitted, so flipping this on by itself will
# not move your sps_score; it only demonstrates the interface. Replace
# ``half_width`` with your own uncertainty estimate to do better than default.
RETURN_BOUNDS = False


def predict(input_array, metadata=None):
    """Return predicted future flow fields.

    Parameters
    ----------
    input_array : np.ndarray
        Shape ``(N, T_in, H, W, C)`` with channel order ``[u, v, p]``.
    metadata : dict, optional
        An empty dictionary on scored calls. Read shapes from ``input_array``;
        use ``.get()`` with a default for anything else. See the Submission page.

    Returns
    -------
    np.ndarray or dict
        Either a prediction array with shape ``(N, T_out, H, W, C)``, or a
        dictionary with keys ``prediction`` and optional ``lower``/``upper``
        (see ``RETURN_BOUNDS`` above for a runnable example).
    """

    x = np.asarray(input_array, dtype=np.float32)

    # Baseline placeholder: persist the last observed frame over the future
    # horizon. Replace this with your trained Sim2Real model.
    t_out = 20
    last_frame = x[:, -1:, :, :, :]
    prediction = np.repeat(last_frame, repeats=t_out, axis=1)
    prediction[..., 2] = 0.0

    if not RETURN_BOUNDS:
        return prediction

    # Example only: lower/upper must be the same shape as prediction. This
    # particular band (+-0.05*|pred|) reproduces the scorer's own default, so
    # it is here to show the dict shape works end to end, not to raise your
    # score. A real submission should compute lower/upper from an actual
    # uncertainty estimate (ensemble spread, predictive variance, etc.).
    half_width = 0.05 * np.abs(prediction)
    lower = prediction - half_width
    upper = prediction + half_width
    return {"prediction": prediction, "lower": lower, "upper": upper}
