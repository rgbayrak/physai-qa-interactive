import {
  fetchSubjects,
  fetchScans,
  fetchDatasetInfo,
  fetchPhysioRaw,
  fetchConfounds,
  fetchEvents,
  fetchPeaks,
  fetchAnnotations,
  fetchAnnotationProgress,
  fetchFirstUnannotatedScan,
  fetchLaunchId,
  saveAnnotations,
  getViewExtent,
} from '@/data/bids-physio-reader';
import type { ScanEntry, PhysioRaw, ConfoundsRaw, EventsRaw, PeaksRaw } from '@/data/bids-physio-reader';
import { getElements } from './dom';
import { createState } from './state';
import {
  createAnnotation,
  toAnnotationsFile,
  fromAnnotationsFile,
  waveformAssessmentFromFile,
  NO_ASSESSMENT,
  WAVEFORM_QUALITIES,
} from './annotations';
import type { WaveformQuality } from '@/data/bids-physio-reader';
import { renderAnnotationList, progressColor } from './annotation-panel';
import { escapeHtml } from '@/utils/html';
import { renderDatasetInfo, renderQualityBadges, renderSummary } from './info';
import type { MetricsStatus } from './info';
import type { PhysioFileCount } from '@/data/bids-physio-reader';
import type { BidsStructure } from '@/data/bids-structure';
import {
  populateSelect,
  firstScanFor,
  scanLevels,
  levelValues,
  buildScanSelects,
  showScanInSelects,
  scanInSelects,
  renderStackControls,
  validStacked,
  toggleStacked,
  physioColumns,
  scanChannels,
  recordingFor,
} from './controls';
import type { ScanSelects } from './controls';
import { parseRefKey } from '@/data/recordings';
import { stepScan, resolveSearch, isScanStepKey, pickStartScan, firstUnannotatedTarget, lockedScans } from './navigation';
import {
  DEFAULT_LAST_VIEWED_KEY,
  clearOldLocalStorage,
  lastViewedKey,
  saveLastViewed,
  readLastViewed,
  resumeFrom,
} from './persistence';
import { buildFocusContext } from './charts/focus-context';
import type { FocusContextHandle } from './charts/focus-context';
import { buildConfoundsChart } from './charts/confounds';
import type { ConfoundsChartHandle } from './charts/confounds';
import { buildEventsChart } from './charts/events';
import type { EventsChartHandle } from './charts/events';
import { isRestTask, defaultEventColumn, usefulEventColumns, onlyConstantEvents } from './events';
import { peaksForChannel } from './peaks-trial';
import type { Peak } from './peaks-trial';
import { drawPeaks } from './charts/peaks-trial';
import { buildStackCharts } from './charts/stack';
import type { StackChartsHandle } from './charts/stack';
import { fetchServedDataset, fetchDatasetQuality, OutdatedMetricsError } from '@/quality/data';
import { createScatterPanel } from '@/quality/scatter-panel';
import { parseScanHash, statsUrl } from '@/quality/route';
import { scanId, sameScanKey } from '@/quality/metrics-tsv';
import { levelValue, timeReference } from '@/data/scan-key';

// Entry point: owns the DOM, the state object and the live charts, and wires
// user events to the modules that do the work.

const els = getElements();
const state = createState();

let focusContext: FocusContextHandle | null = null;
let confoundsChart: ConfoundsChartHandle | null = null;
let eventsChart: EventsChartHandle | null = null;
let stackCharts: StackChartsHandle | null = null;
let storageKey = DEFAULT_LAST_VIEWED_KEY;

// TRIAL: peaks of the loaded scan, and those matching the main channel.
// Kept here, not in state, so the trial stays in one place and is easy to remove.
let scanPeaks: PeaksRaw | null = null;
let channelPeaks: Peak[] = [];

function setLoading(msg: string) {
  els.loading.textContent = msg;
}

/** The scan controls, built once the scan list has loaded (one per entity of the dataset) */
let scanUi: ScanSelects | null = null;

/** Scan currently shown in the dropdowns; the loaded one, or the first, if they name none */
function selectedScan(): ScanEntry {
  return (scanUi && scanInSelects(scanUi, state.scans)) || state.current || state.scans[0];
}

/** The scans ←/→, search and the dropdowns go through: those with every locked value */
function navigableScans(): ScanEntry[] {
  return lockedScans(state.scans, state.locks);
}

function rememberLastViewed() {
  if (!state.current) return;
  saveLastViewed(storageKey, {
    ...state.current,
    channel: els.channelSelect.value,
    confound: els.confoundSelect.value,
    event: els.eventsSelect.value,
    stacked: state.stackedChannels,
    locks: state.locks,
  });
}

// ── Annotations ─────────────────────────────────────────

function renderAnnotations() {
  renderAnnotationList(els.annotationList, state.annotations, removeAnnotation);
}

/** Show the full-recording signal quality and notes held in state */
function renderWaveformAssessment() {
  els.waveformQuality.querySelectorAll<HTMLButtonElement>('button[data-quality]').forEach((btn) => {
    const on = btn.dataset.quality === state.waveform.quality;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  if (els.waveformComment.value !== state.waveform.comment) els.waveformComment.value = state.waveform.comment;
}

// ── Channels across recordings ─────────────────────────
// The Channel dropdown's values are channel keys (refKey: recording + column);
// a scan split into recording- files offers the channels of all of them.

/** The loaded scan's channels (keys, recording + column, shown names); empty until a scan is loaded */
let channels: ReturnType<typeof scanChannels> = [];

const labelOf = (key: string) => channels.find((c) => c.key === key)?.label ?? parseRefKey(key).channel;

/** The recording the main channel (Channel dropdown) is in */
function mainRaw(): PhysioRaw | null {
  if (!state.physio) return null;
  return recordingFor(state.physio, els.channelSelect.value) ?? state.physio.recordings[0];
}

/**
 * Datatype whose data t = 0 refers to, from the server (timeDatatype,
 * server/bids-layout.ts): the physio file's own, except beh/ physio whose
 * events come from the same acquisition's neural folder (e.g. func/)
 */
function timeDatatype(raw: PhysioRaw): string {
  return state.physio?.timeDatatype ?? raw.datatype ?? 'func';
}

/** Recording for the progress count: only when the shown name carries it (two recordings share the column) */
function progressRecording(key: string): string | undefined {
  const c = channels.find((x) => x.key === key);
  return c && c.label !== c.ref.channel ? c.ref.recording : undefined;
}

/** File name and badges of the main channel's recording */
function showRecordingInfo() {
  const raw = mainRaw();
  if (!raw) return;
  const others = (state.physio?.recordings.length ?? 1) - 1;
  els.filename.textContent = others > 0 ? `${raw.filename} (+${others} recording${others > 1 ? 's' : ''})` : raw.filename;
  renderQualityBadges(els.qualityBadges, raw);
}

function persistAnnotations() {
  if (!state.current) return;
  const file = toAnnotationsFile(
    state.annotations,
    state.current,
    parseRefKey(els.channelSelect.value),
    mainRaw()?.samplingFrequency ?? 0,
    state.waveform,
  );
  saveAnnotations(file)
    .then(refreshAnnotationProgress)
    .catch((err) => {
      console.error('Failed to save annotations', err);
      setLoading('Failed to save annotation');
    });
}

/** "(24/80 cardiac signals are annotated)": scans with anything saved for the channel shown */
async function refreshAnnotationProgress() {
  const key = els.channelSelect.value;
  if (!key) return;
  const progress = await fetchAnnotationProgress(parseRefKey(key).channel, progressRecording(key), state.locks).catch(
    () => null,
  );
  if (key !== els.channelSelect.value) return; // channel changed while waiting
  els.annotationProgress.innerHTML = progress
    ? `(${progress.annotated}/${progress.total} <span class="channel-name">${escapeHtml(labelOf(key))}</span> signals are annotated)`
    : '';
  // Mini bar: fills with the share annotated, yellow → green → blue as it grows
  const fraction = progress && progress.total > 0 ? progress.annotated / progress.total : 0;
  els.annotationProgressBar.style.width = `${(fraction * 100).toFixed(1)}%`;
  els.annotationProgressBar.style.backgroundColor = progressColor(fraction);
  els.annotationProgressBar.parentElement?.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  updateFirstUnannotatedBtn(progress?.firstUnannotated);
}

/** Scan "Go to the first unannotated scan" opens; null while it is off */
let firstUnannotatedScan: ScanEntry | null = null;

function updateFirstUnannotatedBtn(firstUnannotated: ScanEntry | null | undefined) {
  const target = firstUnannotatedTarget(state.scans, firstUnannotated, state.current);
  firstUnannotatedScan = target.scan;
  els.firstUnannotatedBtn.disabled = !target.scan;
  els.firstUnannotatedBtn.title = target.scan
    ? `Open ${scanId(target.scan)}, the first scan with nothing saved for this channel`
    : target.reason === 'current'
      ? 'This is the first scan with nothing saved for this channel'
      : 'All scans are annotated for this channel';
}

els.firstUnannotatedBtn.addEventListener('click', () => {
  if (firstUnannotatedScan) void goToScan(firstUnannotatedScan);
});

async function loadSavedAnnotations(scan: ScanEntry, key: string) {
  const stored = await fetchAnnotations(scan, parseRefKey(key)).catch(() => null);
  if (!stored) return;
  // Discard if the scan or channel changed while the request was in flight
  if (!state.current || !sameScanKey(state.current, scan) || key !== els.channelSelect.value) return;
  state.annotations = fromAnnotationsFile(stored);
  state.waveform = waveformAssessmentFromFile(stored);
  focusContext?.redrawAnnotations();
  renderAnnotations();
  renderWaveformAssessment();
}

// Whole-waveform rating: clicking the chosen rating again clears it
els.waveformQuality.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-quality]');
  if (!btn || !state.current) return;
  const q = btn.dataset.quality as WaveformQuality;
  if (!WAVEFORM_QUALITIES.includes(q)) return;
  state.waveform = { ...state.waveform, quality: state.waveform.quality === q ? null : q };
  renderWaveformAssessment();
  persistAnnotations();
});

// Whole-waveform comment: saved a moment after typing stops, and at once when
// the box loses focus (which happens before any click that changes the scan)
let commentTimer: ReturnType<typeof setTimeout> | null = null;

function flushComment() {
  if (commentTimer) clearTimeout(commentTimer);
  commentTimer = null;
  if (!state.current || els.waveformComment.value === state.waveform.comment) return;
  state.waveform = { ...state.waveform, comment: els.waveformComment.value };
  persistAnnotations();
}

els.waveformComment.addEventListener('input', () => {
  if (commentTimer) clearTimeout(commentTimer);
  commentTimer = setTimeout(flushComment, 800);
});
els.waveformComment.addEventListener('blur', flushComment);
window.addEventListener('pagehide', flushComment);

function addAnnotation(domain: [number, number]) {
  const label = window.prompt('Annotation label (e.g. "fix" to mark for reconstruction):', '');
  if (label === null) return; // cancelled: discard the selection
  state.annotations.push(createAnnotation(domain, label));
  focusContext?.redrawAnnotations();
  renderAnnotations();
  persistAnnotations();
}

function removeAnnotation(id: string) {
  state.annotations = state.annotations.filter((a) => a.id !== id);
  focusContext?.redrawAnnotations();
  renderAnnotations();
  persistAnnotations();
}

// ── Charts ──────────────────────────────────────────────

/** Push the focus chart's time window to every chart that follows it */
function syncLinkedXDomain(domain: [number, number]) {
  confoundsChart?.setXDomain(domain);
  eventsChart?.setXDomain(domain);
  stackCharts?.setXDomain(domain);
}

function destroyCharts() {
  focusContext?.destroy();
  confoundsChart?.destroy();
  eventsChart?.destroy();
  stackCharts?.destroy();
  focusContext = null;
  confoundsChart = null;
  eventsChart = null;
  stackCharts = null;
}

/** Rebuild the focus/overview charts for the main channel; clears and reloads its annotations */
function buildMainCharts() {
  const raw = mainRaw();
  if (!raw) return;
  const key = els.channelSelect.value;
  const channel = parseRefKey(key).channel;
  destroyCharts();
  // A typed comment was already saved when the box lost focus; never save it
  // here, as state.current may already be the new scan
  if (commentTimer) clearTimeout(commentTimer);
  commentTimer = null;
  state.annotations = [];
  state.waveform = { ...NO_ASSESSMENT };
  renderAnnotations();
  renderWaveformAssessment();
  // TRIAL: peaks for this channel; the toggle shows only when there are some
  channelPeaks = peaksForChannel(scanPeaks, channel, physioColumns(raw.columns));
  els.peaksLabel.style.display = channelPeaks.length > 0 ? '' : 'none';
  focusContext = buildFocusContext({
    raw,
    channel,
    label: labelOf(key),
    timeDatatype: timeDatatype(raw),
    getAnnotations: () => state.annotations,
    isAnnotateMode: () => state.annotateMode,
    onAnnotate: addAnnotation,
    onXDomainChange: syncLinkedXDomain,
    drawOverlay: (chart, group, data) => drawPeaks(chart, group, data, els.peaksToggle.checked ? channelPeaks : []),
  });
  if (state.current) loadSavedAnnotations(state.current, key);
  void refreshAnnotationProgress(); // the count is per channel
  setScatterChannel(key); // one Channel dropdown for both the charts and the scatter plot
}

// "Auxiliary" label: shown while the stacked channels, the events or the confound chart is.
// Those sections show and hide themselves from several places, so watch them.
const auxiliarySections = [els.stackSection, els.eventsSection, els.confoundsSection];
function syncAuxiliarySection() {
  const shown = auxiliarySections.some((el) => el.style.display !== 'none');
  els.auxiliarySection.style.display = shown ? '' : 'none';
}
const auxiliaryObserver = new MutationObserver(syncAuxiliarySection);
for (const el of auxiliarySections) {
  auxiliaryObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
}

// Auxiliary controls row: shown while its Event or Confound dropdown or Stack checkboxes are
const auxRowItems = [els.stackRow, els.eventsLabel, els.confoundLabel];
function syncAuxRow() {
  const shown = auxRowItems.some((el) => el.style.display !== 'none');
  els.auxRow.style.display = shown ? '' : 'none';
}
const auxRowObserver = new MutationObserver(syncAuxRow);
for (const el of auxRowItems) {
  auxRowObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
}

function rebuildStack() {
  const physio = state.physio;
  const raw = mainRaw();
  if (!physio || !raw) return;
  stackCharts?.destroy();
  // Each stacked channel is drawn from its own recording (its own rate and StartTime)
  const items = state.stackedChannels.flatMap((key) => {
    const rec = recordingFor(physio, key);
    return rec ? [{ raw: rec, channel: parseRefKey(key).channel, label: labelOf(key) }] : [];
  });
  stackCharts = buildStackCharts({
    sectionEl: els.stackSection,
    items,
    xDomain: focusContext ? focusContext.getXDomain() : getViewExtent(raw),
  });
}

function rebuildConfounds(confounds: ConfoundsRaw) {
  const raw = mainRaw();
  if (!raw) return;
  confoundsChart?.destroy();
  confoundsChart = buildConfoundsChart({
    sectionEl: els.confoundsSection,
    labelEl: els.confoundsLabel,
    confounds,
    raw,
    column: els.confoundSelect.value,
  });
}

function rebuildEvents(events: EventsRaw) {
  const raw = mainRaw();
  if (!raw) return;
  eventsChart?.destroy();
  eventsChart = buildEventsChart({
    sectionEl: els.eventsSection,
    labelEl: els.eventsFileLabel,
    legendEl: els.eventsLegend,
    events,
    column: els.eventsSelect.value,
    xDomain: focusContext ? focusContext.getXDomain() : getViewExtent(raw),
    axisLabel: timeReference(timeDatatype(raw)).axisLabel,
  });
}

function renderStack() {
  const keys = channels.map((c) => c.key);
  state.stackedChannels = validStacked(state.stackedChannels, keys, els.channelSelect.value);
  renderStackControls(
    els,
    keys,
    els.channelSelect.value,
    state.stackedChannels,
    (key, checked) => {
      state.stackedChannels = toggleStacked(state.stackedChannels, keys, key, checked);
      rebuildStack();
      rememberLastViewed();
    },
    labelOf,
  );
}

/** Every chart again for the loaded scan, e.g. after the main channel changed */
function rebuildAllCharts() {
  buildMainCharts();
  rebuildStack();
  if (state.events) rebuildEvents(state.events);
  else els.eventsSection.style.display = 'none';
  if (state.confounds) rebuildConfounds(state.confounds);
  else els.confoundsSection.style.display = 'none';
}

// ── Data loading ────────────────────────────────────────

/** First option among the preferred ones that the scan has, else its first option */
function pickPreferred(options: string[], preferred: (string | undefined)[]): string {
  return preferred.find((c): c is string => !!c && options.includes(c)) ?? options[0];
}

async function loadPhysio(scan: ScanEntry) {
  // Same scan already loaded (e.g. dropdown re-selected): rebuild from cache
  if (state.current && sameScanKey(state.current, scan) && state.physio) {
    rebuildAllCharts();
    return;
  }

  setLoading('Loading...');
  try {
    const [physio, confounds, events, peaks] = await Promise.all([
      fetchPhysioRaw(scan),
      fetchConfounds(scan),
      // Rest (or no task) has no task events; a missing events file is not an error
      !scan.task || isRestTask(scan.task) ? null : fetchEvents(scan).catch(() => null),
      fetchPeaks(scan).catch(() => null), // TRIAL
    ]);
    state.physio = physio;
    state.confounds = confounds;
    state.events = events;
    scanPeaks = peaks;
    state.current = { ...scan };
    scatterPanel.setCurrentScan(state.current); // its point turns pinkish red
    els.statsTab.setAttribute('href', statsUrl(scan)); // Stats opens this same scan

    // Keep the current channel/confound when the new scan has it; on the first
    // load after a reload, prefer the one restored from localStorage.
    // Every column of every recording except trigger, time etc. is offered
    // (same exclusions as the metrics)
    const restored = state.restoredSelection;
    channels = scanChannels(physio);
    const keys = channels.map((c) => c.key);
    populateSelect(els.channelSelect, keys, pickPreferred(keys, [restored?.channel, els.channelSelect.value]), labelOf);
    if (restored) state.stackedChannels = restored.stacked;
    showRecordingInfo();
    renderStack();
    buildMainCharts();
    rebuildStack();

    // Counters such as trial_number and constants are left out of the dropdown
    const eventColumns = events ? usefulEventColumns(events) : [];
    if (events && onlyConstantEvents(events)) {
      // Nothing but constant columns (e.g. trial_type = movie on every row): hide the picker and the figure
      els.eventsSelect.innerHTML = '';
      els.eventsLabel.style.display = 'none';
      els.eventsSection.style.display = 'none';
    } else if (events && eventColumns.length > 0) {
      populateSelect(
        els.eventsSelect,
        eventColumns,
        pickPreferred(eventColumns, [restored?.event, els.eventsSelect.value, defaultEventColumn(events)]),
      );
      els.eventsLabel.style.display = '';
      rebuildEvents(events);
    } else if (events) {
      // Only onset/duration (or only counters): draw the events, nothing to pick
      els.eventsSelect.innerHTML = '';
      els.eventsLabel.style.display = 'none';
      rebuildEvents(events);
    } else {
      // Rest task or no events file: hide the picker and the figure
      els.eventsLabel.style.display = 'none';
      els.eventsSection.style.display = 'none';
    }

    if (confounds) {
      const columns = Object.keys(confounds.columns);
      populateSelect(els.confoundSelect, columns, pickPreferred(columns, [restored?.confound, els.confoundSelect.value]));
      els.confoundLabel.style.display = '';
      rebuildConfounds(confounds);
    } else {
      // No derivatives for this scan (or no BIDSDER_ROOT): hide the picker
      els.confoundLabel.style.display = 'none';
      els.confoundsSection.style.display = 'none';
    }

    state.restoredSelection = null;
    rememberLastViewed();
    // Recordings the server could not read (corrupt, not downloaded): the scan shows the others
    setLoading(physio.skipped.length ? `Not loaded: ${physio.skipped.map((s) => `${s.filename} (${s.reason})`).join('; ')}` : '');
  } catch (err) {
    setLoading(`Error: ${err instanceof Error ? err.message : err}`);
  }
}

function goToScan(scan: ScanEntry) {
  if (scanUi) showScanInSelects(scanUi, state.scans, scan, state.locks);
  return loadPhysio(scan);
}

function step(delta: number) {
  return goToScan(stepScan(navigableScans(), selectedScan(), delta));
}

// ── Event wiring ────────────────────────────────────────

// Changing a scan dropdown opens the first scan (hierarchy order) with the new
// choice, the values of the dropdowns before it and every lock. Changing a
// locked dropdown moves its lock to the new value.
function onScanLevelChange(level: string) {
  if (!scanUi) return;
  const { levels, selects } = scanUi;
  const wanted = levelValues(selectedScan(), levels);
  for (const l of levels.slice(0, levels.findIndex((x) => x.key === level) + 1)) {
    const select = selects.get(l.key);
    if (select) wanted[l.key] = select.value;
  }
  if (level in state.locks) state.locks = { ...state.locks, [level]: wanted[level] };
  const scan = firstScanFor(state.scans, levels, wanted, level, state.locks);
  if (scan) void goToScan(scan);
}

// A lock keeps the loaded scan's value of that level; clicking again frees it
function onLockToggle(level: string) {
  if (!scanUi || !state.current) return;
  const { [level]: had, ...rest } = state.locks;
  state.locks = had === undefined ? { ...state.locks, [level]: levelValue(state.current, level) } : rest;
  showScanInSelects(scanUi, state.scans, state.current, state.locks);
  void refreshAnnotationProgress(); // the count and "first unannotated" follow the locks
  rememberLastViewed();
}

els.channelSelect.addEventListener('change', () => {
  if (state.physio) {
    // The new main channel leaves the stack options (and the stack, if checked);
    // it may be in another recording, with its own file, rate and timing badge
    showRecordingInfo();
    renderStack();
    rebuildAllCharts();
  }
  rememberLastViewed();
});

// TRIAL: show or hide the peak dots on the main chart
els.peaksToggle.addEventListener('change', () => focusContext?.redrawOverlay());

els.eventsSelect.addEventListener('change', () => {
  if (state.events) rebuildEvents(state.events);
  rememberLastViewed();
});

els.confoundSelect.addEventListener('change', () => {
  if (state.confounds) rebuildConfounds(state.confounds);
  rememberLastViewed();
});

els.prevBtn.addEventListener('click', () => step(-1));
els.nextBtn.addEventListener('click', () => step(1));

// ←/→ step to the previous/next scan, except while typing or in a dropdown
// (where arrow keys already have a meaning)
document.addEventListener('keydown', (e) => {
  if (!isScanStepKey(e)) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
  step(e.key === 'ArrowLeft' ? -1 : 1);
});

els.searchInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const q = els.searchInput.value.trim();
  if (!q) return;
  const match = resolveSearch(q, navigableScans(), levelValue(selectedScan(), 'sub'));
  if (!match) {
    setLoading(`No match for "${q}"`);
    return;
  }
  await goToScan(match);
  els.searchInput.value = '';
});

els.annotateModeBtn.addEventListener('click', () => {
  state.annotateMode = !state.annotateMode;
  els.annotateModeBtn.classList.toggle('active', state.annotateMode);
  els.annotateModeBtn.textContent = state.annotateMode ? 'Annotate: On' : 'Annotate: Off';
});

// ── Quality metrics: Stats tab and scatter plot ─────────

// Follows the page's Channel dropdown; double-clicking a point opens that scan in Stats
const scatterPanel = createScatterPanel(
  {
    xSelect: els.scatterX,
    ySelect: els.scatterY,
    colorSelect: els.scatterColor,
    chart: els.scatterChart,
    legend: els.scatterLegend,
    note: els.scatterNote,
  },
  (scan) => {
    location.href = statsUrl(scan);
  },
);

/**
 * Show the Stats tab and the scatter plot only when the served dataset's
 * quality metrics have been computed (scripts/compute-quality-metrics.ts);
 * otherwise both stay hidden.
 */
async function loadQualityMetrics() {
  const served = await fetchServedDataset().catch(() => null);
  if (!served) return;
  let outdated = false;
  const data = await fetchDatasetQuality(served.id).catch((err) => {
    outdated = err instanceof OutdatedMetricsError;
    return null;
  });
  summaryMetrics = data ? { found: true, lastRun: data.lastRun } : { found: false, outdated };
  refreshSummary();
  if (!data) return;
  els.statsTab.style.display = '';
  els.scatterSection.style.display = ''; // visible before drawing, so the plot takes the section's width
  scatterPanel.setCurrentScan(state.current); // highlight the scan already open, if any
  setScatterChannel(els.channelSelect.value); // same channel as the charts above
  scatterPanel.show(data);
}

// Dataset summary: the facts arrive separately (dataset info with the BIDS structure check, quality metrics)
let summaryCount: PhysioFileCount | undefined;
let summaryMetrics: MetricsStatus | undefined;
let summaryStructure: BidsStructure | undefined;
function refreshSummary() {
  renderSummary(els.datasetSummary, els.datasetSummaryLines, summaryCount, summaryMetrics, summaryStructure);
}

/** Plot the scatter for this channel and name it in the heading */
/**
 * Plot the scatter for a channel key (the Channel dropdown's value: recording
 * + tab + column for a split scan) and name it in the heading. The plot and the
 * metrics rows use the shown name (labelOf), never the key itself.
 */
function setScatterChannel(key: string) {
  const label = labelOf(key);
  els.scatterChannel.textContent = label;
  scatterPanel.setChannel(label);
}

// ── Init ────────────────────────────────────────────────

async function init() {
  void loadQualityMetrics(); // independent of the scan loading below
  setLoading('Loading subjects...');
  const [subjects, scans, datasetInfo, launch] = await Promise.all([
    fetchSubjects(),
    fetchScans(),
    fetchDatasetInfo().catch(() => null),
    fetchLaunchId().catch(() => ''),
  ]);
  state.subjects = subjects;
  state.scans = scans;
  scanUi = buildScanSelects(els.scanSelects, scanLevels(scans), onScanLevelChange, onLockToggle);
  renderDatasetInfo(els.datasetInfo, datasetInfo);
  summaryCount = datasetInfo?.physioFiles;
  summaryStructure = datasetInfo?.structure;
  refreshSummary();

  // This visit's choices (channel, confound, events column, stack, locks): kept
  // while switching tabs, gone on a new launch (src/viewer/persistence.ts)
  clearOldLocalStorage([DEFAULT_LAST_VIEWED_KEY]);
  storageKey = lastViewedKey(datasetInfo?.name, launch);
  const resumed = resumeFrom(readLastViewed(storageKey), scans);
  if (resumed) {
    state.restoredSelection = resumed.selection;
    state.locks = resumed.locks; // only those some scan still has (resumeFrom)
  }

  // Which scan to open: the one linked from Stats (#scan?…), else this visit's
  // last scan (a reload); on a new launch, the first scan without annotations
  // in any channel, else the first. The locks always stay: a linked scan
  // without the locked values (e.g. from a scatter double-click) gives way to
  // the visit's last scan, which has them
  const hashScan = parseScanHash(location.hash);
  if (hashScan) history.replaceState(null, '', location.pathname); // a reload then follows the rules below
  const linked = hashScan && lockedScans([hashScan], state.locks).length ? hashScan : null;
  const firstUnannotated =
    !linked && !resumed ? await fetchFirstUnannotatedScan(state.locks).catch(() => null) : null;
  const first = pickStartScan(navigableScans(), {
    linked,
    firstUnannotated,
    lastViewed: resumed?.scan,
  });
  if (!first) {
    setLoading('No scans with readable physio files in this dataset.');
    return;
  }
  await goToScan(first);
}

init().catch((err) => setLoading(`Error: ${err}`));
