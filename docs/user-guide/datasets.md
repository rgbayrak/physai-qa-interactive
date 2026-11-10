# Datasets

## The three folders

The tool reads from three folders. Only `BIDS_ROOT` is required; the other two are found automatically when they are inside it.

| Setting | Point it at | Read from it |
|---|---|---|
| `BIDS_ROOT` | Always the main BIDS folder (required, no default), even when the physiological recordings are stored elsewhere | `dataset_description.json`, `participants.tsv`, task events, BOLD sidecars |
| `BIDSPHYS_ROOT` | The folder holding the `*_physio.tsv.gz` files, when it is outside `BIDS_ROOT` | Physiological recordings and their sidecars; subjects, sessions, tasks and runs are discovered here |
| `BIDSDER_ROOT` | The derivatives folder with the confounds, when it is outside `BIDS_ROOT/derivatives/` | Confounds, the derivatives' dataset description, BOLD sidecars when `BIDS_ROOT` has none |

When `BIDSPHYS_ROOT` and `BIDSDER_ROOT` are not set, the tool looks for them inside `BIDS_ROOT` by their files, never by folder name:

- **Physiological recordings:** the main folder when it has `sub-*/[ses-*/]func/*_physio.tsv.gz` files; otherwise the first folder inside it, or inside its `derivatives/`, that has them.
- **Derivatives:** the folder inside `derivatives/` with confounds files, preferring fMRIPrep's over MRIQC's.

The terminal prints the three folders and how each was chosen. When more than one folder matches, it names the others, so you can pick one with the setting.

```bash
BIDS_ROOT=/path/to/your/dataset npm run dev                                  # everything inside it
BIDS_ROOT=/path/to/your/dataset BIDSDER_ROOT=/path/to/derivatives npm run dev
```

Folders stored **next to** the main BIDS folder rather than inside it are not searched for: give all three. For example, CNeuroMod `friends` keeps the main BIDS folder next to `physprep/` and `fmriprep/`:

```bash
BIDS_ROOT=data/friends/friends BIDSPHYS_ROOT=data/friends/physprep BIDSDER_ROOT=data/friends/fmriprep npm run dev
```

## What a dataset needs

- A standard BIDS layout: `sub-XX/ses-XX/func/*_physio.tsv.gz`, or session-less `sub-XX/func/*_physio.tsv.gz`.
- A JSON sidecar with `SamplingFrequency`, `StartTime` and `Columns`, per file or at the top level.
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

## BIDS version check

When the server starts, it checks the dataset's file and folder names against the rules of the BIDS version in its `dataset_description.json` (`BIDSVersion`), and shows the result in the On disk data summary. The rules come from the official [BIDS schema](https://github.com/bids-standard/bids-schema), one file per version (BIDS 1.6.0 to 1.11.2). Only names are read, so it works before any data is downloaded. It checks:

- the required top-level files (`dataset_description.json`, and `README` and `CHANGES` where that version requires them);
- in every `sub-*/[ses-*/]` folder: the datatype folders, and each file's entities (allowed, required, order, matching `sub-` and `ses-` folders), suffix and extension.

This is not a full BIDS validation: file contents and sidecar fields are not checked. OpenNeuro datasets have already been through the official BIDS validator. A dataset with no `BIDSVersion`, one older than 1.6.0, or one that isn't a BIDS release (for example `0.0.1`, often the dataset's own version) is not checked, and the summary says so.

## Where files are saved

- **Annotations:** `data/annotations/<dataset>/sub-XX/[ses-YY/]func/`, one folder per dataset. Set `ANNOTATIONS_ROOT` to use another folder in place of `data/annotations/`.
- **Quality metrics:** `data/quality/<name>/`, where `<name>` is the first folder under `data/` (e.g. `BIDS_ROOT=data/friends/friends` → `friends`). For a dataset outside `data/`, it is the folder name of `BIDS_ROOT`, or set `DATASET_NAME` (useful when the main BIDS folder has a generic name such as `data`).
