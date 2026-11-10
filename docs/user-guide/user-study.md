# physAI-QA-interactive: user study task sheet

**Duration:** after the software setup (steps 1-4 below), the session takes about 50 minutes.

| Part | Content | 
|---|---|
| Intro | Consent, About you | 
| A | Load a dataset and start the pipeline | 
| B | Explore and annotate (scenario) | 
| C | Stats tab | 
| D | Questionnaires | 
| E | Open questions | 

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
  - physiological recordings as `sub-XX/[ses-XX/]func/*_physio.tsv.gz`, each with a JSON sidecar giving `SamplingFrequency`, `StartTime` and `Columns`;
  - optionally fMRIPrep derivatives (`*_desc-confounds_timeseries.tsv`) to show head-motion confounds, by default in a folder inside `derivatives/` in the dataset.

  The dataset can stay where it is: give the tool its path (step 4). If the physio or the derivatives are stored next to the main BIDS folder rather than inside it (e.g. CNeuroMod), give all three folders (steps 3 and 4).

- **Option 2: Download an OpenNeuro dataset with physiological recordings (e.g. ds006644) with DataLad.** Install DataLad by following the instructions for your operating system at https://www.datalad.org/#install. DataLad first downloads only the file list and links to the annexed data; `datalad get` then fetches just the files the tool needs:

  ```bash
  datalad install -s https://github.com/OpenNeuroDatasets/ds006644.git data/ds006644
  cd data/ds006644
  datalad get sub-*/ses-*/func/*_physio.*
  datalad get derivatives/fmriprep/sub-*/ses-*/func/*_desc-confounds_timeseries.*
  cd ../..
  ```

**3. Optional: compute the quality metrics first.** If you want the dataset-wide quality metrics to visualize (the scatter plot in Explore and Annotate, the Stats tab and the PDF report), run the script once for the dataset before starting the tool:

```bash
npx vite-node scripts/compute-quality-metrics.ts mydata --bids-root /path/to/bids --deriv-root /path/to/derivatives/fmriprep
npx vite-node scripts/compute-quality-metrics.ts friends --bids-root data/friends/friends --physio-root data/friends/physprep --deriv-root data/friends/fmriprep   # physio and derivatives next to the main BIDS folder
```

It writes `data/quality/<name>/`. Without it, the tool still works for exploring and annotating; the scatter plot and the Stats tab only appear once the metrics exist. *In the study session, skip this step: task 2 runs it.*

**4. Start the tool:**

```bash
BIDS_ROOT=data/ds006644 npm run dev                                # the study dataset
BIDS_ROOT=data/mydata npm run dev                                  # another dataset under data/
BIDS_ROOT=/path/to/bids BIDSDER_ROOT=/path/to/derivatives/fmriprep npm run dev   # a dataset outside data/
BIDS_ROOT=data/friends/friends BIDSPHYS_ROOT=data/friends/physprep BIDSDER_ROOT=data/friends/fmriprep npm run dev   # physio and derivatives next to the main BIDS folder
```

These commands are for the macOS and Linux terminal. On Windows, use PowerShell and set each folder with `$env:` first, e.g. `$env:BIDS_ROOT="data/ds006644"; npm run dev` (add `$env:BIDSPHYS_ROOT="…";` and `$env:BIDSDER_ROOT="…";` the same way).

`BIDS_ROOT` is always the path to the main BIDS folder (the one with `dataset_description.json`), even when the physio is stored elsewhere. `BIDSPHYS_ROOT` is the folder with the physio files and `BIDSDER_ROOT` the derivatives (fMRIPrep) folder; both are found automatically when they are inside `BIDS_ROOT`, and must be given when they are not. The tool keeps running in this terminal until you stop it with Ctrl+C. Open the address it prints (usually `http://localhost:5173`) in a desktop web browser. For a dataset outside `data/`, compute its metrics (step 3) with `--bids-root` and `--deriv-root`, and give the script the name of the `BIDS_ROOT` folder (e.g. `/path/to/mydata` → `mydata`), so the tool finds them. More options are in the README, under *Using your own dataset*.

**During the session.** Explore the tool freely for 5 minutes. Then do each task and rate how easy it was in the **Ease** column. Say out loud anything that confuses you.

**Ease scale (1-7):** *Overall, how difficult or easy was this task?*
1 = very difficult, 4 = neither, 7 = very easy.

## Consent

*Facilitator: add your institution's approved consent text and signature line here before printing.*

## About you

| Question | Answer |
|---|---|
| Role (e.g. PhD student, postdoc, research engineer, PI) | |
| Years working with physiological recordings (cardiac, respiratory) | |
| Years working with fMRI or BIDS data | |
| Tools you currently use to check physiological data quality | |

## Part A: Load a dataset and start the pipeline

| # | Do this | Ease 1-7 | Comments |
|---|---|---|---|
| 1 | In the browser, find which dataset the tool is showing and how many scans it found. | | | |
| 2 | Open a second terminal in the project folder (the first one is running the tool) and run `npx vite-node scripts/compute-quality-metrics.ts ds006644` to compute the dataset's quality metrics. Leave it running and continue with Part B. | | | |

## Part B: Explore and annotate

On the **Explore and Annotate** tab.

**Scenario.** You are checking the physiological recordings in this dataset before analysis. Work the way you normally would, and think aloud as you go.

| # | Do this | Ease 1-7 | Comments |
|---|---|---|---|
| 3 | **Browse.** Move through the scans, subject by subject, until you find one that has potential artifacts. Write down which scan it is: \_\_\_\_\_\_\_\_\_\_ | | | |
| 4 | **Inspect.** Look at that scan in detail. Zoom in, zoom out and scroll as needed until you can say what is wrong with it, and where. | | | |
| 5 | **Compare.** Check whether the problem is head motion (confound: framewise displacement or rot_x) for the same scan. How long is the time window with the issue? | | | |
| 6 | **Assess.** Is this scan's timing trustworthy? Does what you know about it support what you saw? | | | |
| 7 | **Annotate.** Rate the whole recording's signal quality and write a short note on why. Then mark the problem's time window with a label a colleague would understand. Replace that label with a more specific one. | | | |
| 8 | **Check.** Make sure your work was saved, and find where it is stored. How many scans of this channel are annotated so far? Reload the page: which scan does it open on, and why? | | | |
| 9 | **Known case.** Open **sub-18, session 02**. Is anything wrong with this scan's timing? How can you tell? | | | |

## Part C: Scatter plot and Stats tab

Check that the script from task 2 has finished, then reload the page: the scatter plot and the **Stats** tab appear once the metrics exist.

| # | Do this | Ease 1-7 | Comments |
|---|---|---|---|
| 10 | Find the quality-metric TSV the script wrote. What does one row represent? | | | |
| 11 | At the bottom of **Explore and Annotate**, find the scatter plot. How many scans does it plot for the channel you are viewing? Does that match task 1? Which point is the scan you are viewing? | | | |
| 12 | Show **cardiac**, then set **Y = Beat Corr** and **X = SNR**. Hover over the point that looks most unusual and write down its subject and session: \_\_\_\_\_\_\_\_\_\_ | | | |
| 13 | Set **X** to a participant variable (e.g. **age** or **sex**), and change what the points are colored by. What do the colors mean? Then set X back to **SNR**. | | | |
| 14 | **Double-click** the point from task 12. Where did it take you, and is it the scan you picked? | | | |
| 15 | On the **Stats** tab for that scan, look at the waveforms. Does the signal look clean? Where does the scan sit in the histograms compared with the group (solid dark line = this scan, dashed grey line = group mean)? Hide a metric, then show it again. | | | |
| 16 | Open the PDF report for this dataset and find the page for the scan from task 12. Where is the file saved? | | | |

## Part D: Questionnaires

### D1. Ease of use (short questionnaire, adapted from the System Usability Scale)

Rate each statement: 1 = strongly disagree, 5 = strongly agree.

| # | Statement | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| 1 | I think that I would like to use this tool frequently. | | | | | |
| 2 | I found the tool unnecessarily complex. | | | | | |
| 3 | I found the various functions in this tool were well integrated. | | | | | |
| 4 | I thought there was too much inconsistency in this tool. | | | | | |
| 5 | I would imagine that most people would learn to use this tool very quickly. | | | | | |

### D2. Usefulness (Perceived Usefulness)

Think about checking the quality of physiological data in your own research.
Rate each statement: 1 = strongly disagree, 4 = neither, 7 = strongly agree.

| # | Using this tool in my work would... | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| 1 | ...let me check issues in my data more quickly. | | | | | | | |
| 2 | ...improve my quality assessment. | | | | | | | |
| 3 | ...make my quality assessment more effective. | | | | | | | |
| 4 | ...make it easier to check data quality. | | | | | | | |
| 5 | Overall, I would find this tool useful in my work. | | | | | | | |

### D3. Usefulness of each feature

1 = not useful, 3 = moderately useful, 5 = very useful. Tick N/A if you did not use it.

| Feature | 1 | 2 | 3 | 4 | 5 | N/A |
|---|---|---|---|---|---|---|
| Dataset-wide quality metrics | | | | | | |
| Signal viewer (zoom, overview window and its length, stacked channels) | | | | | | |
| Head-motion confounds next to the signals | | | | | | |
| Timing badge (trigger verification) | | | | | | |
| Signal quality rating and notes for the whole recording | | | | | | |
| Time-window annotation | | | | | | |
| Annotated count, progress bar and opening on the earliest unannotated scan | | | | | | |
| Scatter plot (viewed scan highlighted, color legend) | | | | | | |
| Stats tab (waveforms, metric tables, group histograms, Metrics shown) | | | | | | |
| PDF report (saved with the metrics) | | | | | | |

## Part E: Open questions

**What was the most useful feature?**

**What was missing or got in your way?**