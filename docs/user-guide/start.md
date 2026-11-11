# Start the tool

Once the tool is installed (see {doc}`../get-started`), point it at a dataset and open it in your browser.

## Dataset

The tool works with any dataset in [BIDS](https://bids.neuroimaging.io) format that has physiological recordings. Either use your own, or download a public one.

**Your own dataset.** It can stay where it is; you give the tool its path in the next step. The dataset should have:

- physiological recordings as `sub-XX/[ses-XX/]func/*_physio.tsv.gz`, each with a JSON sidecar giving `SamplingFrequency`, `StartTime` and `Columns`

## Run the tool

The tool reads from three folders. You set them when you start it:

| Setting | What it points at | When to set it |
|---|---|---|
| `BIDS_ROOT` | The main BIDS folder: the one with `dataset_description.json` | Always. There is no default |
| `BIDSPHYS_ROOT`\* | The folder with the physiological recordings (`*_physio.tsv.gz`) | Only when they are stored outside `BIDS_ROOT` |
| `BIDSDER_ROOT` | The derivatives folder with the head-motion confounds (e.g. fMRIPrep's) | Only when it is outside `BIDS_ROOT/derivatives/` |

{.table-note}
\* Set `BIDSPHYS_ROOT` only when the physiological recordings are not under `BIDS_ROOT`. If they are, leave it out: the tool finds them itself.

When the physiological recordings and derivatives are inside the main BIDS folder, as in most OpenNeuro datasets, the tool finds them itself and `BIDS_ROOT` is all you need:

```bash
BIDS_ROOT=/path/to/dataset npm run dev
```

When they are stored outside of it instead (e.g. CNeuroMod physprep), give all three:

```bash
BIDS_ROOT=/path/to/dataset BIDSPHYS_ROOT=/path/to/physio BIDSDER_ROOT=/path/to/derivatives npm run dev
```

A relative path is read from the project folder, so a dataset in the project's `data/` folder can be given as `data/<dataset>`.

See {doc}`datasets` for how the tool finds the folders inside `BIDS_ROOT`, and what each one is read for.

The terminal prints a welcome banner, the folders the tool reads from and what it found in them, then an address (usually `http://localhost:5173`).

```{figure} ../images/start-terminal-banner.png
:alt: The welcome banner printed by npm run dev: PHYSAI-QA-INTERACTIVE version 0.1.0 (beta), a one-line description, and the links for docs and issues, citation (Zenodo DOI) and license (MIT), and Ctrl+C to stop
:name: fig-terminal-banner

The welcome banner. Below it, the terminal lists the three folders, what it found in them and the address to open.
```

Open the address in a desktop web browser. The tool keeps running in this terminal until you stop it with Ctrl+C.

```{figure} ../images/start-first-page.png
:alt: The Explore and Annotate tab on its first scan of ds006644: dataset title and authors, the Subject, Session, Task and Channel dropdowns, the Auxiliary Signal Options row, the green trigger-verified Timing badge, the respiratory signal with its overview chart, and the framewise displacement chart under Auxiliary
:name: fig-first-page

The page the tool opens on: the **Explore and Annotate** tab with the dataset's first scan.
```

Without `BIDS_ROOT`, or with a folder that does not exist, the server stops and says what to set; see {doc}`troubleshooting`.

To compare signal quality across every scan (the scatter plot, the **Stats** tab and the PDF report), compute the quality metrics once per dataset; see {doc}`quality-metrics`.

## On Windows

Use PowerShell, and set each folder with `$env:` before starting the tool:

```powershell
$env:BIDS_ROOT="C:\path\to\dataset"; npm run dev
```

Set `BIDSPHYS_ROOT` and `BIDSDER_ROOT` the same way when you need them.

## Next steps

- {doc}`explore-and-annotate`: step through scans, zoom, and annotate.
- {doc}`troubleshooting`: if something does not work.
