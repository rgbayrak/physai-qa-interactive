# Quality metrics and the Stats tab

Signal quality metrics are computed once per dataset by a script, and then shown in two places: a scatter plot at the bottom of **Explore and Annotate**, and the **Stats** tab. Both stay hidden until the metrics exist.

## Computing the metrics

Run the script once per dataset, and again after the data or the metrics change:

```bash
npx vite-node scripts/compute-quality-metrics.ts <dataset>      # main BIDS folder is data/<dataset>, e.g. ds006644
npx vite-node scripts/compute-quality-metrics.ts mydata --bids-root /path/to/bids --deriv-root /path/to/derivatives/fmriprep
# physiological recordings and derivatives next to the main BIDS folder (e.g. CNeuroMod friends): give all three
npx vite-node scripts/compute-quality-metrics.ts friends --bids-root data/friends/friends --physio-root data/friends/physprep --deriv-root data/friends/fmriprep
```

The script finds its folders the same way as the tool (see {doc}`datasets`): `--bids-root`, `--physio-root` and `--deriv-root` match `BIDS_ROOT`, `BIDSPHYS_ROOT` and `BIDSDER_ROOT`. It prints the three folders it uses before computing. Then reload the page.

Only physiological channels are computed. Column names are checked against a list (e.g. `cardiac`, `PPG`, `ECG`, `respiratory`, `RSP`, `EDA`); `trigger` and unknown columns are skipped. The output is deterministic: the same input gives identical files, except the run log.

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

## Stats tab

One scan at a time, with **Prev / Next**: file name, participant information, recording details, the waveform of each physiological channel, and per channel a table of its metrics with percentiles, followed by where the scan sits in each metric's histogram compared with the group.

**Metrics shown** lists the metrics under their groups (Basic, Distribution, PaPaGei, PhysioQC). Tick which ones the tables and histograms show, or use Show all / Hide all. The choice is remembered in your browser.

The scan open in Explore and Annotate is the one Stats opens, and the other way round.

## PDF report

`data/quality/<dataset>/quality_report.pdf` has a summary, each channel's scatter plot, and one page per scan with its waveforms and every metric. Computing the metrics deletes the old report; the next time the Stats tab opens, it builds a new one in the background and saves it there. The Stats sidebar shows its progress, then a link to open it.

What each metric computes, and its source, is described in [REVIEW.md](https://github.com/rgbayrak/physai-qa-interactive/blob/main/REVIEW.md).
