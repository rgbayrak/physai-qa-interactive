"""ARCHIVE: peak detectors that were tested and not included (not imported or run).

These ran in scripts/detect_peaks.py during the visual comparison of 2026-11-17
(ds006644, ds003192, movie10) and were taken out after the developer's visual inspection; see
docs/release-notes.md, Unreleased, developer notes: "Peak detection: detectors tested and not included".
The code is kept so a detector can be brought back as it was: copy its function
and Detector entry into scripts/detect_peaks.py (and its dependency, pinned
below, into that script's inline dependencies).

Dependencies these needed (versions as run):
    heartpy==1.2.7      HeartPy
    wfdb==4.3.1         XQRS
    PyWavelets          NeuroKit2 kalidas2017
    ts2vg               NeuroKit2 emrich2023
    peakdet==0.6.1      peakdet (failed on ds006644; see below)

Uses Detector, nk, ppg_clean, nk_ecg-style helpers as defined in detect_peaks.py.
"""

# ruff: noqa
# fmt: off
import math

import numpy as np

# ── PPG ──────────────────────────────────────────────────────

# NeuroKit2 ppg_findpeaks(method="charlton"): MSPTDfast v2 (Charlton et al. 2025, Physiol. Meas. 46 035002).
# Cleaning: ppg_clean elgendi. Needs the rate as int (TypeError on 100.0).
#   Detector("neurokit2_charlton2025", "ppg", "MSPTDfast, Charlton 2025 (NeuroKit2)", NK, "Charlton et al. 2025, Physiol. Meas. 46 035002",
#            {"clean": "ppg_clean elgendi", "method": "charlton"}, nk_ppg("charlton")),

# NeuroKit2 ppg_findpeaks(method="bishop"): the original MSPTD (Bishop & Ercole 2018). Removed earlier:
# works on the whole signal at once; did not finish on an 8.4 min, 496 Hz PPG (ds006644).
#   Detector("neurokit2_bishop2018", "ppg", "MSPTD, Bishop 2018 (NeuroKit2)", NK, "Bishop & Ercole 2018",
#            {"clean": "ppg_clean elgendi", "method": "bishop"}, nk_ppg("bishop")),


def heartpy_peaks(x: np.ndarray, fs: float) -> np.ndarray:
    """HeartPy 1.2.7 process() with its defaults (van Gent et al. 2019, JORS 7(1) 32)."""
    import heartpy

    wd, _ = heartpy.process(x, sample_rate=fs)
    # Accepted peaks only: binary_peaklist marks the ones HeartPy rejects with 0
    return np.asarray([p for p, ok in zip(wd["peaklist"], wd["binary_peaklist"]) if ok == 1], dtype=int)
#   Detector("heartpy", "ppg", "HeartPy", "heartpy", "van Gent et al. 2019, JORS 7(1) 32",
#            {"clean": "none (process on the raw signal)", "windowsize": 0.75, "bpmmin": 40, "bpmmax": 180}, heartpy_peaks),


def app_find_peaks(x: np.ndarray, min_distance: int) -> np.ndarray:
    """Port of findPeaks() from src/data/sqi-metrics.ts (before 2026-11-17): local maxima
    (x[i] > x[i-1] and x[i] >= x[i+1]); a peak closer than min_distance to the last kept
    one replaces it when higher. Ad hoc: no published source. Identical to the TS version
    on a test signal (145 peaks, 2026-11-17)."""
    peaks: list[int] = []
    for i in range(1, len(x) - 1):
        if x[i] > x[i - 1] and x[i] >= x[i + 1]:
            if not peaks or i - peaks[-1] >= min_distance:
                peaks.append(i)
            elif x[i] > x[peaks[-1]]:
                peaks[-1] = i
    return np.asarray(peaks, dtype=int)
#   Detector("app_ppg", "ppg", "App findPeaks (0.3 s)", "app", "Ad hoc (no published source)",
#            {"clean": "none (raw)", "min_distance_s": 0.3}, lambda x, fs: app_find_peaks(x, max(1, math.floor(0.3 * fs)))),


def peakdet_peaks(clean: np.ndarray, fs: float) -> np.ndarray:
    """peakdet 0.6.1 peakfind_physio(data, thresh=0.2, dist=None) (DuPre et al. 2024,
    Zenodo 10.5281/zenodo.13359249, the v0.5.1 DOI). Failed on ds006644 (496 Hz, 8.4 min):
    "ValueError: setting an array element with a sequence." for PPG and respiration; ran on
    simulated 60 s, 100 Hz signals. Cause not found."""
    import peakdet

    return np.asarray(peakdet.operations.peakfind_physio(peakdet.Physio(clean, fs=fs)).peaks, dtype=int)
#   PPG: peakdet_peaks(ppg_clean(x, fs), fs); ECG: on ecg_clean neurokit; respiration: on rsp_clean khodadad2018.

# ── ECG ──────────────────────────────────────────────────────
# NeuroKit2 ecg_findpeaks methods, each with ecg_clean of the same name when ecg_clean has it,
# else ecg_clean neurokit. Built as:
#   Detector(f"neurokit2_{m}", "ecg", f"{label} (NeuroKit2)", NK, ref,
#            {"clean": f"ecg_clean {m if m in ECG_CLEAN_METHODS else 'neurokit'}", "method": m}, nk_ecg(m))
ECG_CLEAN_METHODS = {
    "neurokit", "pantompkins1985", "hamilton2002", "elgendi2010", "engzeemod2012",
    "christov2004", "zong2003", "kalidas2017", "emrich2023", "gamboa2008", "elgendi2013",
}
ECG_TESTED = [
    ("pantompkins1985", "Pan-Tompkins 1985", "Pan & Tompkins 1985, IEEE TBME 32(3) 230"),
    ("hamilton2002", "Hamilton 2002", "Hamilton 2002, E.P. Limited"),
    ("christov2004", "Christov 2004", "Christov 2004, BioMed Eng OnLine 3:28"),
    ("elgendi2010", "Elgendi 2010", "Elgendi et al. 2010, BIOSIGNALS"),
    ("kalidas2017", "Kalidas 2017 (SWT)", "Kalidas & Tamil 2017, IEEE BIBE"),
    ("zong2003", "Zong 2003 (WQRS)", "Zong et al. 2003, Computers in Cardiology"),
    ("khamis2016", "Khamis 2016 (UNSW)", "Khamis et al. 2016, IEEE TBME 63(7) 1377"),
    ("nabian2018", "Nabian 2018", "Nabian et al. 2018, IEEE JTEHM 6"),
    ("emrich2023", "Emrich 2023 (visibility graph)", "Emrich et al. 2023, EUSIPCO"),
    # id neurokit2_elgendi2013_ecg: the PPG Elgendi 2013 has neurokit2_elgendi2013
    ("elgendi2013", "Elgendi 2013 (ECG)", "Elgendi 2013, PLoS ONE 8(9) e73557"),
    ("rodrigues2021", "Rodrigues 2021 (adaptive steepness)", "Gutierrez-Rivas et al. 2015; Sadhukhan & Mitra 2012"),
    ("gamboa2008", "Gamboa 2008", "Gamboa 2008, PhD thesis, Universidade Tecnica de Lisboa"),
]


def xqrs_peaks(x: np.ndarray, fs: float) -> np.ndarray:
    """wfdb 4.3.1 processing.xqrs_detect, defaults, raw signal (the docs cite no paper)."""
    import wfdb.processing

    return np.asarray(wfdb.processing.xqrs_detect(sig=x, fs=fs, verbose=False), dtype=int)
#   Detector("wfdb_xqrs", "ecg", "XQRS (wfdb)", "wfdb", "wfdb-python (the docs cite no paper)",
#            {"clean": "none (raw)", "conf": "XQRS.Conf defaults"}, xqrs_peaks),
#   Detector("app_ecg", "ecg", "App findPeaks (0.3 s)", "app", "Ad hoc (no published source)",
#            {"clean": "none (raw)", "min_distance_s": 0.3}, lambda x, fs: app_find_peaks(x, max(1, math.floor(0.3 * fs)))),

# ── Respiration ──────────────────────────────────────────────
# NeuroKit2 rsp_findpeaks, rsp_clean of the same name when it has one (biosppy), else khodadad2018:
#   Detector("neurokit2_scipy", "resp", "scipy find_peaks (NeuroKit2)", NK, "Makowski et al. 2021 (NeuroKit2)",
#            {"clean": "rsp_clean khodadad2018", "peak_distance_s": 0.8, "peak_prominence": 0.5}, nk_rsp("scipy")),
#   Detector("neurokit2_biosppy", "resp", "BioSPPy (NeuroKit2)", NK, "BioSPPy (no reference in the code)",
#            {"clean": "rsp_clean biosppy", "method": "biosppy"}, nk_rsp("biosppy")),  # with rsp_clean biosppy
#   Detector("app_resp", "resp", "App findPeaks (1.5 s)", "app", "Ad hoc (no published source)",
#            {"clean": "none (raw)", "min_distance_s": 1.5}, lambda x, fs: app_find_peaks(x, max(1, math.floor(1.5 * fs)))),
