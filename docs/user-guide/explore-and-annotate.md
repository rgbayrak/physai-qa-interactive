# Tab: Explore and Annotate

The **Explore and Annotate** tab shows one scan at a time: its physiological signals, auxiliary charts on the same time axis, and the Annotations box where you rate and mark the recording.

```{figure} ../images/explore-annotate-overview.png
:alt: Explore and Annotate on a respiratory recording of ds006644: the CURRENT INQUIRY row with Subject and Session dropdowns and their padlocks, Task and Datatype shown as text, and Channel; the BUILT-IN PEAK DETECTION row with Show peaks ticked; the AUXILIARY SIGNAL OPTIONS row with framewise displacement and cardiac stacked; Prev, Next and search; the trigger-verified Timing badge; the focus chart zoomed in with red peak dots and a time window labelled signal drop out; the stacked cardiac and framewise displacement charts under Auxiliary; and on the right the Annotations box (Fixable selected, 2 of 80 respiratory signals annotated, the time window listed) and the On disk data summary
:name: fig-explore-overview

The scan controls and option rows at the top, the signal charts on the left, and the Annotations box and On disk data summary on the right.
```

## Moving between scans

- **Scan controls** (in the CURRENT INQUIRY row): one control per entity the dataset's scans have, in the order Subject, Task, Datatype, Session, then the others by their BIDS key (e.g. `acq`) and Run. A level the dataset has several values for is a dropdown listing all of them; a level with one value for the shown scan is shown as text. Picking a value that exists only in another session opens that session.
- **Locks:** the padlock next to a level keeps its value fixed, e.g. lock Task on `rest` to step through rest scans only. Prev / Next, search, the annotated count and **Go to the first unannotated scan** then stay within the locked values. Run has no lock.
- **Channel:** the signal shown in the main charts.
- **Prev / Next** buttons, or the ← and → keys, step through scans in subject, session, task and run order, then datatype and the other entities.
- **Search:** type e.g. `sub-03` or `ses-012` to jump to a scan.
- The page shows the exact `.tsv.gz` file being viewed.

**Where it opens.** On a new launch of the tool, on the earliest scan with nothing annotated yet in any channel, so a skipped scan always comes back; when every scan has annotations, on the first scan. A reload during the visit, or coming back from the Stats tab, opens the scan you were on. A link from the Stats tab opens that scan instead. The **Go to the first unannotated scan** button, under the annotation progress bar, opens the earliest scan with nothing annotated for the channel shown, at any time.

**What is remembered.** The channel and stacked channels stay the same when you step through scans. The locks are kept for the visit too. A reload, or going to the Stats tab and back, keeps the channel, stacked channels, events column, confound, the **Show peaks** boxes and the scatter plot's X, Y and Colour by (e.g. skewness against age). They are kept per dataset for the visit (this browser tab), and a new launch of the tool starts clean.

## Signal charts

- **Focus chart** (top): drag to select a time window, which zooms in when you release; double-click to zoom out. The Y-axis fits the visible data. Hover for the value under the pointer.
- **Context chart** (bottom): shows the whole recording. Drag the window to move along it, or drag its edges to change its length. The window length is shown over it.

```{figure} ../images/zoom-scroll.gif
:alt: Hovering over a cardiac signal shows the time and value under the pointer; dragging on the focus chart zooms in to an 18 s window, and dragging that window on the context chart moves along the recording
:name: fig-zoom-scroll

Hover readout, brush to zoom and drag the context window.
```

All charts share one time axis. For physiological recordings in `func/`, **t = 0 is scan onset**, the start of the first BOLD volume. A dashed purple **scan onset (t = 0)** line marks it. Physiological data recorded before the scan (negative times) is out of view.

In other datatype folders, t = 0 is the start of that folder's own data: the EEG recording for `eeg/`, the MEG recording for `meg/`. BIDS defines `StartTime` relative to "the first data sample in the corresponding (neural) dataset" without naming that dataset, so taking it to be the data in the same folder is this tool's reading. Physiological recordings in `beh/` with no events of their own use the events of the same acquisition in a neural datatype folder, and t = 0 is that folder's data. The trigger check and the confounds apply to `func/` only.

## Detected peaks

Peaks can be detected in every PPG, ECG and respiratory channel and shown on the focus chart. Each signal type has a default detector, chosen after a visual comparison of published detectors (see the developer notes in {doc}`../release-notes`); the others kept can be added per run. Compute them first (this needs [uv](https://docs.astral.sh/uv/), which installs the Python libraries on the first run):

```bash
npx vite-node scripts/compute-peaks.ts <dataset> --max-scans 5        # the first 5 scans, the default detector of each signal type
npx vite-node scripts/compute-peaks.ts <dataset> --detectors inhouse_ppg   # the in-house detector for PPG, the defaults for the rest
npx vite-node scripts/compute-peaks.ts <dataset> --all-detectors      # every detector kept
npx vite-node scripts/compute-peaks.ts --list-detectors               # detector ids, with the defaults marked
```

It takes the same `--bids-root`, `--physio-root` and `--deriv-root` options as `scripts/compute-quality-metrics.ts`. Each channel's peaks file holds exactly the detectors of the run: the default only, unless `--detectors` or `--all-detectors` says otherwise. Results a file already has are reused, not run again, unless `--force` is given. Recordings that are not downloaded are skipped and listed.

Channels get the ECG, PPG or respiration detectors by the same rule as the quality metrics ([Channel types](metric-definitions.md#channel-types)): the BIDS `cardiac` is taken as PPG with a note, ambiguous and unknown names are skipped with a warning, and `--channel <column>=<ppg|ecg|resp|none>` sets a column's type for that run (e.g. `--channel cardiac=ecg`). Each peaks file records whether its type came from the name or from `--channel`. Before detecting, the script prints the channel types table (every column, its type and why; see [Channel types](metric-definitions.md#channel-types)) and saves it as `channel_types.json` in the dataset's peaks folder. Detection runs on the file at its own sampling rate, before any downsampling for display.

In the viewer, peaks have their own rows under **CURRENT INQUIRY**, each shown only when the channel has peaks of that kind:

- **PHYSIO EVENTS**: peaks from the scan's physio events file (physprep style, detected and corrected).
- **BUILT-IN PEAK DETECTION**: peaks computed by `scripts/compute-peaks.ts` with the default detector of the channel's signal type, as red dots on the focus chart.

Both rows have a **Show peaks** box, unticked when a visit starts and kept across scans and reloads during the visit.

```{figure} ../images/explore-annotate-peaks.png
:alt: A cardiac recording zoomed in to about 55 to 165 s with Show peaks ticked in the BUILT-IN PEAK DETECTION row: a red dot on each detected beat of the focus chart; the task events chart under Auxiliary
:name: fig-detected-peaks

Detected peaks (red dots) from the default PPG detector on a `cardiac` channel.
```

```{figure} ../images/peaks.gif
:alt: With Show peaks ticked, Next steps through cardiac recordings and each one shows its red detected peaks; zooming in on a stretch with artifacts shows which beats got a peak
:name: fig-detected-peaks-step

Detected peaks stay shown as you step through scans and zoom in.
```

Each detector runs with its library's defaults. The cleaning step is paired with it the way the library's own pipeline does (NeuroKit2 passes the same method name to its cleaning and peak functions where the cleaner has one).

| Signal | Detector | Default | Library | Cleaning | Reference |
|---|---|---|---|---|---|
| PPG | Elgendi 2013 (`neurokit2_elgendi2013`) | yes | NeuroKit2 0.3.0 | `ppg_clean` elgendi (Butterworth 0.5–8 Hz) | Elgendi et al. (2013) |
| PPG | In-house (`inhouse_ppg`) | x | lab MATLAB code, ported | Butterworth order 2, 0.5–4 Hz, zero-phase; height ≥ 0.05 × IQR; distance 0.5 s | Bayrak et al. (2025) |
| ECG | NeuroKit (`neurokit2_neurokit`) | yes | NeuroKit2 0.3.0 | `ecg_clean` neurokit | NeuroKit2 (Makowski et al. 2021) |
| ECG | Engelse–Zeelenberg, modified (`neurokit2_engzeemod2012`) | x | NeuroKit2 0.3.0 | `ecg_clean` engzeemod2012 | Engelse and Zeelenberg (1979); Lourenço et al. (2012) |
| Respiration | Khodadad 2018 (`neurokit2_khodadad2018`) | yes | NeuroKit2 0.3.0 | `rsp_clean` khodadad2018 (Butterworth 0.05–3 Hz) | Khodadad et al. (2018) |
| Respiration | Bettermann 1996 (`neurokit2_bettermann1996`) | x | NeuroKit2 0.3.0 | `rsp_clean` khodadad2018 | Schäfer and Kratky (2008) |

A channel with `n/a` samples gets no peaks from any detector.

References:

- Bayrak, R. G., Hansen, C. B., Salas, J. A., Ahmed, N., Lyu, I., Mather, M., Huo, Y., & Chang, C. (2025). DeepPhysioRecon: Tracing peripheral physiology in low frequency fMRI dynamics. *Imaging Neuroscience*, 3. (`bayrak2025deepphysiorecon` in `paper/paper.bib`; the in-house PPG detector)
- Elgendi, M., Norton, I., Brearley, M., Abbott, D., & Schuurmans, D. (2013). Systolic peak detection in acceleration photoplethysmograms measured from emergency responders in tropical conditions. *PLoS ONE*, 8(10), e76585.
- Engelse, W. A. H., & Zeelenberg, C. (1979), *IEEE Computers in Cardiology*, 6, 37–42; Lourenço, A., et al. (2012), BIOSIGNALS 2012, 49–54. (As cited in NeuroKit2's `ecg_findpeaks`.)
- Khodadad, D., et al. (2018). Optimized breath detection algorithm in electrical impedance tomography. *Physiological Measurement*, 39(9), 094001.
- Makowski, D., et al. (2021). NeuroKit2: A Python toolbox for neurophysiological signal processing. *Behavior Research Methods*, 53(4), 1689–1696.
- Schäfer, A., & Kratky, K. W. (2008). Estimation of breathing rate from respiratory sinus arrhythmia: comparison of various methods. *Annals of Biomedical Engineering*, 36(3), 476–485.

## Auxiliary Signal Options

The **AUXILIARY SIGNAL OPTIONS** row adds charts under AUXILIARY, below the signal of interest. They all follow the focus chart's time window.

- **Event:** for task scans (not rest) with a BIDS `*_events.tsv`. Each event is a block from its onset to onset + duration. A column with at most 10 categories (by default `trial_type`, else `condition` or similar) gets one coloured lane per category with a colour key. Any other column draws every event in one grey lane, with its value in the tooltip. Counters such as `trial_number` are not offered, and the figure is hidden when every column has the same value throughout.
- **Confound:** a head-motion confound from fMRIPrep or MRIQC, shown only when confounds exist for the scan. Framewise displacement is colour-coded by severity (green, amber, red) with 0.2 mm and 0.5 mm reference lines.
- **Stack:** tick channels to add a compact figure for each. Each fits its own Y-axis and has its own hover readout.

```{figure} ../images/explore-annotate-events.png
:alt: A task scan (task cuedSGT, run 02) with Subject locked (red padlock) and EVENT set to Condition: the cardiac signal on top and, under Auxiliary, the events chart for its events.tsv, where the Condition column gives five coloured lanes (Other, Past, Control, Null, Future) with a colour key, each event a block from its onset to onset plus duration
:name: fig-events

The **Event** chart for a task scan: one coloured lane per value of the `Condition` column.
```

```{figure} ../images/explore-annotate-stack.png
:alt: A cardiac recording zoomed in to about 55 to 165 s with red detected peaks, with respiratory ticked under STACK so it appears as a compact figure under Auxiliary, and the Condition events chart below it; next to the file name, the sidecar-only Timing badge
:name: fig-stack

A stacked channel (respiratory) and the task events under the signal of interest (cardiac), all on the same time axis.
```

Channel and Stack offer every column of the physio file except those specifically excluded, the same ones the quality metrics leave out: `trigger`, `time` and other scanner, marker and time stamp columns.

**Physio events peaks (trial).** A trial feature, not final. When the physiological recordings folder has an events file with detected peaks (e.g. physprep's `r_peak` and `systolic_peak`, and their `_corrected` versions), the **PHYSIO EVENTS** row appears under CURRENT INQUIRY; its **Show peaks** box draws them on the signal: blue for detected, green rings for corrected.

## Timing badge

The **Timing** badge, next to the file name, shows whether the physiological recording's timing could be checked against the scanner. Hover over it for the details.

The physiological sidecar's `StartTime` is the reference: it is the time of the first sample relative to the first volume, so it is often negative. If the recording has a `trigger` channel, the tool detects its pulses and checks them against the BOLD timing. Triggers are a cross-check, not the reference, because dummy scans, dropped pulses or recording delays can make the first pulse differ from the first volume.

| Badge | Condition | What the viewer does |
|---|---|---|
| trigger-verified (green) | Every pulse interval is within 5% of TR, the pulse count equals the volume count, and the first pulse lands at t = 0 (within 5% of TR) | Uses `StartTime` as it is |
| corrected from triggers (amber) | Pulses are clean (spacing and count match) but the first pulse is off from t = 0 | Shifts the physiological axis so the first pulse is at t = 0 |
| triggers disagree (red) | Some intervals differ from TR, or the pulse count doesn't match the volume count | Uses `StartTime` as it is, and flags the scan for review |
| sidecar only (amber) | No trigger channel or pulses, or no BOLD TR to check against | Uses `StartTime` as it is, unverified |

**Why trigger verification matters.** Many uses of the physiological recording need it to sit on the BOLD volume times: physiological noise regressors such as the cardiac and respiratory phase used by RETROICOR (Glover et al. 2000), respiration variation (Birn et al. 2006) and heart rate variation (Chang et al. 2009), and the timing of events and artifact annotations against the scan. `StartTime` is written by a conversion step and can be wrong: the physiological recording and the scanner run on separate clocks, dummy scans may have been discarded, the recording may have been started or cut at the wrong time, or `SamplingFrequency` may be wrong. Scanner trigger pulses recorded with the physiological signals are independent evidence of the volume times, on the recording's own clock. **trigger-verified** means the pulses confirm the alignment; **sidecar only** means `StartTime` is used unchecked. In BIDS, `trigger` is an optional column ("continuous measurement of the scanner trigger signal") and `StartTime` is the reference; the trigger check itself is this tool's own, not part of BIDS.

References:

- Birn, R. M., Diamond, J. B., Smith, M. A., & Bandettini, P. A. (2006). Separating respiratory-variation-related fluctuations from neuronal-activity-related fluctuations in fMRI. *NeuroImage*, 31, 1536–1548.
- Chang, C., Cunningham, J. P., & Glover, G. H. (2009). Influence of heart rate on the BOLD signal: the cardiac response function. *NeuroImage*, 44(3), 857–869. <https://doi.org/10.1016/j.neuroimage.2008.09.029>
- Glover, G. H., Li, T.-Q., & Ress, D. (2000). Image-based method for retrospective correction of physiological motion effects in fMRI: RETROICOR. *Magnetic Resonance in Medicine*, 44(1), 162–167.

**How the other charts are timed.**

- **Confounds** have one row per volume. Volume *i* sits at `VolumeTiming[i]`, or at *i* × `RepetitionTime`, read from the BOLD sidecars. If no sidecar has timing, volumes are spread evenly across the recording; that is only approximate. For multi-echo runs, the lowest echo is used.
- **Events** are read from the raw folders (the main BIDS folder first, never the derivatives), in the physiological recording's own datatype folder or at the top level, following BIDS inheritance (the run's own file, else the run-less file, else a top-level `task-<task>_events.tsv`). Their onsets are already in seconds from t = 0, so they are drawn as they are.

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
:alt: Next steps to a respiratory recording with three time windows labelled motion listed under Time Windows; zooming in on the focus chart shows each window over a framewise displacement peak in the chart below
:name: fig-rate-and-step

Stepping to the next scan and checking its time windows against head motion.
```

```{figure} ../images/explore-annotate-time-window.png
:alt: A time window from 22.38 s to 76.79 s labelled signal drop out, shaded on the zoomed-in respiratory focus chart over a stretch where the breathing signal goes flat, and listed under Time Windows with its ×; red detected peaks on the signal and framewise displacement below
:name: fig-time-window

A time window labelled "signal drop out" over a flat stretch of the respiratory signal. It is listed under **Time Windows**, where × deletes it.
```

Everything is saved to disk automatically, one file per scan, recording and channel, and reloads when you return to that scan. Each time window is stored with both its times and its sample indices, so the file can be used as an artifact mask. See {doc}`inputs-and-outputs` for where the files go.

Under the box, the annotated count and progress bar show how many scans of this channel have annotations, within the locks. When two recordings of a scan share a channel name (e.g. `respiratory (recording-belt1)` and `respiratory (recording-belt2)`), each recording is counted on its own.

## Scatter plot

Once the quality metrics are computed, a scatter plot appears at the bottom of the tab. See {doc}`quality-metrics`.
