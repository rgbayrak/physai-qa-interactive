# Release notes

## Unreleased

Changes since v1.0.0 (tagged 2026-03-24).

### New features

- **Any BIDS physio layout:** recordings in any datatype folder (`func/`, `eeg/`, `meg/`, `beh/`, …), for some subjects or sessions only, scans split into `recording-<label>` files, sidecars and events by BIDS inheritance (`beh/` physio without events of its own takes the same acquisition's events from its neural datatype folder); physio and derivatives next to the main BIDS folder (`BIDSPHYS_ROOT`, `BIDSDER_ROOT`).
- **Annotations:** a Signal Quality rating and Notes per recording, labelled time windows, a progress count and **Go to the first unannotated scan**.
- **Viewer:** scan controls from the dataset's entities, with locks (Session hidden for a subject without sessions, as Run is for scans without a run); confounds (fMRIPrep and MRIQC), task events and stacked channels on one time axis; ←/→ keys; downsampling of recordings at 2 kHz or more; every physio column shown unless excluded.
- **Detected peaks:** `scripts/compute-peaks.ts`, with a default detector per signal type (PPG Elgendi 2013, ECG NeuroKit, respiration Khodadad 2018).
- **Quality metrics:** a dataset-wide script with a run log and `--max-scans`, one row per recording and channel; PPG metrics reviewed against Elgendi (2016); a scatter plot, the Stats tab and a PDF report.
- **Dataset checks:** BIDS version check of file and folder names, notices for a missing or placeholder `dataset_description.json`, an On disk data summary, and a start-up log.
- **Project:** documentation on Read the Docs, synthetic test fixtures, unit tests and CI.

### Changed or removed

- MIT licence (was PolyForm Noncommercial 1.0.0); renamed physai-qa-interactive.
- `BIDS_ROOT` is required: there is no default dataset.
- Scan links are `#scan?id=<datatype>/<prefix>`; old `#scan?sub=…` links no longer open a scan.
- Annotations are saved in the recording's own datatype folder, one file per scan, recording and channel.
- Choices are kept for one visit (sessionStorage), not across launches.
- Metrics TSVs from earlier runs must be computed again.
- Metrics removed: min, max, median, % non-zero; sVRI, IPA, SQI, ApEn and Beat Corr are out until they are reviewed.
- The README is a landing page; the documentation is on Read the Docs.

### Planned

- **Eye tracking:** not supported in the current version. BIDS eye-tracking recordings (`PhysioType: "eyetrack"`, gaze and pupil, one `recording-` file per eye) will need their own timing, events and quality metrics.
- **Metric review, continued:** port the default peak detectors to TypeScript, then review M_SQI, Beat Corr, respiratory rate (Romano 2023), sVRI, IPA and SQI (PaPaGei) and ApEn, and others for non-PPG signals.
- **Concurrent recordings (EEG-fMRI):** link the `func/` and `eeg/` physio of one run, which are two separate scans today.
- **BIDS version check:** add hand-written rules for versions before 1.6.0 if a source for them is found (same format as `server/schema-rules/`)

**Open for discussion:**

- **Search box:** find any level the scan controls show (task, datatype, `acq`, run), not only subjects and sessions.
- **Subset of a dataset:** view or compute metrics for some subjects only, while `BIDS_ROOT` stays on the whole dataset.
- Turn on "Allow GitHub Actions to create and approve pull requests" (repository Settings → Actions → General → Workflow permissions); without it, `.github/workflows/bids-rules.yml` cannot open its pull request when a new BIDS release exists. The "no new release, no pull request" case passed on the scheduled run of 2026-11-16.
- If moving to the next file is slow (unacceptable latency). Not timed yet: first check `/api/bids/physio` in the browser Network tab (Waiting (TTFB) = server time, Size / Content download = JSON cost) and the Performance tab for the chart drawing. Suggested fixes, biggest effect first:
  - Send physio samples as binary (`Float32Array`, about 4 bytes per value, no parsing) instead of JSON number arrays, which are likely tens of MB per scan at 1000–5000 Hz and parsed in full by the browser (`fetchPhysioRaw`)
  - Keep columns as typed arrays in the viewer instead of one `{time, value}` object per sample, built again for each stacked channel (`toDataPoints`, `src/viewer/charts/stack.ts`)
  - Server cache and prefetch, and focus-chart downsampling (items below)
  - Read the confounds file once per scan: `readPhysio` reads and unzips it to count volumes when the BOLD sidecar has no `VolumeTiming` (`countConfoundVolumes`), then `readConfounds` reads it again (`server/bids-layout.ts`)

#### Performance & data pipeline

- Context (overview) chart: draw it from a min/max envelope instead of `downsample(data, 2000)` (`src/viewer/charts/focus-context.ts:117`, uniform stride in `src/core/viewportCulling.ts`). Keeping every N-th sample drops or flattens R-peaks, spikes and short dropouts and can alias a regular rhythm into a pattern that is not there, so the overview looks different from the focus view and can hide artifacts. Display only (metrics and the Stats waveforms already use `minMaxEnvelope()`). Share the envelope with the focus-chart item above; own branch, after the BIDS discovery steps
- Cache parsed physio/confounds reads server-side — `server/bids-physio-plugin.ts` re-parses (sync gunzip + full TSV parse) on every request, even when revisiting a scan just seen; add an in-memory cache keyed by scan id (and recording). Also prefetch the next scan while the current one is viewed, so Next is served from memory
- Lazy loading, above all for high sampling-rate waveforms: fetch and draw only what the view needs (e.g. the overview envelope first, full-rate samples for the focus window as it is zoomed or moved), instead of the whole recording before anything is shown
- Switching between Explore and Annotate and Stats reloads every waveform: each tab is a separate page load, so the scan's physio and the Stats waveforms are fetched and drawn again each time. Keep them in memory across the switch, either by making the two tabs one page that only swaps views (both exist at the same time, the hidden one kept), or by caching the fetched data in the browser for the visit (with the server cache above for the first load)
- Time the first load of a high-rate scan (10 kHz): every request unzips, parses and low-pass filters the full-rate file again (`readPhysio`, `server/downsample.ts`). Parsing ~600 MB of text took ~8 s in the test; the server cache above would make revisits instant
- Support custom signals derived by convolving physiological response functions (Birn et al. 2006/2008 respiration-BOLD, Chang & Glover 2009 cardiac/respiratory response functions)
- Production build, the server plugin only works in Vite dev mode; the FastAPI backend planned above should supersede this, otherwise would need an Express/Fastify server for production. That server must also serve `data/quality/` for the quality page


### Developer notes

Decisions made for this version, which is not released yet, with the reason where one was recorded.

#### Design choices

| Area | Choice | Why |
|---|---|---|
| Finding files | One walk of the dataset by file names (`server/bids-index.ts`), never by folder name | Covers every layout the BIDS physio page allows, and works before a DataLad dataset is downloaded |
| Recording found twice | The physio folder given wins (`BIDSPHYS_ROOT`, else `BIDS_ROOT`'s own file), then `desc-preproc`, `.tsv.gz` | The user's choice of folder decides |
| Downloaded | The data file's content is on disk (gzip bytes, not a git-annex pointer), never the `.json` | DataLad keeps sidecars in git; unlocked pointers had crashed the reader |
| Scan identity | Datatype folder plus entities, one id string | Tells `acq-`, `dir-` and `func/` vs `eeg/` apart; old links break (accepted) |
| t = 0 | The data in the physio file's own datatype folder (first BOLD volume for `func/`) | BIDS times `StartTime` against "the corresponding (neural) dataset" without naming it; this is the tool's reading |
| Trigger check | Only a column named `trigger`, per recording, `func/` only; `StartTime` stays the reference | `trigger` is the BIDS column name; triggers are a cross-check |
| `n/a` samples | Gaps, not bridged | Bridging would need an ad hoc threshold |
| Channel names | Plain column name; `(recording-<label>)` only when two recordings share it | Datasets such as ds004636 use plain names |
| Columns shown | Everything unless excluded by whole name | Names are never assumed (`tidal_volume` stays) |
| Channel types | `cardiac` alone = PPG with a note; ambiguous and unknown names skipped with a warning; `--channel` per run | One rule for metrics and peaks; no per-dataset mappings |
| Downsampling | ≥ 2 kHz to about 1 kHz by a whole factor, zero-phase FIR | Anti-aliasing only: the viewer shows unfiltered signals; metrics use the same data |
| BIDS version check | Own checker on names only; no check without rules for that version | Validator 3.0.2 crashed on older schemas; OpenNeuro data is already validated |
| Not supported | Eye tracking; interleaved IMU files | Eye tracking design undecided; IMU files are outside BIDS |
| Docs | Sphinx, MyST, insipid on Read the Docs; visuals in D3 | Matches the app |

#### Quality metrics review

Against Elgendi (2016); definitions in {doc}`user-guide/metric-definitions`.

- Mean, perfusion and entropy only for physical units (`"arbitrary"` or missing `Units` gives `n/a`): the mean and perfusion need the DC level, and entropy is a sum in the signal's own units.
- The generic skewness, kurtosis, zero crossing and SNR are replaced by the paper's SQIs, each named with its paper; PPG filtering through NeuroKit2.
- Windows: perfusion 1 s, S_SQI 5 s, N_SQI and Z_SQI 1 s (the paper gives none). The mean over windows is ad hoc.
- Z_SQI follows the paper's text and Chen (1988), not Eq. 6 as printed.
- Flat-signal tolerance 1e3 · ε · max|x|: ad hoc (user-approved).

#### What is kept between pages and launches

The viewer's choices are kept in the browser tab's `sessionStorage`, in one entry per dataset and dev server launch (`src/viewer/persistence.ts`; shared with Stats by `src/quality/linked-scan.ts`).

| Action | Buttons and dropdowns (channel, confound, events column, stack, locks, **Show peaks** boxes, scatter X, Y and Colour by) | Subject and scan |
|---|---|---|
| Reload the page | kept | kept |
| Switch between Explore and Annotate and Stats | kept | kept: both tabs show the same scan |
| Stop and relaunch the tool (`npm run dev`) | reset | reset: opens the first scan with no annotations |
| Close the browser tab | reset | reset |

The scan changes only when one is picked: the scan dropdowns, Prev/Next or the search box in Explore and Annotate, Prev/Next in Stats (Stats writes the scan it shows back), and a double-click on a scatter point. A scatter double-click is a new choice of scan, so it clears the locks: the picked scan opens in Stats and, on the way back, in Explore and Annotate.

#### Peak detection: detectors tested and not included

These were run in the comparison and are not included. Their code is kept, not run, in `scripts/archive/detect_peaks_tested.py`, so any of them can be brought back as it was.

| Signal | Detector | Library | Why not included |
|---|---|---|---|
| PPG | MSPTDfast v2 (Charlton et al. 2025) | NeuroKit2 0.3.0 | Not kept after the developer's visual inspection |
| PPG | HeartPy (van Gent et al. 2019) | HeartPy 1.2.7 | Not kept after the developer's visual inspection |
| PPG | MSPTD (Bishop and Ercole 2018) | NeuroKit2 0.3.0 | Slow |
| PPG, respiration | peakdet `peakfind_physio`, thresh 0.2 (DuPre et al. 2024) | peakdet 0.6.1 | Raised `ValueError: setting an array element with a sequence.`; ran on simulated 60 s, 100 Hz signals; cause not found |
| ECG | Pan–Tompkins, Hamilton, Christov, Elgendi 2010, Kalidas (SWT), Zong (WQRS), Khamis (UNSW), Nabian, Emrich (visibility graph), Elgendi 2013 (ECG), Rodrigues (adaptive steepness), Gamboa | NeuroKit2 0.3.0 | Not kept after the developer's visual inspection |
| ECG | XQRS | wfdb 4.3.1 | Not kept after the developer's visual inspection |
| Respiration | scipy `find_peaks`; BioSPPy | NeuroKit2 0.3.0 | Not kept after the developer's visual inspection |

#### Peak detection: choosing a default

The detectors were compared visually, scan by scan. The default for each signal type, and why:

| Signal | Default | Also kept | Review |
|---|---|---|---|
| PPG | Elgendi 2013 (NeuroKit2) | In-house | Elgendi 2013 did best. It is also the default PPG method in NeuroKit2. |
| Respiration | Khodadad 2018 (NeuroKit2) | Bettermann 1996 | Both methods performed well and were retained, with no clear basis for preferring one over the other. Khodadad 2018 (NeuroKit2's default) was selected as the default. |
| ECG | NeuroKit (NeuroKit2) | Engelse–Zeelenberg (modified) | Both methods performed well and were retained. NeuroKit was selected as the default, as its performance appeared slightly better. It is also the default ECG method in NeuroKit2. |

References:

- Bishop, S. M., & Ercole, A. (2018). In *Intracranial Pressure & Neuromonitoring XVI* (pp. 189–195). (As cited in NeuroKit2's `ppg_findpeaks`; title not yet checked.)
- Charlton, P. H., et al. (2025). *Physiological Measurement*, 46, 035002. (As cited in NeuroKit2's `ppg_findpeaks`; title not yet checked.)
- DuPre, E., et al. (2024). physiopy/peakdet: A python toolbox for reproducible physiological data analysis. Zenodo. <https://doi.org/10.5281/zenodo.13359249> (the v0.5.1 DOI, cited for v0.6.1, the version tested)
- van Gent, P., Farah, H., van Nes, N., & van Arem, B. (2019). *Journal of Open Research Software*, 7(1), 32. <https://doi.org/10.5334/jors.241> (full title in `paper/paper.bib`, `van2019heartpy`)
- The other ECG references (Pan & Tompkins 1985; Hamilton 2002; Christov 2004; Elgendi et al. 2010; Kalidas & Tamil 2017; Zong et al. 2003; Khamis et al. 2016; Nabian et al. 2018; Emrich et al. 2023; Elgendi 2013, *PLoS ONE* 8(9) e73557; Gutiérrez-Rivas et al. 2015 and Sadhukhan & Mitra 2012; Gamboa 2008, PhD thesis) are as listed in NeuroKit2's `ecg_findpeaks` docstring.
