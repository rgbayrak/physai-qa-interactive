# Stats tab

Signal quality metrics are computed once per dataset by a script, and then shown in two places: a scatter plot at the bottom of **Explore and Annotate**, and the **Stats** tab. Both stay hidden until the metrics exist.

## Computing the metrics

Run the script once per dataset, and again after the data or the metrics change:

```bash
# Main BIDS folder is data/<name> in the project folder
npx vite-node scripts/compute-quality-metrics.ts <name>

# Main BIDS folder anywhere else
npx vite-node scripts/compute-quality-metrics.ts <name> --bids-root /path/to/dataset

# Physiological recordings and derivatives stored next to the main BIDS folder (e.g. CNeuroMod): give all three
npx vite-node scripts/compute-quality-metrics.ts <name> --bids-root /path/to/dataset --physio-root /path/to/physio --deriv-root /path/to/derivatives
```

`<name>` names the output folder, `data/quality/<name>/`. Use the name the tool gives the dataset, so the Stats tab finds the metrics: the folder name of `BIDS_ROOT`, or the first folder under `data/` (see {doc}`datasets`).

The script finds its folders the same way as the tool (see {doc}`datasets`): `--bids-root`, `--physio-root` and `--deriv-root` match `BIDS_ROOT`, `BIDSPHYS_ROOT` and `BIDSDER_ROOT`. It prints the three folders it uses before computing. Then reload the page.

Every column of the physio file is computed unless it is specifically excluded: `trigger`, `time` and other scanner, marker and time stamp columns. Known names (e.g. `cardiac`, `PPG`, `ECG`, `respiratory`, `RSP`, `EDA`) get a signal type; other names get `n/a` in `signal_type`. The output is deterministic: the same input gives identical files, except the run log.

## What it writes

In `data/quality/<dataset>/`:

- `quality_metrics.tsv`: one row per scan and physiological channel (`n/a` where a metric does not apply).
- `dataset.json`: the dataset description, scan and subject counts, `participants.tsv` and its descriptions, scans that could not be computed, and excluded channels.
- `waveforms/`: a downsampled waveform per scan, for the plots.
- `quality_runs.tsv`: a log with one line per run (`run_date`, `scans_computed`, `scans_available`, `scans_failed`, `count_source`). `scans_available` counts every physiological recording the dataset lists, downloaded or not. The Stats tab, the PDF report and the On disk data summary show its last line, e.g. "Quality metrics were last computed on 2026-11-05 for 78 of 120 scans (40 not downloaded, 2 failed)".
- `quality_report.pdf`: the PDF report, built by the Stats tab (see below).

## Scatter plot

At the bottom of **Explore and Annotate**. It shows the channel picked in the page's Channel dropdown and names it in its title.

- **Y** is a metric; **X** is a metric or a participant variable such as age or sex. The menus list every metric with values for that channel.
- **Colour by** offers only what the dataset has (task, session, timing check, quality sidecar pass/fail). The colour legend and the number of scans plotted are to the right of the plot.
- The scan you are viewing is the larger pinkish-red point.
- Hover a point for details; **double-click** it to open that scan in the Stats tab.

A channel without metrics (e.g. `trigger`) gets a short message instead of a plot.

```{figure} ../images/quality-metrics-scatter-plot.png
:alt: Scatter plot comparing respiratory recordings, with Y set to SNR, X to handedness and Colour by to Session; points are blue for session 01 and yellow for session 02, the viewed scan is a larger pinkish-red point, and the legend says 79 of 80 scans plotted
:name: fig-scatter-plot

SNR of every respiratory recording against a participant variable (handedness), coloured by session.
```

## Stats tab

One scan at a time, with **Prev / Next**: file name, participant information, recording details, the waveform of each physiological channel, and per channel a table of its metrics with percentiles, followed by where the scan sits in each metric's histogram compared with the group.

```{figure} ../images/quality-metrics-stats-tab.png
:alt: The Stats tab for one scan: participant info, recording details, the trigger-verified Timing badge, the last metrics run and a link to the PDF report on the left; the cardiac and respiratory waveforms over the whole recording, with a dashed scan onset line, on the right
:name: fig-stats-tab

The top of the **Stats** tab: what is known about the scan, and its waveforms over the whole recording.
```

**Metrics shown** lists the metrics under their groups (Basic, Distribution, PaPaGei, PhysioQC). Tick which ones the tables and histograms show, or use Show all / Hide all. The choice is remembered in your browser.

```{figure} ../images/quality-metrics-histograms.png
:alt: Metrics shown box with all 12 metrics ticked under Basic, Distribution, PaPaGei and PhysioQC; next to it, the cardiac metrics table with each value and its percentile, and a histogram per metric with a solid dark line for this scan and a dashed grey line for the mean of all 80 cardiac recordings
:name: fig-metric-histograms

Each metric's value and percentile for this scan, and where it falls in the dataset (solid dark line: this scan; dashed grey line: dataset mean).
```

The scan open in Explore and Annotate is the one Stats opens, and the other way round.

## PDF report

`data/quality/<dataset>/quality_report.pdf` has a summary, each channel's scatter plot, and one page per scan with its waveforms and every metric. Computing the metrics deletes the old report; the next time the Stats tab opens, it builds a new one in the background and saves it there. The Stats sidebar shows its progress, then a link to open it.

```{figure} ../images/quality-metrics-pdf-report.png
:alt: One scan's page in the PDF report: the scan name and file, participant information, sampling rate, duration and timing check, the cardiac and respiratory waveforms over the whole recording with a dashed scan onset line, and a table of every metric for each channel with its percentile
:name: fig-pdf-report

One scan's page in the PDF report: its waveforms and every metric, with each value's percentile in the dataset.
```

What each metric computes, and its source, is described in [REVIEW.md](https://github.com/rgbayrak/physai-qa-interactive/blob/main/REVIEW.md).
