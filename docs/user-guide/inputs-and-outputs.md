# Inputs and outputs

## The three folders

The tool reads from three folders. Only `BIDS_ROOT` is required; the other two are found automatically when they are inside it.

| Setting | Point it at | Read from it |
|---|---|---|
| `BIDS_ROOT` | Always the main BIDS folder (required, no default), even when the physiological recordings are stored elsewhere | `dataset_description.json`, `participants.tsv`, task events, BOLD sidecars |
| `BIDSPHYS_ROOT` | The folder holding the `*_physio.tsv.gz` files, when it is outside `BIDS_ROOT` | Physiological recordings and their sidecars; its copy of a recording is the one loaded |
| `BIDSDER_ROOT` | The derivatives folder with the confounds, when it is outside `BIDS_ROOT/derivatives/` | Confounds, the derivatives' dataset description, BOLD sidecars when `BIDS_ROOT` has none |

When the server starts, it walks `BIDS_ROOT`, with everything inside it (its `derivatives/` too), and then `BIDSPHYS_ROOT` and `BIDSDER_ROOT` when they are set, once each. It reads only file names, skips hidden folders, `sourcedata/` and `code/`, and doesn't follow folder links. Each file is used for what it is, wherever it sits, never by folder name:

- **Physiological recordings:** every `*_physio.tsv.gz` (or plain `*_physio.tsv`) file whose content is downloaded, in any datatype folder (`func/`, `eeg/`, `meg/`, `beh/`, …), for every subject and session that has one. Each one is a scan, named by its datatype folder and entities (e.g. `func/sub-01_ses-01_task-rest_run-01`); physio in `func/` and `eeg/` for the same run gives two scans. A scan split into `recording-<label>` files (e.g. `recording-cardiac` and `recording-respiratory`) loads every recording.
- **Derivatives:** confounds files anywhere in those folders, fMRIPrep's preferred over MRIQC's.
- **When a recording is found twice** (e.g. a raw copy and a physprep copy): the file under `BIDSPHYS_ROOT` when it is set, else the `BIDS_ROOT` dataset's own file over copies in its `derivatives/`; then a `desc-preproc` file, then `.tsv.gz` over `.tsv`. The terminal says which was loaded: `<file> loaded; same recording not loaded: <other>`.

The terminal lists the folders walked, how many readable recordings it found in each datatype folder, and the files it skipped (listed but not downloaded, or found twice).

```bash
BIDS_ROOT=/path/to/dataset npm run dev                                  # everything inside it
BIDS_ROOT=/path/to/dataset BIDSDER_ROOT=/path/to/derivatives npm run dev
```

Folders stored **next to** the main BIDS folder rather than inside it are not searched for: give all three. For example, CNeuroMod datasets keep the main BIDS folder next to `physprep/` and `fmriprep/`:

```bash
BIDS_ROOT=/path/to/dataset BIDSPHYS_ROOT=/path/to/physio BIDSDER_ROOT=/path/to/derivatives npm run dev
```

## What a dataset needs

- A BIDS layout: `sub-XX/[ses-XX/]<datatype>/*[_recording-<label>]_physio.tsv.gz`, in any datatype folder, with or without sessions.
- A JSON sidecar with `SamplingFrequency`, `StartTime` and `Columns`, per file or inherited from a folder above it (BIDS inheritance; a `recording-<label>` sidecar applies to that recording only).
- The TSV can have a header row; it is detected and skipped.
- For confound timing: a BOLD sidecar with `VolumeTiming` or `RepetitionTime` (raw scan-level, top-level `task-<task>_bold.json`, or in the derivatives).
- Run labels are compared as numbers between raw data and derivatives, so `run-01` matches `run-1`.

## Dataset information

Under the dataset name, the page shows its authors, BIDS version, license, DOI link and derivatives pipeline and version, read from the dataset's own `dataset_description.json` files (raw and derivatives). Missing fields are skipped. When `dataset_description.json` is missing, or its `Name` or `Authors` are placeholders, a notice under the name says how to fix it (see {doc}`troubleshooting`).

## On disk data summary

The **On disk data summary** box, under the Annotations box, shows:

- how many physiological recordings the dataset lists and how many are downloaded (counted once when the server starts, with git-annex when available);
- how many the quality metrics cover, from the last line of `quality_runs.tsv`. When they don't cover the whole dataset, it says to download the rest and compute the metrics again;
- the result of the BIDS version check.

```{figure} ../images/datasets-on-disk-summary.png
:alt: On disk data summary box: 119 of 354 physio recordings are downloaded (checked with git-annex) and the other 235 are listed but not fetched yet; quality metrics cover 119 of 354 recordings, with a prompt to download the rest and rerun scripts/compute-quality-metrics.ts; BIDS version 1.0.1 is older than 1.6.0, so file names were not checked
:name: fig-on-disk-summary
:width: 360px

A partly downloaded dataset: what is on disk, what the quality metrics cover, and the BIDS version check.
```

## BIDS version check

When the server starts, it checks the dataset's file and folder names against the rules of the BIDS version in its `dataset_description.json` (`BIDSVersion`), and shows the result in the On disk data summary. The rules come from the official [BIDS schema](https://github.com/bids-standard/bids-schema), one file per version (BIDS 1.6.0 to 1.11.2). Only names are read, so it works before any data is downloaded. It checks:

- the required top-level files (`dataset_description.json`, and `README` and `CHANGES` where that version requires them);
- in every `sub-*/[ses-*/]` folder: the datatype folders, and each file's entities (allowed, required, order, matching `sub-` and `ses-` folders), suffix and extension.

This is not a full BIDS validation: file contents and sidecar fields are not checked. OpenNeuro datasets have already been through the official BIDS validator. A dataset with no `BIDSVersion`, one older than 1.6.0, or one that isn't a BIDS release (for example `0.0.1`, often the dataset's own version) is not checked, and the summary says so.

## Where files are saved

- **Annotations:** `data/annotations/<dataset>/sub-XX/[ses-YY/]<datatype>/`, the physiological recording's own folder, one folder per dataset and one file per scan, recording and channel (`…[_recording-<label>]_channel-<channel>_annotations.json`). Set `ANNOTATIONS_ROOT` to use another folder in place of `data/annotations/`.
- **Detected peaks:** `data/peaks/<dataset>/sub-XX/[ses-YY/]<datatype>/`, laid out as the annotations (see [Detected peaks](explore-and-annotate.md#detected-peaks)). Set `PEAKS_ROOT` to use another folder in place of `data/peaks/`.
- **Quality metrics:** `data/quality/<name>/`, where `<name>` is the first folder under `data/` (e.g. `BIDS_ROOT=data/friends/friends` → `friends`). For a dataset outside `data/`, it is the folder name of `BIDS_ROOT`, or set `DATASET_NAME` (useful when the main BIDS folder has a generic name such as `data`).
