# Get started

This page takes you from nothing installed to a dataset open in your browser. Commands are for the macOS and Linux terminal; see [On Windows](#on-windows) for the differences.

## 1. Install

**Node.js.** Install Node.js 22 (LTS) from <https://nodejs.org/en/download>, which has an installer for each operating system; npm comes with it. Check that it worked:

```bash
node --version   # prints v22…
npm --version    # prints a version number
```

**The project.** Download it with Git and install its packages:

```bash
git clone https://github.com/rgbayrak/physai-qa-interactive.git
cd physai-qa-interactive
npm install
```

Run all later commands in this project folder.

## 2. Get a dataset

The tool works with any dataset in [BIDS](https://bids.neuroimaging.io) format that has physiological recordings. Either use your own, or download a public one.

**Your own dataset.** It can stay where it is; you give the tool its path in the next step. It needs:

- physiological recordings as `sub-XX/[ses-XX/]func/*_physio.tsv.gz`, each with a JSON sidecar giving `SamplingFrequency`, `StartTime` and `Columns`;
- optionally, fMRIPrep derivatives (`*_desc-confounds_timeseries.tsv`) to show head-motion confounds, by default in a folder inside `derivatives/` in the dataset.

See {doc}`user-guide/datasets` for datasets whose physiological recordings or derivatives are stored next to the main BIDS folder rather than inside it.

**A public dataset.** [DataLad](https://www.datalad.org/#install) downloads only the file list at first; `datalad get` then fetches just the files the tool needs. For example, OpenNeuro ds006644 (DMT-HAR-MED):

```bash
datalad install -s https://github.com/OpenNeuroDatasets/ds006644.git data/ds006644
cd data/ds006644
datalad get sub-*/ses-*/func/*_physio.*
datalad get derivatives/fmriprep/sub-*/ses-*/func/*_desc-confounds_timeseries.*
cd ../..
```

## 3. Start the tool

Point `BIDS_ROOT` at the main BIDS folder (the one with `dataset_description.json`) and start the server:

```bash
BIDS_ROOT=data/ds006644 npm run dev
```

The terminal prints a welcome banner, the folders the tool reads from and what it found in them, then an address (usually `http://localhost:5173`). Open it in a desktop web browser. The tool keeps running in this terminal until you stop it with Ctrl+C.

There is no default dataset: without `BIDS_ROOT`, the server stops and says what to set.

## 4. Optional: compute the quality metrics

Exploring and annotating work straight away. To compare signal quality across every scan (the scatter plot, the **Stats** tab and the PDF report), compute the metrics once per dataset. In a second terminal, in the project folder:

```bash
npx vite-node scripts/compute-quality-metrics.ts ds006644
```

Then reload the page. See {doc}`user-guide/quality-metrics` for what it computes and writes.

## On Windows

Use PowerShell, and set each folder with `$env:` before starting the tool:

```powershell
$env:BIDS_ROOT="data/ds006644"; npm run dev
```

Set `BIDSPHYS_ROOT` and `BIDSDER_ROOT` the same way when you need them.

## Next steps

- {doc}`user-guide/explore-and-annotate`: step through scans, zoom, and annotate.
- {doc}`user-guide/troubleshooting`: if something does not work.
