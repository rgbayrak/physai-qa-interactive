import { fetchServedDataset, fetchDatasetQuality, fetchReportStatus, saveReport, OutdatedMetricsError } from './data';
import type { LoadedDataset, ServedDataset } from './data';
import { shareScanWithViewer, viewerLocks, viewerScan } from './linked-scan';
import { clearOldLocalStorage, sessionStore } from '@/viewer/persistence';
import type { MetricPicker } from './metric-picker';
import { parseScanHash, scanHash, viewerUrl } from './route';
import type { ScanKeyLike } from './metrics-tsv';
import { sameScanKey } from './metrics-tsv';
import { createIndividualTab } from './individual-tab';
import { buildQualityReport } from './report';
import { createMetricPicker } from './metric-picker';
import { esc, parseVisibleMetrics, serializeVisibleMetrics } from './model';
import { runSentence } from './run-log';
import { fetchDatasetInfo, fetchLaunchId } from '@/data/bids-physio-reader';
import { renderDatasetInfo } from '@/viewer/info';
import type { VisibleMetrics } from './model';

// Entry for quality.html (the Stats tab): owns the page elements, the hash
// (#scan?sub=…) and the loaded dataset (the one the dev server serves);
// individual-tab.ts does the rendering.

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from quality.html`);
  return el as T;
}

const els = {
  reportStatus: byId<HTMLElement>('report-status'),
  /** "Quality metrics were last computed on … for 78 of 120 scans …" */
  metricsRun: byId<HTMLElement>('metrics-run'),
  metricsRunBlock: byId<HTMLElement>('metrics-run-block'),
  datasetInfo: byId<HTMLElement>('dataset-info'),
  status: byId<HTMLElement>('status'),
  /** "Open this scan in Explore and Annotate" */
  openViewer: byId<HTMLAnchorElement>('open-viewer'),
  /** The "Explore and Annotate" folder tab */
  viewerTab: byId<HTMLAnchorElement>('viewer-tab'),
};

// Metrics shown: which metrics the Stats tables and histograms show; kept for
// this visit only (sessionStorage, keyed by the dev server launch, like the
// viewer's choices in src/viewer/persistence.ts): a new launch shows the default set
const VISIBLE_METRICS_KEY = 'physai-quality-visible-metrics';
/** This dev server launch (/api/bids/launch); '' until known */
let launch = '';

function readVisibleMetrics(): VisibleMetrics {
  try {
    return parseVisibleMetrics(sessionStore()?.getItem(`${VISIBLE_METRICS_KEY}:${launch}`) ?? null);
  } catch {
    return parseVisibleMetrics(null);
  }
}

function saveVisibleMetrics(visible: VisibleMetrics) {
  try {
    sessionStore()?.setItem(`${VISIBLE_METRICS_KEY}:${launch}`, serializeVisibleMetrics(visible));
  } catch {
    // storage unavailable (private window); the choice just won't be kept
  }
}

/** Built once the launch is known (init), so it starts from this visit's ticks */
let metricPicker: MetricPicker | null = null;

function createPicker() {
  metricPicker = createMetricPicker(byId<HTMLElement>('metric-picker'), readVisibleMetrics(), (visible) => {
    saveVisibleMetrics(visible);
    // Keep the page exactly where it is: the redraw changes the graphs' height,
    // and the browser would otherwise shift or clamp the scroll position
    const y = window.scrollY;
    // Only the metric tables and histograms change: no full redraw
    statsTab.refreshMetrics();
    window.scrollTo(0, y);
  });
}

const statsTab = createIndividualTab(
  {
    prevBtn: byId('scan-prev'),
    nextBtn: byId('scan-next'),
    filename: byId('subject-filename'),
    participant: byId('subject-participant'),
    scanDetails: byId('subject-scan'),
    waveforms: byId('subject-waveforms'),
    metrics: byId('subject-metrics'),
  },
  openScan,
  () => metricPicker?.visible() ?? parseVisibleMetrics(null),
);

/** The dataset the dev server serves (same as Explore and Annotate) and its loaded metrics */
let served: ServedDataset | null = null;
let data: LoadedDataset | null = null;
/** Scan last drawn, to tell a new scan from a redraw of the same one */
let lastScan: ScanKeyLike | null = null;

function openScan(scan: ScanKeyLike) {
  location.hash = scanHash(scan);
}

function setStatus(html: string) {
  els.status.innerHTML = html;
  els.status.style.display = html ? '' : 'none';
}

function showScanFromHash(): void {
  if (!served || !data) return;
  // No scan in the link: open the one last shown in Explore and Annotate (this visit)
  const wanted = parseScanHash(location.hash) ?? viewerScan(served.name, undefined, launch);
  // Prev/Next follow the viewer's locks, so the scan taken back always has them
  const shown = statsTab.show(served.id, data, wanted, viewerLocks(served.name, undefined, launch));
  // ...and make Explore and Annotate open the scan shown here: both links name it
  if (shown) {
    shareScanWithViewer(served.name, shown, undefined, launch);
    els.openViewer.href = viewerUrl(shown);
    els.viewerTab.href = viewerUrl(shown);
  }
  // Back to the top only when a different scan opens (Prev/Next, a scatter double-click)
  if (!shown || !lastScan || !sameScanKey(shown, lastScan)) window.scrollTo(0, 0);
  lastScan = shown;
}

window.addEventListener('hashchange', showScanFromHash);

// PDF report: built once per computed dataset and saved by the dev server next
// to the metrics (data/quality/<dataset>/quality_report.pdf). The compute script
// deletes it, so a missing file means new metrics: build it in the background.
function showReportLink(url: string) {
  els.reportStatus.innerHTML =
    `Saved with the metrics. <a href="${esc(url)}" target="_blank" rel="noopener">Open the PDF report</a>`;
}

async function ensureReport() {
  if (!served || !data) return;
  const status = await fetchReportStatus();
  if (!status) {
    els.reportStatus.textContent = 'The dev server cannot save the PDF report.';
    return;
  }
  if (status.exists) {
    showReportLink(status.url);
    return;
  }
  try {
    const pdf = await buildQualityReport({
      dataset: served.id,
      data,
      onProgress: (msg) => {
        els.reportStatus.textContent = `Building the PDF report: ${msg}…`;
      },
    });
    els.reportStatus.textContent = 'Saving the PDF report…';
    showReportLink((await saveReport(pdf)).url);
  } catch (err) {
    console.error(err);
    els.reportStatus.textContent = `Could not build the PDF report: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function init() {
  const [servedDataset, datasetInfo, launchId] = await Promise.all([
    fetchServedDataset().catch(() => null),
    fetchDatasetInfo().catch(() => null),
    fetchLaunchId().catch(() => ''),
  ]);
  served = servedDataset;
  launch = launchId;
  clearOldLocalStorage([VISIBLE_METRICS_KEY]);
  createPicker();
  // Dataset header under the tabs, same as Explore and Annotate
  renderDatasetInfo(els.datasetInfo, datasetInfo);
  if (!els.datasetInfo.hasChildNodes() && served) els.datasetInfo.textContent = served.id;
  if (!served) {
    setStatus('Could not ask the dev server which dataset it serves. Start it with <code>npm run dev</code>.');
    return;
  }
  setStatus(`Loading ${esc(served.id)}…`);
  let outdated = false;
  data = await fetchDatasetQuality(served.id).catch((err) => {
    outdated = err instanceof OutdatedMetricsError;
    return null;
  });
  if (!data) {
    const command = `<code>npx vite-node scripts/compute-quality-metrics.ts ${esc(served.id)}</code>`;
    setStatus(
      outdated
        ? `The quality metrics for <strong>${esc(served.id)}</strong> were computed by an older version and cannot be read. ` +
            `Compute them again with ${command} and reload.`
        : `No quality metrics for <strong>${esc(served.id)}</strong> yet. Compute them with ${command} and reload.`,
    );
    return;
  }
  setStatus('');
  // When the metrics were last computed, and for how many of the listed scans
  els.metricsRun.textContent = data.lastRun ? runSentence(data.lastRun) : '';
  els.metricsRunBlock.style.display = data.lastRun ? '' : 'none';
  showScanFromHash();
  void ensureReport(); // after the scan is drawn, so the page is usable while it builds
}

void init();
