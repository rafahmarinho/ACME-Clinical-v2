"""Synthetic ECG (lead II) built from a sum of Gaussian P-Q-R-S-T waves."""

import math
import random

# (amplitude mV, offset from R peak in seconds, width in seconds)
_WAVES = (
    (0.12, -0.20, 0.025),  # P
    (-0.10, -0.035, 0.010),  # Q
    (1.10, 0.0, 0.012),  # R
    (-0.22, 0.035, 0.012),  # S
    (0.28, 0.28, 0.045),  # T (offset scaled with RR interval)
)


def ecg_strip(
    hr: float | None,
    *,
    seconds: float = 4.0,
    fs: int = 125,
    rng: random.Random | None = None,
    quality: str = "good",
    phase: float = 0.0,
) -> list[float]:
    """Return `seconds * fs` samples in millivolts.

    quality: "good" | "noisy" | "lead_off" (flat line with small drift)
    """
    rng = rng or random.Random(0)
    n = int(seconds * fs)
    if quality == "lead_off" or not hr or hr <= 0:
        return [round(0.01 * math.sin(i / fs * 0.7) + rng.gauss(0, 0.004), 3) for i in range(n)]

    rr = 60.0 / max(25.0, min(hr, 220.0))
    t_scale = math.sqrt(rr)  # QT shortens at higher rates (Bazett-like)
    noise = 0.012 if quality == "good" else 0.06
    beats = int(seconds / rr) + 3
    # slight beat-to-beat variability
    peaks = []
    t = -rr + phase * rr
    for _ in range(beats):
        peaks.append(t)
        t += rr * (1 + rng.gauss(0, 0.015))

    out: list[float] = []
    for i in range(n):
        ti = i / fs
        v = 0.04 * math.sin(2 * math.pi * 0.25 * ti)  # baseline wander (respiration)
        for pk in peaks:
            dt = ti - pk
            if dt < -0.4 or dt > 0.7:
                continue
            for amp, off, width in _WAVES:
                o = off * t_scale if off > 0.2 else off
                v += amp * math.exp(-((dt - o) ** 2) / (2 * width**2))
        v += rng.gauss(0, noise)
        out.append(round(v, 3))
    return out
