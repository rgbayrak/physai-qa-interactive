# Explore and Annotate

The **Explore and Annotate** tab shows one scan at a time: its physiological signals, auxiliary charts on the same time axis, and the Annotations box where you rate and mark the recording.

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

All charts share one time axis: **t = 0 is scan onset**, the start of the first BOLD volume. A dashed purple **scan onset (t = 0)** line marks it. Physiological data recorded before the scan (negative times) is out of view.

## Auxiliary Signal Options

The **Auxiliary Signal Options** row adds charts under AUXILIARY, below the signal of interest. They all follow the focus chart's time window.

- **Event:** for task scans (not rest) with a BIDS `*_events.tsv`. Each event is a block from its onset to onset + duration. A column with at most 10 categories (by default `trial_type`, else `condition` or similar) gets one coloured lane per category with a colour key. Any other column draws every event in one grey lane, with its value in the tooltip. Counters such as `trial_number` are not offered, and the figure is hidden when every column has the same value throughout.
- **Confound:** a head-motion confound from fMRIPrep or MRIQC, shown only when confounds exist for the scan. Framewise displacement is colour-coded by severity (green, amber, red) with 0.2 mm and 0.5 mm reference lines.
- **Stack:** tick channels to add a compact figure for each. Each fits its own Y-axis and has its own hover readout.

Channel and Stack only offer physiological channels, matched against the same list of names as the quality metrics, so `trigger` is left out.

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

**Quality badges.** When a `_desc-quality.json` sidecar is present (per run, or run-less), per-channel pass/fail badges appear next to the timing badge.

## Annotations

The **Annotations** box has two parts:

- **Full Recording:** rate the whole recording's **Signal Quality** (Good, Bad, Fixable, Unknown) and write **Notes**.
- **Time Windows:** switch **Annotate** On, then drag on the focus chart to mark a time window and give it a label. Delete a window with its ×. Labels cannot be edited; to change one, delete the window and draw it again.

Everything is saved to disk automatically, one file per scan and channel, and reloads when you return to that scan. Each time window is stored with both its times and its sample indices, so the file can be used as an artifact mask. See {doc}`datasets` for where the files go.

Under the box, the annotated count and progress bar show how many scans of this channel have annotations.

## Scatter plot

Once the quality metrics are computed, a scatter plot appears at the bottom of the tab. See {doc}`quality-metrics`.
