# Start the tool

Once the tool is installed (see {doc}`../get-started`), follow these three steps to point it at a dataset and open it in your browser.

## Step 1: Choose a dataset

The tool works with any dataset in [BIDS](https://bids.neuroimaging.io) format that has physiological recordings. 

**The dataset.** The dataset should have:

- physiological recordings as `sub-XX/[ses-XX/]<datatype>/*_physio.tsv.gz`, in any datatype folder (`func/`, `eeg/`, `beh/`, …), each with a JSON sidecar giving `SamplingFrequency`, `StartTime` and `Columns`

No dataset of your own? See {doc}`public-datasets` for OpenNeuro datasets with physiological recordings and how to download them with DataLad.

## Step 2: Start the tool

The tool reads from up to three folders. You set them when you start it:

| Setting | When to set it |
|---|---|
| `BIDS_ROOT` | Always (required): the main BIDS folder, the one with `dataset_description.json`. Physiological recordings and derivatives inside it are found automatically. |
| `BIDSPHYS_ROOT` | If the physiological recordings are outside `BIDS_ROOT` |
| `BIDSDER_ROOT` | If the derivatives folder is outside `BIDS_ROOT` |

When the physiological recordings and derivatives are inside the main BIDS folder, as in most OpenNeuro datasets, the tool finds them itself and `BIDS_ROOT` is all you need:

```bash
BIDS_ROOT=/path/to/dataset npm run dev
```

When they are stored outside of it instead (e.g. CNeuroMod physprep), give all three:

```bash
BIDS_ROOT=/path/to/dataset BIDSPHYS_ROOT=/path/to/physio BIDSDER_ROOT=/path/to/derivatives npm run dev
```

See {doc}`inputs-and-outputs` for how the tool finds the folders inside `BIDS_ROOT`, and what each one is read for.

The terminal prints a welcome banner, the folders the tool reads from and what it found in them, then an address (usually `http://localhost:5173`). The banner:

```text
  ────────────────────────────────────────────────────────────────────
   PHYSAI-QA-INTERACTIVE                          version 2.0.0-beta.1
   Interactive visualization and annotation of physiological
   recordings in BIDS-compliant datasets. Part of the physAI suite.

   Docs and issues  https://github.com/rgbayrak/physai-qa-interactive
   Cite             https://doi.org/10.5281/zenodo.19389716
   License          MIT
   Stop             Ctrl+C
  ────────────────────────────────────────────────────────────────────
```

Below it, the terminal lists the folders you set, the folders it walked, and how many readable physiological recordings it found in each datatype folder, followed by the address to open the tool in your browser. If no physiological recordings were found, a message will tell you which folder setting to fix.

Without `BIDS_ROOT`, or with a folder that does not exist, the server stops and says what to set; see {doc}`troubleshooting`.

### On Windows

Use PowerShell, and set each folder with `$env:` before starting the tool:

```powershell
$env:BIDS_ROOT="C:\path\to\dataset"; npm run dev
```

Set `BIDSPHYS_ROOT` and `BIDSDER_ROOT` the same way when you need them.

## Step 3: Open the tool in your browser

Open the address in a desktop web browser. The tool keeps running in the terminal until you stop it with Ctrl+C.

```{figure} ../images/start-first-page.png
:alt: The Explore and Annotate tab on its first scan of ds006644 (sub-01, ses-01, task rest, cardiac): dataset title and authors, the CURRENT INQUIRY row with Subject, Task, Datatype, Session and Channel, the BUILT-IN PEAK DETECTION and AUXILIARY SIGNAL OPTIONS rows, Prev, Next and search, the green trigger-verified Timing badge, the cardiac signal with its overview chart, and the framewise displacement chart under Auxiliary
:name: fig-first-page

The page the tool opens on: the **Explore and Annotate** tab with the dataset's first scan.
```

## Optional: compute the quality metrics

To compare signal quality across every scan (the scatter plot, the **Stats** tab and the PDF report), compute the quality metrics once per dataset; see {doc}`quality-metrics`.

## Next steps

- {doc}`explore-and-annotate`: step through scans, zoom, and annotate.
- {doc}`troubleshooting`: if something does not work.
