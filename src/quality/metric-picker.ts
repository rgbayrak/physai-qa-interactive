import type { MetricKey } from './metrics-tsv';
import { ALL_METRICS, METRIC_DEFS, esc, metricNameWithSource, metricTooltip } from './model';
import type { VisibleMetrics } from './model';

// "Metrics shown" list in the sidebar: one row per metric, named with its paper
// (hover: description and paper), a checkmark on the right, plus Show all /
// Hide all. Receives its element and reports changes; main.ts decides what to redraw.

export interface MetricPicker {
  visible: () => VisibleMetrics;
}

export function createMetricPicker(
  el: HTMLElement,
  initial: VisibleMetrics,
  onChange: (visible: VisibleMetrics) => void,
): MetricPicker {
  let visible: Set<MetricKey> = new Set(initial);

  const body = () => {
    let html = `<div class="metric-picker-actions">
        <button type="button" class="btn" data-action="all">Show all</button>
        <button type="button" class="btn" data-action="none">Hide all</button>
      </div>
      <div class="metric-count muted"></div>`;
    for (const def of METRIC_DEFS) {
      const tip = metricTooltip(def);
      const title = tip ? ` title="${esc(tip)}"` : '';
      html += `<label class="metric-row"${title}><span>${esc(metricNameWithSource(def))}</span><input type="checkbox" class="metric-check" data-key="${def.key}"></label>`;
    }
    return html;
  };

  /** Bring the checkmarks and the count in line with `visible` */
  function sync() {
    el.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((cb) => {
      cb.checked = visible.has(cb.dataset.key as MetricKey);
    });
    el.querySelector('.metric-count')!.textContent = `${visible.size} of ${ALL_METRICS.length} shown`;
  }

  function set(next: Set<MetricKey>) {
    visible = next;
    sync();
    onChange(visible);
  }

  el.classList.add('metric-picker');
  el.innerHTML = body();
  sync();

  el.addEventListener('change', (event) => {
    const cb = event.target as HTMLInputElement;
    if (!cb.dataset.key) return;
    const next = new Set(visible);
    if (cb.checked) next.add(cb.dataset.key as MetricKey);
    else next.delete(cb.dataset.key as MetricKey);
    set(next);
  });
  el.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).dataset?.action;
    if (action === 'all') set(new Set(ALL_METRICS));
    else if (action === 'none') set(new Set());
  });

  return { visible: () => visible };
}
