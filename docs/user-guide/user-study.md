# >> USER STUDY << 

**Duration:** after the software setup (steps 1-5 below), the session takes about 30 minutes.

```{contents} On this page
:local:
:depth: 1
```

## Getting the data and starting the tool

Run these in a terminal; after getting the project, run them in the project folder. The tool works with any dataset in [BIDS](https://bids.neuroimaging.io) format.

**1. Install** (once).

- **Node.js.** Install Node.js 22 (LTS) from https://nodejs.org/en/download, which has an installer for each operating system; npm comes with it. Check that it worked: `node --version` prints `v22…` and `npm --version` prints a version number.
- **The project.** Download it with Git (skip this if the facilitator has set it up for you):

  ```bash
  git clone https://github.com/rgbayrak/physai-qa-interactive.git
  cd physai-qa-interactive
  ```

- **The tool's packages.** In the project folder, run `npm install`.

**2. Choose a dataset.**

- **Option 1: Use your own BIDS-compliant dataset.** Any dataset in BIDS format works, as long as it has:
  - physiological recordings as `sub-XX/[ses-XX/]<datatype>/*_physio.tsv.gz` (any datatype folder, e.g. `func/`), each with a JSON sidecar giving `SamplingFrequency`, `StartTime` and `Columns`;
  - optionally fMRIPrep derivatives (`*_desc-confounds_timeseries.tsv`) to show head-motion confounds, by default in a folder inside `derivatives/` in the dataset.

  The dataset can stay where it is: give the tool its path (step 5). If the physio or the derivatives are stored next to the main BIDS folder rather than inside it (e.g. CNeuroMod), give all three folders (steps 3 to 5).

- **Option 2: Download an OpenNeuro dataset with physiological recordings (e.g. ds006644) with DataLad.** Install DataLad by following the instructions for your operating system at https://www.datalad.org/#install. DataLad first downloads only the file list and links to the annexed data; `datalad get` then fetches just the files the tool needs:

  ```bash
  datalad install -s https://github.com/OpenNeuroDatasets/ds006644.git data/ds006644
  cd data/ds006644
  datalad get sub-*/ses-*/func/*_physio.*
  datalad get derivatives/fmriprep/sub-*/ses-*/func/*_desc-confounds_timeseries.*
  cd ../..
  ```

**3. Optional: detect peaks first.** If you want detected peaks on the focus chart (the **Show peaks** box in the **BUILT-IN PEAK DETECTION** row), run the script once for the dataset before starting the tool. It needs [uv](https://docs.astral.sh/uv/), which installs the Python libraries on the first run:

```bash
npx vite-node scripts/compute-peaks.ts dataset --bids-root /path/to/dataset
npx vite-node scripts/compute-peaks.ts friends --bids-root data/friends/friends --physio-root data/friends/physprep   # physio next to the main BIDS folder
```

It writes `data/peaks/<name>/`, with the default detector of each signal type (PPG, ECG, respiration). Without it, the tool still works; the BUILT-IN PEAK DETECTION row only appears for channels that have peaks. `--max-scans <N>` works as in step 4. Other detectors and `--channel` are in [Detected peaks](explore-and-annotate.md#detected-peaks).

**4. Optional: compute the quality metrics first.** If you want the dataset-wide quality metrics to visualize (the scatter plot in Explore and Annotate, the Stats tab and the PDF report), run the script once for the dataset before starting the tool:

```bash
npx vite-node scripts/compute-quality-metrics.ts dataset --bids-root /path/to/dataset --deriv-root /path/to/derivatives
npx vite-node scripts/compute-quality-metrics.ts friends --bids-root data/friends/friends --physio-root data/friends/physprep --deriv-root data/friends/fmriprep   # physio and derivatives next to the main BIDS folder
```

It writes `data/quality/<name>/`. Without it, the tool still works for exploring and annotating; the scatter plot and the Stats tab only appear once the metrics exist. *For the study session, run steps 3 and 4 before the session, so every feature on the sheet is there.*

To try it quickly, or when the full dataset takes too long, add `--max-scans <N>` to compute only the first N scans, in the order Prev and Next step through them (subject, session, task, run). For example, `--max-scans 10` computes the first 10 scans, starting with sub-01:

```bash
npx vite-node scripts/compute-quality-metrics.ts ds006644 --max-scans 10
```

A subset run replaces the results of the last run, like a full one. The Stats tab and the On disk data summary say the metrics cover a subset (e.g. "10 of 80 physio recordings, a subset: the first 10 scans"), and the scatter plot and histograms compare only those scans. Run the script again without `--max-scans` for the whole dataset.

**5. Start the tool:**

```bash
BIDS_ROOT=data/ds006644 npm run dev                                # the study dataset
BIDS_ROOT=data/mydata npm run dev                                  # another dataset under data/
BIDS_ROOT=/path/to/dataset BIDSDER_ROOT=/path/to/derivatives npm run dev   # a dataset outside data/
BIDS_ROOT=data/friends/friends BIDSPHYS_ROOT=data/friends/physprep BIDSDER_ROOT=data/friends/fmriprep npm run dev   # physio and derivatives next to the main BIDS folder
```

These commands are for the macOS and Linux terminal. On Windows, use PowerShell and set each folder with `$env:` first, e.g. `$env:BIDS_ROOT="data/ds006644"; npm run dev` (add `$env:BIDSPHYS_ROOT="…";` and `$env:BIDSDER_ROOT="…";` the same way).

`BIDS_ROOT` is always the path to the main BIDS folder (the one with `dataset_description.json`), even when the physio is stored elsewhere. `BIDSPHYS_ROOT` is the folder with the physio files and `BIDSDER_ROOT` the derivatives (fMRIPrep) folder; both are found automatically when they are inside `BIDS_ROOT`, and must be given when they are not. The tool keeps running in this terminal until you stop it with Ctrl+C. Open the address it prints (usually `http://localhost:5173`) in a desktop web browser. For a dataset outside `data/`, compute its peaks and metrics (steps 3 and 4) with `--bids-root` (and `--deriv-root` for the metrics), and give each script the name of the `BIDS_ROOT` folder (e.g. `/path/to/dataset` → `dataset`), so the tool finds them. More options are in {doc}`inputs-and-outputs`.

**During the session.** Explore the tool freely, the way you would check a dataset before analysis, and say out loud anything that confuses you. Then fill in the sheet below.

## About you

Role (e.g. PhD student, postdoc, research engineer, PI): \_\_\_\_\_\_\_\_\_\_

Years working with physiological recordings: \_\_\_\_\_\_\_\_\_\_

## Features

For each feature: did you try it (Y/N), and if so, how useful is it? 1 = not useful, 3 = moderately useful, 5 = very useful.

| # | Feature | Tried? Y/N | Useful 1-5 | Comments |
|---|---|---|---|---|
| 1 | Browsing scans (Prev/Next, search, scan controls and locks) | | | |
| 2 | Signal viewer (zoom, overview window, stacked channels) | | | |
| 3 | Head-motion confounds and task events next to the signal | | | |
| 4 | Timing badge (trigger verification) | | | |
| 5 | Detected peaks (Show peaks) | | | |
| 6 | Signal quality rating and notes for the whole recording | | | |
| 7 | Time-window annotation | | | |
| 8 | Annotated count, progress bar and Go to the first unannotated scan | | | |
| 9 | Scatter plot of quality metrics | | | |
| 10 | Stats tab and PDF report | | | |

## Open questions

**What was the most useful feature?**

**What was missing or got in your way?**