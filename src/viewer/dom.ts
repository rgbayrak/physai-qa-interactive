/** Every element the viewer uses from index.html */
interface ViewerElements {
  /** Holds the scan controls, built per dataset (buildScanSelects, src/viewer/controls.ts) */
  scanSelects: HTMLElement;
  channelSelect: HTMLSelectElement;
  confoundSelect: HTMLSelectElement;
  confoundLabel: HTMLLabelElement;
  /** Events column dropdown and its "EVENT" label in the Auxiliary row */
  eventsSelect: HTMLSelectElement;
  eventsLabel: HTMLLabelElement;
  /** PHYSIO EVENTS row: "Show peaks" for the events file's peaks (src/viewer/peaks-trial.ts) */
  peaksToggle: HTMLInputElement;
  eventsPeaksRow: HTMLElement;
  /** BUILT-IN PEAK DETECTION row and its "Show peaks" box (src/viewer/detected-peaks.ts) */
  detectedPeaksRow: HTMLElement;
  detectedPeaksToggle: HTMLInputElement;
  /** "On disk data summary" under the dataset header, and its lines: downloaded recordings and quality metrics coverage */
  datasetSummary: HTMLElement;
  datasetSummaryLines: HTMLElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  searchInput: HTMLInputElement;
  datasetInfo: HTMLElement;
  filename: HTMLElement;
  /** "(24/80 cardiac signals are annotated)" under the Annotations title */
  annotationProgress: HTMLElement;
  /** Its mini progress bar (fill width and colour) */
  annotationProgressBar: HTMLElement;
  /** "Go to the first unannotated scan", under the progress bar */
  firstUnannotatedBtn: HTMLButtonElement;
  qualityBadges: HTMLElement;
  loading: HTMLElement;
  confoundsSection: HTMLElement;
  confoundsLabel: HTMLElement;
  /** Events figure: its section, file name and colour key */
  eventsSection: HTMLElement;
  eventsFileLabel: HTMLElement;
  eventsLegend: HTMLElement;
  annotateModeBtn: HTMLButtonElement;
  annotationList: HTMLElement;
  /** Holds the Good / Bad / Fixable / Unknown buttons (data-quality) */
  waveformQuality: HTMLElement;
  waveformComment: HTMLTextAreaElement;
  stackRow: HTMLElement;
  /** Controls row labelled Auxiliary: holds the Event and Confound dropdowns and the Stack checkboxes */
  auxRow: HTMLElement;
  stackChannels: HTMLElement;
  stackSection: HTMLElement;
  /** Wraps the stack, events and confounds sections under the "Auxiliary" label */
  auxiliarySection: HTMLElement;
  /** Stats folder tab and the scatter plot: shown only when quality metrics exist */
  statsTab: HTMLElement;
  scatterSection: HTMLElement;
  /** Channel name in the scatter heading */
  scatterChannel: HTMLElement;
  scatterX: HTMLSelectElement;
  scatterY: HTMLSelectElement;
  scatterColor: HTMLSelectElement;
  scatterChart: HTMLElement;
  scatterLegend: HTMLElement;
  scatterNote: HTMLElement;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Viewer: #${id} is missing from index.html`);
  return el as T;
}

/** Look up all viewer elements once; throws naming the first one that is missing */
export function getElements(): ViewerElements {
  return {
    scanSelects: byId('scan-selects'),
    channelSelect: byId('channel-select'),
    confoundSelect: byId('confound-select'),
    confoundLabel: byId('confound-label'),
    eventsSelect: byId('events-select'),
    eventsLabel: byId('events-label'),
    peaksToggle: byId('peaks-toggle'),
    eventsPeaksRow: byId('events-peaks-row'),
    detectedPeaksRow: byId('detected-peaks-row'),
    detectedPeaksToggle: byId('detected-peaks-toggle'),
    datasetSummary: byId('dataset-summary'),
    datasetSummaryLines: byId('dataset-summary-lines'),
    prevBtn: byId('prev-btn'),
    nextBtn: byId('next-btn'),
    searchInput: byId('search-input'),
    datasetInfo: byId('dataset-info'),
    filename: byId('filename'),
    annotationProgress: byId('annotation-progress'),
    annotationProgressBar: byId('annotation-progress-bar'),
    firstUnannotatedBtn: byId('first-unannotated-btn'),
    qualityBadges: byId('quality-badges'),
    loading: byId('loading'),
    confoundsSection: byId('confounds-section'),
    confoundsLabel: byId('confounds-label'),
    eventsSection: byId('events-section'),
    eventsFileLabel: byId('events-file-label'),
    eventsLegend: byId('events-legend'),
    annotateModeBtn: byId('annotate-mode-btn'),
    annotationList: byId('annotation-list'),
    waveformQuality: byId('waveform-quality'),
    waveformComment: byId('waveform-comment'),
    stackRow: byId('stack-row'),
    auxRow: byId('aux-row'),
    stackChannels: byId('stack-channels'),
    stackSection: byId('stack-section'),
    auxiliarySection: byId('auxiliary-section'),
    statsTab: byId('stats-tab'),
    scatterSection: byId('scatter-section'),
    scatterChannel: byId('scatter-channel'),
    scatterX: byId('scatter-x'),
    scatterY: byId('scatter-y'),
    scatterColor: byId('scatter-color'),
    scatterChart: byId('scatter-chart'),
    scatterLegend: byId('scatter-legend'),
    scatterNote: byId('scatter-note'),
  };
}
