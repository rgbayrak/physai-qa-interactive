# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "neurokit2==0.3.0",
#   "tqdm",
#   "numpy",
#   "scipy",
#   "pandas",
# ]
# ///
"""Run the chosen peak detector(s) on PPG, ECG and respiratory channels.

Called by scripts/compute-peaks.ts with a manifest (one job per channel); writes
one JSON file per channel (src/data/detected-peaks.ts, DetectedPeaksFile).

    uv run --script scripts/detect_peaks.py <manifest.json> [--detectors id,id] [--all-detectors] [--force]
    uv run --script scripts/detect_peaks.py --list-detectors

By default each channel gets its signal type's default detector only. --detectors
picks others (for their signal types; the other types keep their default), and
--all-detectors runs every detector. Each channel's file holds exactly the
detectors of the run (a plain run: the default only); results already in the
file are reused, not run again, unless --force.

Every detector runs with its library's defaults. Cleaning is paired with each
detector the way the library's own pipeline does it (NeuroKit2 ecg_process /
rsp_process / ppg_process pass the same method name to *_clean and *_peaks when
the cleaner has one). Peaks are sample indices at the file's own rate, from the
first sample. A detector that fails records its error; the others still run.

Kept after a visual comparison on ds006644, ds003192 and movie10 (developer review,
2026-11-17; docs/release-notes.md, Unreleased, developer notes: "Peak detection: choosing a default"):
  PPG: Elgendi 2013 (default), in-house.
  Respiration: Khodadad 2018 (default), Bettermann 1996.
  ECG: NeuroKit (default), Engelse-Zeelenberg (modified).
The other detectors compared are kept, not run, in scripts/archive/detect_peaks_tested.py.

Sources (checked in each library's source, 2026-11-17):
  NeuroKit2 0.3.0 (Makowski et al. 2021): ppg_findpeaks elgendi (Elgendi et al. 2013),
    ecg_findpeaks / ecg_clean neurokit and engzeemod2012 (Engelse & Zeelenberg 1979;
    Lourenco et al. 2012), rsp_findpeaks khodadad2018 (Khodadad et al. 2018) and
    bettermann1996 (Schafer & Kratky 2008), rsp_clean khodadad2018 (2nd-order Butterworth 0.05-3 Hz).
  In-house (the developer's lab MATLAB code): Bayrak et al. 2025.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
import warnings
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from typing import Callable

import numpy as np
import pandas as pd
import scipy.signal


def lib_version(name: str) -> str:
    try:
        return f"{name} {version(name)}"
    except PackageNotFoundError:
        return name


# ── Detectors ────────────────────────────────────────────────


@dataclass
class Detector:
    id: str
    signal: str  # "ppg" | "ecg" | "resp"
    label: str
    library: str
    reference: str
    params: dict
    run: Callable[[np.ndarray, float], np.ndarray]
    default: bool = False


def nk():
    import neurokit2

    return neurokit2


# PPG: NeuroKit2 ppg_clean default (elgendi: Butterworth 0.5-8 Hz) before the NeuroKit2 PPG detector
def ppg_clean(x: np.ndarray, fs: float) -> np.ndarray:
    return np.asarray(nk().ppg_clean(x, sampling_rate=fs, method="elgendi"))


def nk_ppg(method: str) -> Callable[[np.ndarray, float], np.ndarray]:
    return lambda x, fs: np.asarray(nk().ppg_findpeaks(ppg_clean(x, fs), sampling_rate=fs, method=method)["PPG_Peaks"])


def inhouse_ppg(x: np.ndarray, fs: float) -> np.ndarray:
    """The lab's MATLAB code: butter(2, [0.5 4]/(fs/2)); filtfilt; findpeaks with
    MinPeakHeight 0.05*iqr and MinPeakDistance fs/2 samples. MATLAB filtfilt pads
    3*(nfilt-1) samples, so padlen is set to that (scipy's default is one more).
    MATLAB iqr is taken as the 'hazen' percentile (cited from memory, unverified)."""
    b, a = scipy.signal.butter(2, [0.5, 4.0], btype="bandpass", fs=fs)
    y = scipy.signal.filtfilt(b, a, x, padlen=3 * (max(len(a), len(b)) - 1))
    q75, q25 = np.percentile(y, [75, 25], method="hazen")
    peaks, _ = scipy.signal.find_peaks(y, height=0.05 * (q75 - q25), distance=max(1, fs / 2))
    return peaks


# ECG: NeuroKit2 ecg_clean with the detector's own method name (both have one)
def nk_ecg(method: str) -> Callable[[np.ndarray, float], np.ndarray]:
    def run(x: np.ndarray, fs: float) -> np.ndarray:
        clean = nk().ecg_clean(x, sampling_rate=fs, method=method)
        return np.asarray(nk().ecg_findpeaks(clean, sampling_rate=fs, method=method)["ECG_R_Peaks"])

    return run


# Respiration: rsp_clean khodadad2018 (its default; bettermann1996 has no cleaner of its own)
def nk_rsp(method: str) -> Callable[[np.ndarray, float], np.ndarray]:
    def run(x: np.ndarray, fs: float) -> np.ndarray:
        clean = np.asarray(nk().rsp_clean(x, sampling_rate=fs, method="khodadad2018"))
        return np.asarray(nk().rsp_findpeaks(clean, sampling_rate=fs, method=method)["RSP_Peaks"])

    return run


NK = "neurokit2"

DETECTORS: list[Detector] = [
    # PPG
    Detector("neurokit2_elgendi2013", "ppg", "Elgendi 2013 (NeuroKit2)", NK, "Elgendi et al. 2013, PLoS ONE 8(10) e76585",
             {"clean": "ppg_clean elgendi", "peakwindow": 0.111, "beatwindow": 0.667, "beatoffset": 0.02, "mindelay": 0.3},
             nk_ppg("elgendi"), default=True),
    Detector("inhouse_ppg", "ppg", "In-house (lab)", "in-house", "Bayrak et al. 2025",
             {"clean": "Butterworth order 2, 0.5-4 Hz, filtfilt", "min_height": "0.05 x IQR", "min_distance_s": 0.5}, inhouse_ppg),
    # ECG
    Detector("neurokit2_neurokit", "ecg", "NeuroKit (NeuroKit2)", NK, "Makowski et al. 2021 (NeuroKit2)",
             {"clean": "ecg_clean neurokit", "method": "neurokit"}, nk_ecg("neurokit"), default=True),
    Detector("neurokit2_engzeemod2012", "ecg", "Engelse-Zeelenberg (mod.) 2012 (NeuroKit2)", NK,
             "Engelse & Zeelenberg 1979; Lourenco et al. 2012",
             {"clean": "ecg_clean engzeemod2012", "method": "engzeemod2012"}, nk_ecg("engzeemod2012")),
    # Respiration
    Detector("neurokit2_khodadad2018", "resp", "Khodadad 2018 (NeuroKit2)", NK, "Khodadad et al. 2018, Physiol. Meas. 39(9) 094001",
             {"clean": "rsp_clean khodadad2018 (Butterworth 2, 0.05-3 Hz)", "amplitude_min": 0.3}, nk_rsp("khodadad2018"),
             default=True),
    Detector("neurokit2_bettermann1996", "resp", "Bettermann 1996 (NeuroKit2)", NK, "Schafer & Kratky 2008, Ann Biomed Eng 36(3) 476",
             {"clean": "rsp_clean khodadad2018", "method": "bettermann1996"}, nk_rsp("bettermann1996")),
]

assert len({d.id for d in DETECTORS}) == len(DETECTORS), "detector ids must be unique"
assert all(sum(d.default for d in DETECTORS if d.signal == s) == 1 for s in ("ppg", "ecg", "resp")), \
    "each signal type needs exactly one default detector"
KNOWN_IDS = {d.id for d in DETECTORS}


def selected(signal: str, wanted: set[str], run_all: bool) -> list[Detector]:
    """The detectors to have for a signal type: all, the ones asked for, or the default"""
    of_type = [d for d in DETECTORS if d.signal == signal]
    if run_all:
        return of_type
    asked = [d for d in of_type if d.id in wanted]
    return asked or [d for d in of_type if d.default]


# ── Reading the physio file ──────────────────────────────────


def first_field_is_number(path: str) -> bool:
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt") as f:
        first = f.readline().split("\t")[0].strip()
    try:
        float(first)
        return True
    except ValueError:
        return first == "n/a"


def read_columns(path: str, columns: list[int]) -> dict[int, np.ndarray]:
    """Columns of a headerless BIDS physio TSV; a header row, if any, is skipped
    (as parsePhysioTsv in server/bids-layout.ts does); n/a becomes NaN."""
    skip = 0 if first_field_is_number(path) else 1
    df = pd.read_csv(path, sep="\t", header=None, usecols=columns, skiprows=skip, na_values=["n/a"],
                     dtype=float, compression="infer")
    return {c: df[c].to_numpy(dtype=float) for c in columns}


def read_existing(path: str) -> dict | None:
    """The channel's peaks file from an earlier run, or None"""
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data.get("detectors"), list) else None
    except (OSError, ValueError):
        return None


# ── Main ─────────────────────────────────────────────────────


def detect(job: dict, x: np.ndarray, detectors: list[Detector],
           report: Callable[[dict, float], None] | None = None,
           on_start: Callable[[Detector], None] | None = None) -> list[dict]:
    """Run the detectors on the channel; `on_start(detector)` is called before each one
    and `report(entry, seconds)` after it. Returns one entry per detector."""
    fs = float(job["sampling_rate"])
    # Whole-number rates go to the detectors as int: some NeuroKit2 methods use the rate as a count
    fs_arg = int(fs) if fs.is_integer() else fs
    results = []
    has_nan = bool(np.isnan(x).any())
    for d in detectors:
        lib = d.library if d.library == "in-house" else lib_version(d.library)
        entry = {"id": d.id, "label": d.label, "library": lib, "reference": d.reference, "params": d.params,
                 "default": d.default, "peaks": [], "error": None}
        if on_start:
            on_start(d)
        started = time.perf_counter()
        if has_nan:
            entry["error"] = "the channel has n/a samples; detectors need a complete signal"
        else:
            try:
                # Library warnings (deprecations, short segments) would break the progress bar: counted, not printed
                with warnings.catch_warnings(record=True) as caught:
                    warnings.simplefilter("always")
                    p = np.unique(np.asarray(d.run(x, fs_arg), dtype=float))
                entry["warnings"] = len(caught)
                p = p[np.isfinite(p)].astype(int)
                entry["peaks"] = [int(i) for i in p if 0 <= i < len(x)]
            except Exception as e:  # noqa: BLE001 - every failure is recorded, the run goes on
                entry["error"] = f"{type(e).__name__}: {e}"
        if report:
            report(entry, time.perf_counter() - started)
        entry.pop("warnings", None)
        results.append(entry)
    return results


def merged_file(job: dict, previous: dict | None, new_entries: list[dict], chosen: list[Detector]) -> dict:
    """The channel's file: exactly the detectors chosen for this run, in DETECTORS order; earlier
    results of those are reused, new ones replace them. Any other detector's results are dropped
    (a plain run keeps the default only)."""
    keep = {d.id for d in chosen}
    by_id = {e["id"]: e for e in (previous or {}).get("detectors", []) if e.get("id") in keep}
    for e in new_entries:
        by_id[e["id"]] = e
    for e in by_id.values():  # files written before "default" was recorded
        e["default"] = next(d.default for d in DETECTORS if d.id == e["id"])
    return {
        "scan": job["scan"],
        "recording": job["recording"],
        "channel": job["channel"],
        "signal": job["signal"],
        # "name" when the type came from the column name, "override" when from --channel
        "signal_source": job.get("signal_source", "name"),
        "sampling_rate": float(job["sampling_rate"]),
        "physio_file": os.path.basename(job["physio_path"]),
        "detectors": [by_id[d.id] for d in DETECTORS if d.id in by_id],
    }


def write_json(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("manifest", nargs="?")
    ap.add_argument("--detectors", help="comma-separated detector ids (default: each signal type's default)")
    ap.add_argument("--all-detectors", action="store_true", help="run every detector")
    ap.add_argument("--force", action="store_true", help="run detectors again that the channel's file already has")
    ap.add_argument("--list-detectors", action="store_true")
    a = ap.parse_args()

    if a.list_detectors:
        for d in DETECTORS:
            print(f"{d.signal:5} {d.id:28} {d.label}{'  (default)' if d.default else ''}")
        return 0
    if not a.manifest:
        ap.error("manifest is required")

    wanted = {s.strip() for s in (a.detectors or "").split(",") if s.strip()}
    unknown = sorted(wanted - KNOWN_IDS)
    if unknown:
        ap.error(f"unknown detector ids: {', '.join(unknown)} (see --list-detectors)")

    with open(a.manifest) as f:
        jobs = json.load(f)

    from tqdm import tqdm

    labels = {"ppg": "PPG", "ecg": "ECG", "resp": "respiration"}
    in_run = [s for s in labels if any(j["signal"] == s for j in jobs)]
    print("  Detectors: " + "; ".join(
        f"{labels[s]}: {', '.join(d.id for d in selected(s, wanted, a.all_detectors))}" for s in in_run), flush=True)

    # What each channel still needs: the chosen detectors its file does not have yet (all of them with
    # --force). A file that has them all but also others is rewritten with the chosen ones only.
    todo: list[tuple[dict, dict | None, list[Detector], list[Detector]]] = []
    up_to_date = 0
    for job in jobs:
        previous = read_existing(job["out_path"])
        chosen = selected(job["signal"], wanted, a.all_detectors)
        in_file = {e.get("id") for e in (previous or {}).get("detectors", [])}
        have = {e.get("id") for e in (previous or {}).get("detectors", []) if not e.get("error")}
        need = [d for d in chosen if a.force or d.id not in have]
        if need:
            todo.append((job, previous, need, chosen))
        else:
            if in_file - {d.id for d in chosen}:
                write_json(job["out_path"], merged_file(job, previous, [], chosen))
            up_to_date += 1
    if up_to_date:
        print(f"  {up_to_date} channel(s) already have these detectors: not run again (--force runs them again)", flush=True)

    # One read per physio file, for all of its channels
    by_file: dict[str, list[tuple[dict, dict | None, list[Detector], list[Detector]]]] = {}
    for item in todo:
        by_file.setdefault(item[0]["physio_path"], []).append(item)

    failures = unreadable = 0
    bar = tqdm(total=len(todo), unit="channel", desc="Peak detection", dynamic_ncols=True)
    for path, items in by_file.items():
        try:
            data = read_columns(path, sorted({job["column_index"] for job, _, _, _ in items}))
        except Exception as e:  # noqa: BLE001
            tqdm.write(f"  could not read {os.path.basename(path)} ({type(e).__name__}: {e}); "
                       f"{len(items)} channel(s) skipped")
            unreadable += len(items)
            bar.update(len(items))
            continue
        for job, previous, need, chosen in items:
            x = data[job["column_index"]]

            def on_start(d: Detector) -> None:
                # Shown on the progress bar while the detector runs, so a slow one is visible
                bar.set_postfix_str(f"{job['channel']}: running {d.id}")

            entries = detect(job, x, need, on_start=on_start)
            write_json(job["out_path"], merged_file(job, previous, entries, chosen))
            failures += sum(1 for e in entries if e["error"])
            # Only failures get a line; the progress bar shows the rest
            scan = job["scan"].split("/")[-1] + (f"_recording-{job['recording']}" if job["recording"] else "")
            for e in entries:
                if e["error"]:
                    tqdm.write(f"  failed: {scan} {job['channel']} {e['id']} ({e['error'][:100]})")
            bar.update(1)
    bar.close()

    # Nothing to say when all went well; only problems get a closing line
    problems = [f"{unreadable} channel(s) in files that could not be read"] if unreadable else []
    if failures:
        problems.append(f"{failures} detector run(s) failed (listed above, greyed out in the viewer)")
    if problems:
        print("  " + "; ".join(problems), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
