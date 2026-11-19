# Contributing

Developer notes for physAI-QA-interactive: how the code is laid out and how the
server and charts work. For installing and running the viewer,
see [Get started](get-started.md).

## Commands

```bash
npm install
BIDS_ROOT=data/<dataset> npm run dev   # Vite dev server with hot reload (no default dataset)
npm test           # vitest run (all tests)
npm run test:watch # vitest in watch mode
npm run typecheck  # tsc --noEmit (strict, no output)
npm run build      # tsc --noEmit + vite build (index.html and quality.html)

npx vite-node scripts/compute-quality-metrics.ts <dataset>  # dataset quality metrics -> data/quality/<dataset>/
npx vite-node scripts/compute-peaks.ts <dataset> --max-scans <N>  # detected peaks per channel -> data/peaks/<dataset>/ (needs uv)
npx tsc -p scripts                                           # typecheck scripts/ (outside the root tsconfig)
npx vite-node scripts/update-bids-rules.ts [x.y.z ...]       # BIDS rules for new releases -> server/schema-rules/
```

### Tests

Tests run against three tiny synthetic BIDS datasets in `test/fixtures/` (`bids-sessions`: sessions and runs with fMRIPrep-style derivatives; `bids-nosessions`: a session-less layout; `bids-recordings`: scans split into `recording-` files), plus small datasets written to temporary folders, so they need no downloaded data. They cover:

- **Finding files** (`server/__tests__/`): the one walk of the dataset, physio in any datatype folder, sidecar and events inheritance, which copy of a recording is loaded, beh/ timing (`bids-discovery.test.ts`); `recording-` files (`recordings.test.ts`); every timing badge, sidecar fallbacks, confounds (fMRIPrep and MRIQC names), task events, the trial peaks, annotations and path safety (`bids-layout.fixtures.test.ts`, `timing.test.ts`, `annotations.test.ts`); downloaded-file counts and the content check (`availability.test.ts`); downsampling (`downsample.test.ts`); detected peaks files (`peaks.test.ts`); the BIDS version check of file and folder names (`bids-structure.test.ts`); the `BIDS_ROOT` start check (`bids-roots-check.test.ts`); the startup banner (`startup-banner.test.ts`)
- **Scan ids and data** (`src/data/__tests__/`): scan keys, locks and t = 0 per datatype (`scan-key.test.ts`), the client fetchers (`bids-physio-reader.test.ts`), dataset description notices (`dataset-notice.test.ts`), filters, spectrum and the signal quality metrics (`filters.test.ts`, `spectrum.test.ts`, `sqi-metrics.test.ts`)
- **Viewer** (`src/viewer/__tests__/`): scan controls (`scan-selects.test.ts`), where the viewer opens, Prev/Next with locks, search and the first unannotated scan (`navigation.test.ts`), choices kept for the visit (`persistence.test.ts`), the annotation model (`annotations.test.ts`), events columns (`events.test.ts`), the info line and badges (`info.test.ts`), chart helpers (`charts.test.ts`), trial and detected peaks (`peaks-trial.test.ts`, `detected-peaks.test.ts`)
- **Chart library** (`src/core/__tests__/`): compact tick labels, y-axis title position and tick count (`axes.test.ts`); min/max downsampling for the context chart (`viewportCulling.test.ts`)
- **Quality metrics** (`src/quality/__tests__/`, `server/__tests__/quality-metrics.test.ts`): the pipeline (identical output on reruns, which columns are excluded; `quality-metrics.test.ts`), the metrics TSV, scatter colour legend, histogram stats, Stats links and t = 0 label (`quality.test.ts`), the run log (`run-log.test.ts`), channel types and the docs vocabulary table (`channels.test.ts`), metric names and Metrics shown (`visible-metrics.test.ts`), metric labels (`metric-columns.test.ts`), participant and scatter axes and the PDF writer (`axes-pdf.test.ts`), the scan shared with Explore and Annotate (`linked-scan.test.ts`)

Regenerate the fixtures after changing them with:

```bash
python3 test/fixtures/make_fixtures.py
```

The dataset-agnostic suite in `server/__tests__/bids-layout.test.ts` also runs on any real datasets present under `data/`, and skips them when they aren't downloaded. CI (`.github/workflows/ci.yml`) runs `typecheck` and `test` on every push to `main` and every pull request.

---

## Architecture

```
src/
├── core/
│   ├── createChart.ts      # Factory function (the main entry point)
│   ├── types.ts            # All TypeScript interfaces
│   ├── scales.ts           # Scale creation helpers
│   ├── axes.ts             # Axis + grid rendering
│   ├── clipPath.ts         # Clip path setup
│   ├── resize.ts           # ResizeObserver logic
│   ├── tooltip.ts          # Tooltip module
│   ├── zoom.ts             # Composable zoom/pan module
│   ├── brush.ts            # Composable brush module
│   ├── viewportCulling.ts  # cullToViewport, minMaxDownsample, downsample
│   └── index.ts            # Barrel export
├── data/
│   ├── bids-physio-reader.ts  # Client-side BIDS physio data fetcher
│   ├── bids-structure.ts      # BIDS version check result type and its summary line (shared with the server)
│   ├── dataset-notice.ts      # Notices for a missing or placeholder dataset_description.json (shared with the server)
│   ├── detected-peaks.ts      # Detected peaks file type, fetch, and peak times on the chart axis (shared with the server)
│   ├── filters.ts             # Zero-phase Butterworth band-pass, matching NeuroKit2's signal_filter (used by the metrics)
│   ├── recordings.ts          # Channels of a scan split into recording- files, and how they are named (shared by the viewer, Stats and scripts)
│   ├── scan-key.ts            # Scan ids (datatype + entities), hierarchy order, locks, t = 0 per datatype (shared with the server)
│   ├── spectrum.ts            # Welch power spectral density, matching NeuroKit2's signal_psd (used by the metrics)
│   └── sqi-metrics.ts         # Per-channel signal quality metrics
├── viewer/                    # Interactive physio viewer (only main.ts touches the page)
│   ├── main.ts                # Entry: init, data loading, event wiring
│   ├── dom.ts                 # Element lookup from index.html
│   ├── state.ts               # The single ViewerState object
│   ├── annotations.ts         # Annotation model <-> stored JSON (pure)
│   ├── annotation-panel.ts    # Annotation list rendering, progress bar colour
│   ├── info.ts                # Dataset info line, On disk data summary, downsampling/timing/quality badges
│   ├── controls.ts            # Scan controls from the dataset's entities, with locks; channel dropdowns, stacked-channel checkboxes
│   ├── navigation.ts          # Prev/next stepping within the locks, search resolution, which scan to open (pure)
│   ├── persistence.ts         # The visit's last-viewed scan and choices in sessionStorage
│   ├── events.ts              # Events columns: rest check, categories, counters, default column (pure)
│   ├── peaks-trial.ts         # TRIAL: match physprep peaks to the picked channel (pure)
│   ├── detected-peaks.ts      # Which detector the BUILT-IN PEAK DETECTION row shows (pure)
│   └── charts/
│       ├── shared.ts          # Line drawing, y-fit, onset marker, hover readout
│       ├── focus-context.ts   # Focus + overview charts, brush-to-zoom, annotation boxes, overlay layer
│       ├── confounds.ts       # Confound chart, FD severity coloring
│       ├── events.ts          # Events chart: one lane per category, blocks from onset to onset + duration
│       ├── peaks-trial.ts     # TRIAL: peak dots drawn on the focus chart's overlay
│       └── stack.ts           # Stacked channel charts
├── quality/                   # Quality metrics: the Stats tab (quality.html; only main.ts touches that page) and the scatter plot in Explore and Annotate
│   ├── main.ts                # Stats entry: #scan?id=… link, dataset loading, builds and saves the PDF report once
│   ├── individual-tab.ts      # Stats: one scan's header, waveforms, per-channel metric tables and histograms
│   ├── scatter-panel.ts       # Scatter plot for Explore and Annotate (X: metric or participant; Y: metric; viewed scan highlighted)
│   ├── report.ts              # PDF report: lays out pages on a canvas, rasterises the charts
│   ├── pdf.ts                 # Minimal PDF writer (one JPEG per page, pure)
│   ├── charts.ts              # Scatter, histogram and static waveform charts (createChart)
│   ├── metric-columns.ts      # Metric labels, sources and number format (SQI_COLUMNS; pure)
│   ├── model.ts               # Labels, summaries, axis choices, scatter data (pure)
│   ├── metrics-tsv.ts         # TSV/JSON formats shared with the script (pure)
│   ├── channels.ts            # Excluded (non-physiological) column names, signal types, and the analysis type (PPG/ECG/respiration) shared by metrics and peaks (pure)
│   ├── envelope.ts            # Min/max downsampling for waveforms (pure)
│   ├── stats.ts               # Histogram bins, percentiles (pure)
│   ├── route.ts               # /quality.html#scan?id=… links (pure)
│   ├── metric-picker.ts       # "Metrics shown" sidebar list: show/hide each metric
│   ├── linked-scan.ts         # Shares the open scan with Explore and Annotate (via its sessionStorage entry)
│   ├── run-log.ts             # quality_runs.tsv: one line per metrics run, and its sentence (pure; also used by the script)
│   └── data.ts                # Fetches the served dataset's data/quality/ files
├── shell/
│   └── tabs.css               # Page shell shared by index.html and quality.html: font (IBM Plex Sans), text tokens, titles, folder tabs, dataset header, .btn, "Now viewing" line
├── utils/
│   ├── uid.ts              # Unique ID generator
│   ├── margin.ts           # Margin defaults/merge
│   ├── dom.ts              # Container resolution
│   ├── html.ts             # escapeHtml, shared by the viewer and the Stats tab
│   └── index.ts            # Barrel export
└── main.ts                 # Entry point (loads viewer/main)

server/
├── bids-index.ts           # One walk of the dataset folders: every physio file, sidecar, confounds, events and description file, by name; which copy of a recording is loaded
├── bids-layout.ts          # Pure BIDS logic on the index: scans, sidecar inheritance, timing, confounds, events, annotation paths (testable, no Vite dependency)
├── downsample.ts           # Brings recordings at 2 kHz or more down to about 1 kHz: low-pass filter (no time shift), block maximum for triggers
├── bids-physio-plugin.ts   # Vite plugin: checks the folders and prints the banner at start, reads the dataset once the dev server listens, serves every /api/* endpoint
├── bids-roots-check.ts     # Stops the dev server when BIDS_ROOT (or BIDSPHYS_ROOT, BIDSDER_ROOT) is missing or not a BIDS dataset
├── startup-banner.ts       # Welcome banner printed when the dev server starts
├── bids-structure.ts       # BIDS version check: file and folder names against the declared version's rules
├── bids-rules.ts           # Loads the rules for a BIDS version from schema-rules/
├── schema-rules/           # One rules file per BIDS release (from the official BIDS schema)
├── availability.ts         # Physio files listed vs downloaded (git annex find, else the file's content)
├── channel-types.ts        # The run's channel types table from the physio.json Columns (shared by both compute scripts)
├── peaks.ts                # Detected peaks: which channels get detectors, the manifest for detect_peaks.py, reading a channel's file
├── quality-run-log.ts      # Appends a run's line to data/quality/<dataset>/quality_runs.tsv
└── quality-metrics.ts      # Dataset-wide quality metrics: computes and writes data/quality/<dataset>/

scripts/
├── compute-quality-metrics.ts  # Command-line wrapper around server/quality-metrics.ts
├── compute-peaks.ts            # Lists the PPG, ECG and respiratory channels (server/peaks.ts), then runs detect_peaks.py with uv
├── detect_peaks.py             # The peak detectors kept (NeuroKit2, in-house) with a default per signal type; inline uv dependencies
├── archive/detect_peaks_tested.py  # Detectors tested and not included (kept for reference, not run)
├── update-bids-rules.ts        # Writes server/schema-rules/ files for new BIDS releases
└── tsconfig.json               # Typecheck settings for scripts/ (npx tsc -p scripts)
```

### Data pipeline

```
BIDS dataset on disk
  ↓  server/bids-physio-plugin.ts (Node.js, runs inside Vite dev server)
  ↓  Reads .json sidecar + decompresses .tsv.gz
  ↓  Returns compact column-array JSON via /api/bids/* endpoints
  ↓
Browser (src/data/bids-physio-reader.ts)
  ↓  fetchDatasetInfo(), fetchSubjects(), fetchScans(), fetchLaunchId(), fetchFirstUnannotatedScan(), fetchPhysioRaw(), fetchConfounds(), fetchEvents(), fetchPeaks() (trial), fetchAnnotations(), fetchAnnotationProgress(), saveAnnotations()
  ↓  toDataPoints() / toConfoundPoints() materialize {time, value}[] arrays
  ↓
SQI (src/data/sqi-metrics.ts)
  ↓  computeSQI() — 10 per-channel metrics: mean, std dev (raw and filtered), SNR, kurtosis, skewness, entropy, zero crossing,
  ↓  perfusion, relative power
  ↓
Viewer (src/viewer/)
  ↓  main.ts holds the state and wires events; charts/ builds focus+context,
  ↓  stacked, events and confounds charts and keeps them on one time window
```

Dataset quality metrics run offline and are served as static files, not through the API:

```
BIDS dataset on disk
  ↓  scripts/compute-quality-metrics.ts → server/quality-metrics.ts
  ↓  readPhysio() for every scan, keep physiological columns (src/quality/channels.ts), computeSQI()
  ↓  writes data/quality/<dataset>/quality_metrics.tsv, dataset.json, waveforms/*.json,
  ↓  and appends one line to quality_runs.tsv (scans computed / listed / failed)
  ↓
Browser (src/quality/)
  ↓  asks /api/bids/dataset which dataset the server serves (its `id`), then
  ↓  fetches /data/quality/<id>/… directly (served by Vite from the project root)
  ↓  scatter plot in Explore and Annotate (index.html), Stats tab and PDF report (quality.html)
```

### Server API endpoints

| Endpoint | Description |
|---|---|
| `GET /api/bids/subjects` | All subjects with their sessions (only those with readable physio files) |
| `GET /api/bids/dataset` | Dataset metadata from `dataset_description.json` (raw + derivatives `GeneratedBy`), plus `id`: the dataset's folder name under `data/`, and `physioFiles`: `{ onDisk, downloaded, source }`, physio files listed vs downloaded, counted once at startup, and `structure`: file and folder names checked against the rules of the declared `BIDSVersion` (`server/bids-structure.ts`), and `description`: where the title and authors came from, which fields are placeholders, and how to get a missing main description (`src/data/dataset-notice.ts`) |
| `GET /api/bids/scans` | Flat list of every scan `{id, datatype, sub, ses, task, run, entities}` in hierarchy order (`ScanKeyLike`, `src/data/scan-key.ts`) |
| `GET /api/bids/launch` | `{ id }`: this dev server launch, so the viewer's choices last one visit only (sessionStorage key) |
| `GET /api/bids/first-unannotated?lock=` | `{ scan }`: the first scan (hierarchy order, within the locks) with no annotations in any channel, or `null`; where a new launch opens |
| `GET /api/bids/physio?scan=` | Every recording of the scan as compact column arrays, each with its timing check (`timing`); recordings that cannot be read are listed in `skipped` (404 with the reasons when none can) |
| `GET /api/bids/confounds?scan=` | Motion confounds (FD, RMSD, DVARS, trans/rot) from the fMRIPrep or MRIQC confounds TSV; `null` (200) when the scan has none, and always for physio outside `func/` |
| `GET /api/bids/events?scan=` | Task events `{ filename, onset, duration, columns }` from the raw datasets (`BIDS_ROOT` first; BIDS inheritance: run, run-less, top-level); `null` (200) when there are none |
| `GET /api/bids/detected-peaks?scan=&channel=&recording=` | Peaks of one channel from each detector, written by `scripts/compute-peaks.ts`; `null` when not computed |
| `GET /api/bids/peaks?scan=` | TRIAL: detected and corrected peaks `{ filename, time, channel, corrected }` from a physprep-style events file in the physio file's own dataset; `null` when there are none |
| `GET /api/bids/annotations?scan=&channel=&recording=` | Stored annotations for one channel of one recording, or an empty file for it |
| `POST /api/bids/annotations` | Saves (overwrites) annotations for one channel of one recording (body: the file, with `scan`, `recording` and `channel`) |
| `GET /api/bids/annotation-progress?channel=&recording=&lock=` | `{ annotated, total, firstUnannotated }`: scans within the locks with a Signal Quality rating, Notes or a time window saved for that channel (in any recording, or only `recording` when two recordings share the channel name), and the earliest scan (hierarchy order) without any, or `null` |
| `GET /api/quality-report` | `{ exists, url }`: whether the served dataset's `data/quality/<dataset>/quality_report.pdf` is saved |
| `POST /api/quality-report` | Saves the PDF report the Stats tab built (body: the PDF; only for the served dataset, only once its metrics exist) |

`?scan=` is the scan id, `<datatype>/<file name prefix>` (e.g. `func/sub-01_ses-01_task-rest_run-01`, `src/data/scan-key.ts`); an id the index doesn't know is refused. `lock=` takes `<entity>:<value>` (e.g. `lock=task:rest`), once per lock.

Only physio files whose content is on disk are offered (`hasPhysioContent`, `server/bids-index.ts`): gzip bytes for `.tsv.gz`, and not a git-annex pointer file for a plain `.tsv`. Files DataLad lists but hasn't fetched are counted as not downloaded and skipped.

Confounds are found anywhere in the index (`BIDS_ROOT` with its `derivatives/`, and `BIDSDER_ROOT` when set), for `func/` scans only. The server prefers, in order, fMRIPrep's `*_desc-confounds_timeseries.tsv[.gz]`, the older `*_desc-confounds_regressors.tsv` and `*_bold_confounds.tsv`, then MRIQC's `*_timeseries.tsv` (`CONFOUNDS_PATTERNS`, lowest echo for multi-echo runs), and extracts the motion columns (`framewise_displacement`, `rmsd`, `dvars`, `std_dvars`, `trans_*`, `rot_*`); the **Confound** dropdown picks which one to plot and only appears when a confounds file is found.

Annotations are written as JSON files under `ANNOTATIONS_ROOT` (env var, default `data/annotations/` in the project root), in a folder per dataset, one file per scan, recording and channel, in the physio file's own folder relative to its dataset: `<ANNOTATIONS_ROOT>/<dataset>/sub-XX/[ses-YY/]<datatype>/<scan prefix>[_recording-<label>]_channel-<channel>_annotations.json` (`annotationsFilePath`, `server/bids-layout.ts`). Each file starts with the full-recording `waveform_quality` (`good`, `bad`, `fixable`, `unknown` or `null`) and `waveform_comment` (Notes), followed by `scan`, `datatype`, `sub`, `ses`, `task`, `run`, `recording`, `channel`, `sampling_rate` and the time windows in `annotations`. Files saved before the two waveform fields existed still load.

Detected peaks are written by `scripts/compute-peaks.ts` under `PEAKS_ROOT` (env var for the dev server, default `data/peaks/`; the script's `--out`), laid out as the annotations: `<PEAKS_ROOT>/<dataset>/sub-XX/[ses-YY/]<datatype>/…_channel-<channel>_peaks.json`. Each file holds the channel's `sampling_rate` and, per detector, its `id`, `label`, `library`, `reference`, `params`, `peaks` (sample indices from the first sample of the file) and `error` (`DetectedPeaksFile`, `src/data/detected-peaks.ts`). The viewer reads them through `/api/bids/detected-peaks`.

How the server and viewer line up physio, confounds and triggers in time is described in the user guide under [Timing badge](user-guide/explore-and-annotate.md#timing-badge).

### Design principles

- **Composition over inheritance** — chart types call `createChart()`, hook events, draw into `layers.content`, and return an extended instance.
- **Base does NOT set domains from data** — chart types compute their own domains.
- **Individual D3 modules** — `d3-scale`, `d3-axis`, `d3-selection`, etc. for tree-shaking. No monolithic `d3` import.
- **Functional factory pattern** — no classes, composable, idiomatic D3.
- **No component framework (Vue/React)** — vanilla D3+TS holds up as long as state stays centralized (a single object for current scan/selection/annotations) and render functions stay pure/redraw-from-state. Revisit only if hand-rolled DOM diff/patch logic becomes unavoidable, not because of codebase size alone.
- **Viewer modules don't reach into the page** — only `src/viewer/main.ts` looks up elements and owns the `ViewerState`; every other viewer module receives elements and data as arguments and has no import-time DOM access, so its logic is unit-tested in Node (`src/viewer/__tests__/`). The quality page follows the same rule: only `src/quality/main.ts` touches `quality.html`, and the pure modules are tested in `src/quality/__tests__/`.
- **One text style everywhere** — every change keeps text font, size and colour matched across pages. Use only the shared tokens in `src/shell/tabs.css` (`--fs-dataset`, `--fs-title`, `--fs-xl` … `--fs-xs`, `--text`, `--text-2`, `--text-3`, `--link`, `--font`, `--mono`; `--control` colours checked checkboxes and active buttons), never a page-specific font size, family or text colour. Titles (`h2`, `h3`, `.section-label`) share one style, and sub-titles (`h4`, `.subsection-label`) one a step smaller, both in `--text-2`. Within a section, text under its heading (description, labels, dropdowns, legend, notes) is one size and one colour. File and channel names use the shared code style (`.now-viewing-file`, `.channel-name`).

---

## Quality metrics: adding or removing a metric

A metric is computed in one place and listed in three:

1. **Compute it** in `computeChannelMetrics()` (`src/data/sqi-metrics.ts`) and add the field to the `ChannelMetrics` interface. Return `NaN` when it does not apply to a channel.
2. **Label it** in `SQI_COLUMNS` (`src/quality/metric-columns.ts`): label, decimals, description and source (the paper, as "Author Year"; none for a plain statistic). The scatter plot, the Stats tab and the PDF use these labels.
3. **Give it a TSV column** in `METRIC_COLUMNS` (`src/quality/metrics-tsv.ts`), in snake_case. The column order there is the TSV column order.
4. **Document it** in `docs/user-guide/metric-definitions.md`: what it computes, which channels it applies to, and its citation.
5. **Test it** in `src/data/__tests__/sqi-metrics.test.ts` with a synthetic signal of known value, and add the field to the `ChannelMetrics` sample in `src/quality/__tests__/metric-columns.test.ts`, which checks that every metric has a column definition.
6. **Rerun the script** for every dataset. `parseQualityTsv` refuses a TSV that lacks a column listed in `METRIC_COLUMNS`, so old outputs stop loading until they are recomputed.

To remove a metric, delete it from the same places. The scatter plot and the Stats tab build their axes, tables and histograms from the metrics that have values in the TSV for each channel, so no plot code changes are needed either way.

Every physio column is shown and computed unless it is specifically excluded. To exclude a non-physiological column (e.g. a vendor-specific trigger or marker name), add it to `NON_PHYSIO_CHANNELS` in `src/quality/channels.ts` with its reason. To give a column a signal type (e.g. `cardiac`), add it to `PHYSIO_CHANNELS`; names not listed there are still shown, with no signal type. Names are matched as whole names, without case, separators or a trailing number.

---

## Chart library usage

### Minimal example

```ts
import { createChart } from '@/core';

const chart = createChart({
  container: '#chart',           // CSS selector or HTMLElement
  xScale: { type: 'linear' },
  yScale: { type: 'linear' },
});
```

This creates an SVG with axes, margins, and resize handling. No data is rendered yet — that's the job of chart types that build on top.

### Focus+context with zoom, pan, and brush

```ts
import { createChart, createZoom, createBrush, cullToViewport, downsample } from '@/core';
import { line } from 'd3-shape';
import type { ScaleLinear } from 'd3-scale';

// Create focus chart (zoomable)
const focus = createChart({
  container: '#focus-chart',
  xScale: { type: 'linear', domain: [0, 10] },
  yScale: { type: 'linear', domain: [0, 1], nice: true },
  xAxis: { position: 'bottom', label: 'Time (s)' },
  yAxis: { position: 'left' },
  grid: { x: true, y: true },
  tooltip: { enabled: true },
  resize: { enabled: true },
});

// Create context chart (overview with brush)
const context = createChart({
  container: '#context-chart',
  height: 80,
  xScale: { type: 'linear', domain: [0, 10] },
  yScale: { type: 'linear', domain: [0, 1] },
  xAxis: { position: 'bottom', tickCount: 5 },
  yAxis: { position: 'left', hide: true },
  resize: { enabled: true },
});

// Draw line with viewport culling for performance
function drawFocusLine() {
  const { x, y } = focus.getScales();
  const xDomain = (x as ScaleLinear<number, number>).domain() as [number, number];
  const visible = cullToViewport(data, xDomain, (d) => d.time);
  // ... render visible slice
}

// Zoom on focus chart
const zoomHandle = createZoom(focus, {
  scaleExtent: [1, 100],
  onZoom(xDomain) {
    drawFocusLine();
    brushHandle.moveTo(xDomain);   // sync brush
  },
});

// Brush on context chart
const brushHandle = createBrush(context, {
  onBrush(selection) {
    if (!selection) return;
    zoomHandle.zoomToDomain(selection);  // sync zoom
    drawFocusLine();
  },
});
```

---

## API Reference

### `createChart(config)`

Creates and returns a `ChartInstance`.

#### `ChartConfig`

| Property | Type | Default | Description |
|---|---|---|---|
| `container` | `string \| HTMLElement` | — | **Required.** CSS selector or DOM element. |
| `width` | `number` | container width or `600` | Outer SVG width. |
| `height` | `number` | container height or `400` | Outer SVG height. |
| `margin` | `Partial<Margin>` | `{top:20, right:20, bottom:40, left:50}` | Merged with defaults. |
| `xScale` | `ScaleConfig` | — | **Required.** X-axis scale configuration. |
| `yScale` | `ScaleConfig` | — | **Required.** Y-axis scale configuration. |
| `xAxis` | `AxisConfig` | `undefined` | X-axis appearance. |
| `yAxis` | `AxisConfig` | `undefined` | Y-axis appearance. |
| `grid` | `GridConfig` | `undefined` | Grid line configuration. |
| `tooltip` | `TooltipConfig` | `undefined` | Tooltip configuration. |
| `resize` | `ResizeConfig` | `{ enabled: true }` | Responsive resize behavior. |

---

### `ChartInstance` (returned object)

| Method | Signature | Description |
|---|---|---|
| `update` | `(params?) => void` | Triggers the update pipeline. |
| `resize` | `(width?, height?) => void` | Recalculates dimensions, updates scales/axes/clip path. |
| `destroy` | `() => void` | Removes SVG, tooltip, disconnects observer, clears listeners. |
| `renderAxesAndGrid` | `() => void` | Re-renders axes and grid with current scale domains. |
| `getDimensions` | `() => Dimensions` | Returns current dimensions. |
| `getScales` | `() => { x, y }` | Returns current D3 scale objects. |
| `getLayers` | `() => ChartLayers` | Returns D3 selections for all SVG layer groups. |
| `getClipId` | `() => string` | Returns the clip path ID. |
| `getTooltip` | `() => TooltipInstance \| null` | Returns the tooltip controller. |
| `on` / `off` | `(event, callback) => void` | Subscribe/unsubscribe to chart events. |

---

### `createZoom(chart, config?)`

Attaches zoom/pan behavior. Returns a `ZoomHandle`.

| Config | Type | Default | Description |
|---|---|---|---|
| `scaleExtent` | `[number, number]` | `[1, 100]` | Min/max zoom scale. |
| `constrainToData` | `boolean` | `true` | Prevent panning beyond data bounds. |
| `doubleClickReset` | `boolean` | `true` | Double-click resets to full view. |
| `resetDuration` | `number` | `300` | Reset animation duration (ms). |
| `onZoom` | `(xDomain, transform) => void` | — | Called on every zoom/pan event. |

### `createBrush(chart, config?)`

Attaches a horizontal brush. Returns a `BrushHandle`.

| Config | Type | Default | Description |
|---|---|---|---|
| `selectionFill` | `string` | `'rgba(0,119,190,0.15)'` | Brush fill color. |
| `onBrush` | `(selection) => void` | — | Called when selection changes. |

### `cullToViewport(data, xDomain, accessor, buffer?)`

Binary-search slice of sorted data to the visible x-domain. O(log n).

### `minMaxDownsample(data, buckets, value)`

Min/max downsampling for drawing a line: keeps each bucket's lowest and highest point in time order, plus the first missing value of a bucket so a gap stays a gap, and the first and last points. Peaks, spikes and short dropouts survive. The context chart uses it with 1000 buckets.

### `downsample(data, maxPoints)`

Uniform stride downsampling. Keeps first and last points. Can drop or flatten short peaks; for drawing a signal, prefer `minMaxDownsample`.

---

## SVG layer structure

```
<svg>
  <defs>
    <clipPath id="clip-..."><rect /></clipPath>
  </defs>
  <g transform="translate(margin.left, margin.top)">   <- root
    <g class="grid grid-x" />    <- xGrid
    <g class="grid grid-y" />    <- yGrid
    <g class="axis axis-x" />    <- xAxis
    <g class="axis axis-y" />    <- yAxis
    <g class="content"           <- content (clipped)
       clip-path="url(#clip-...)"/>
    <g class="overlay" />        <- overlay (zoom rect, brush, crosshairs)
  </g>
</svg>
```

---

## Event system

| Event | Fires when |
|---|---|
| `beforeUpdate` | `update()` called, before scales recalc |
| `afterUpdate` | After scales/axes/grid updated |
| `resize` | Container resized |
| `destroy` | `destroy()` called |
| `zoom` | Zoom/pan transform changes |
| `brushStart` / `brush` / `brushEnd` | Brush interaction lifecycle |

---

## Dependencies

Only individual D3 modules (no monolithic `d3` package):

`d3-selection`, `d3-scale`, `d3-axis`, `d3-shape`, `d3-array`, `d3-zoom`, `d3-brush`, `d3-transition`

Plus `@fontsource/ibm-plex-sans`, the page font, bundled so it works offline (its Latin and Latin Extended files declared with `@font-face` in `src/shell/tabs.css`).

The BIDS version check (`server/bids-structure.ts`) needs no package: its rules are JSON files in `server/schema-rules/`, one per BIDS version, cut down from the official [BIDS schema](https://github.com/bids-standard/bids-schema) (`server/bids-rules.ts` describes the format). 1.8.0 and later are written by `scripts/update-bids-rules.ts` from each version's compiled `schema.json`; 1.6.0 and 1.7.0, which only have the schema's YAML sources, were converted once by hand into the same format, and older versions can be added the same way. `.github/workflows/bids-rules.yml` runs the script weekly and opens a pull request when a new BIDS release appears.
