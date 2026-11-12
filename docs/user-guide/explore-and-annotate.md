# Tab: Explore and Annotate

The **Explore and Annotate** tab shows one scan at a time: its physiological signals, auxiliary charts on the same time axis, and the Annotations box where you rate and mark the recording.

```{figure} ../images/explore-annotate-overview.png
:alt: Explore and Annotate with a respiratory recording: Prev and Next buttons and search, the file name with a trigger-verified Timing badge, the focus and overview charts, framewise displacement under Auxiliary, and on the right the Annotations box (12 of 80 respiratory signals annotated) and the On disk data summary
:name: fig-explore-overview

The signal charts on the left; the Annotations box and the On disk data summary on the right.
```

## Moving between scans

- **Dropdowns:** Subject, Session, Task and Run (when the dataset has them), and Channel, the signal shown in the main charts.
- **Prev / Next** buttons, or the ← and → keys, step through scans in subject, session, task and run order.
- **Search:** type e.g. `sub-03` or `ses-012` to jump to a scan.
- The page shows the exact `.tsv.gz` file being viewed.

**Where it opens.** On the earliest scan with nothing annotated yet for the remembered channel, so a skipped scan always comes back. Once every scan is annotated, it opens on the last-viewed scan. A link from the Stats tab opens that scan instead. The **Go to the first unannotated scan** button, under the annotation progress bar, opens that earliest scan at any time.

**What is remembered.** The channel and stacked channels stay the same when you step through scans. A reload keeps the channel, stacked channels, events column and confound; they are saved per dataset in your browser.

## Signal charts

- **Focus chart** (top): drag to select a time window, which zooms in when you release; double-click to zoom out. The Y-axis fits the visible data. Hover for the value under the pointer.
- **Context chart** (bottom): shows the whole recording. Drag the window to move along it, or drag its edges to change its length. The window length is shown over it.

```{figure} ../images/zoom-scroll.gif
:alt: Hovering over the cardiac signal shows the time and value under the pointer; dragging on the focus chart zooms into a time window, and dragging the window on the context chart moves along the recording
:name: fig-zoom-scroll

Hover readout, brush to zoom and drag the context window.
```

All charts share one time axis: **t = 0 is scan onset**, the start of the first BOLD volume. A dashed purple **scan onset (t = 0)** line marks it. Physiological data recorded before the scan (negative times) is out of view.

## Auxiliary Signal Options

The **Auxiliary Signal Options** row adds charts under AUXILIARY, below the signal of interest. They all follow the focus chart's time window.

- **Event:** for task scans (not rest) with a BIDS `*_events.tsv`. Each event is a block from its onset to onset + duration. A column with at most 10 categories (by default `trial_type`, else `condition` or similar) gets one coloured lane per category with a colour key. Any other column draws every event in one grey lane, with its value in the tooltip. Counters such as `trial_number` are not offered, and the figure is hidden when every column has the same value throughout.
- **Confound:** a head-motion confound from fMRIPrep or MRIQC, shown only when confounds exist for the scan. Framewise displacement is colour-coded by severity (green, amber, red) with 0.2 mm and 0.5 mm reference lines.
- **Stack:** tick channels to add a compact figure for each. Each fits its own Y-axis and has its own hover readout.

```{figure} ../images/explore-annotate-events.png
:alt: A task scan (task cuedSGT) with the respiratory signal on top and, under Auxiliary, the events chart for its events.tsv: the Condition column gives five coloured lanes (Other, Past, Control, Null, Future) with a colour key, each event a block from its onset to onset plus duration
:name: fig-events

The **Event** chart for a task scan: one coloured lane per value of the `Condition` column.
```

```{figure} ../images/explore-annotate-stack.png
:alt: An EDA recording as the signal of interest, with RSP ticked under Stack so it appears as a compact figure under Auxiliary, and framewise displacement below it; next to the file name, the sidecar-only Timing badge and quality badges PPG Fail (50%), ECG Pass, RSP Pass and EDA Pass
:name: fig-stack

A stacked channel (RSP) and a confound under the signal of interest (EDA), all on the same time axis. Next to the file name: the Timing badge and the per-channel quality badges.
```

Channel and Stack offer every column of the physio file except those specifically excluded, the same ones the quality metrics leave out: `trigger`, `time` and other scanner, marker and time stamp columns.

**Peaks (trial).** A trial feature, not final. When the physiological recordings folder has an events file with detected peaks (e.g. physprep's `r_peak` and `systolic_peak`, and their `_corrected` versions), a **Peaks** toggle next to Channel draws them on the signal: blue for detected, green rings for corrected.

## Timing badge

The **Timing** badge, next to the file name, shows whether the physiological recording's timing could be checked against the scanner. Hover over it for the details.

The physiological sidecar's `StartTime` is the reference: it is the time of the first sample relative to the first volume, so it is often negative. If the recording has a `trigger` channel, the tool detects its pulses and checks them against the BOLD timing. Triggers are a cross-check, not the reference, because dummy scans, dropped pulses or recording delays can make the first pulse differ from the first volume.

| Badge | Condition | What the viewer does |
|---|---|---|
| trigger-verified (green) | Every pulse interval is within 5% of TR, the pulse count equals the volume count, and the first pulse lands at t = 0 (within 5% of TR) | Uses `StartTime` as it is |
| corrected from triggers (amber) | Pulses are clean (spacing and count match) but the first pulse is off from t = 0 | Shifts the physiological axis so the first pulse is at t = 0 |
| triggers disagree (red) | Some intervals differ from TR, or the pulse count doesn't match the volume count | Uses `StartTime` as it is, and flags the scan for review |
| sidecar only (amber) | No trigger channel or pulses, or no BOLD TR to check against | Uses `StartTime` as it is, unverified |

**How the other charts are timed.**

- **Confounds** have one row per volume. Volume *i* sits at `VolumeTiming[i]`, or at *i* × `RepetitionTime`, read from the BOLD sidecars. If no sidecar has timing, volumes are spread evenly across the recording; that is only approximate. For multi-echo runs, the lowest echo is used.
- **Events** are read from the main BIDS folder, following BIDS inheritance (the run's own file, else the run-less file, else a top-level `task-<task>_events.tsv`). Their onsets are already in seconds from the first volume, so they are drawn as they are.

**Quality badges.** When a `_desc-quality.json` sidecar is present (per run, or run-less), per-channel pass/fail badges appear next to the timing badge (see {ref}`the stacked channel figure <fig-stack>`).

## Downsampling badge

Recordings sampled at 2000 Hz or more are downsampled to about 1000 Hz, by a whole-number factor: 10 000 Hz becomes 1000 Hz, 2500 Hz becomes 1250 Hz. A grey **Downsampled** badge, the first one next to the file name, shows the original and new rates; hover over it for the details. Recordings under 2000 Hz are shown as they are, with no badge.

- **No aliasing.** Each channel is low-pass filtered at 0.8 × the new Nyquist frequency (400 Hz at 1000 Hz) before samples are dropped, so nothing above the new Nyquist frequency folds back into the signal.
- **No time shift.** The filter is symmetric, so peaks stay where they were, and the kept samples sit exactly on the original time grid.
- **Trigger channel.** It is not filtered: each kept sample takes the highest value of its block, so short pulses still show. The timing check runs on the original, full-rate data.
- **Signal quality metrics** are computed from the downsampled data, in the viewer and in `quality_metrics.tsv`, whose `sampling_frequency` column gives the new rate.

## Annotations

The **Annotations** box has two parts:

- **Full Recording:** rate the whole recording's **Signal Quality** (Good, Bad, Fixable, Unknown) and write **Notes**.
- **Time Windows:** switch **Annotate** On, then drag on the focus chart to mark a time window and give it a label. Delete a window with its ×. Labels cannot be edited; to change one, delete the window and draw it again.

```{figure} ../images/eval-ml-annot.gif
:alt: A respiratory recording rated Good under Signal Quality in the Annotations box, then the Next button steps to the next scan and the annotated count goes up
:name: fig-rate-and-step

Rating a recording's signal quality and stepping to the next scan.
```

```{figure} ../images/explore-annotate-time-window.png
:alt: A time window from 330.38 s to 360.71 s labelled motion, shaded on the zoomed-in focus chart, with Annotate On and the window listed under Time Windows; the framewise displacement chart below peaks in the same window
:name: fig-time-window

A time window labelled "motion" over a head-motion peak. It is listed under **Time Windows**, where × deletes it.
```

Everything is saved to disk automatically, one file per scan and channel, and reloads when you return to that scan. Each time window is stored with both its times and its sample indices, so the file can be used as an artifact mask. See {doc}`datasets` for where the files go.

Under the box, the annotated count and progress bar show how many scans of this channel have annotations.

## Scatter plot

Once the quality metrics are computed, a scatter plot appears at the bottom of the tab. See {doc}`quality-metrics`.
