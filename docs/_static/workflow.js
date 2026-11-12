/* Typical workflow diagram for the Overview page (docs/overview.md).
   Drawn with D3 in the manner of Mike Bostock's examples: data first, then a
   layout, then marks; d3.linkHorizontal and B-spline (curveBasis) paths, and
   a draw-on transition the first time it appears.

   Look: numbered "stations" on cream paper with watercolour washes per stage.
   Palette from the logo's navy: indigo (set up), its near-complement
   terracotta (review), analogous saffron (compare), and muted sage (outputs).
   Output rings take the colour of the stage that writes them.

   Three columns when wide, one column when narrow; redrawn on resize. Each
   step links to its section. Links are relative to
   docs/overview.html. */
(function () {
  'use strict';
  const root = document.getElementById('workflow-diagram');
  if (!root || typeof d3 === 'undefined') return;

  const PAPER = '#f7f2e8';
  const INK = '#a39a8c'; // warm grey for plain flow
  const COLORS = {
    setup: '#24427a',   // indigo, from the logo's navy
    review: '#c4573a',  // terracotta
    compare: '#d99a2b', // saffron
    outputs: '#5f7f6a', // sage
  };
  // Light tints of each stage colour for the washes (a low-opacity indigo on
  // cream turns grey, so the tints are mixed rather than faded)
  const WASHES = {
    setup: '#cdd6ee',   // periwinkle
    review: '#f3cdbd',  // peach
    compare: '#f4e0b4', // wheat
    outputs: '#d3e2d1', // pale sage
  };
  const STAGES = {
    setup: ['1', 'Set up'],
    review: ['2', 'Review each scan'],
    compare: ['3', 'Compare across the dataset', 'Optional'],
    outputs: ['', 'Outputs'],
  };

  const STEPS = [
    { id: 'install', stage: 'setup', n: 1, title: 'Install',
      lines: ['Node.js 22, git clone,', 'then npm install'],
      href: 'get-started.html#install' },
    { id: 'dataset', stage: 'setup', n: 2, title: 'Choose a dataset',
      lines: ['Is it a BIDS-compliant dataset?'],
      href: 'user-guide/start.html#step-1-choose-a-dataset' },
    { id: 'start', stage: 'setup', n: 3, title: 'Start the tool',
      lines: ['BIDS_ROOT=… npm run dev,', 'then open localhost:5173'],
      href: 'user-guide/start.html#step-2-start-the-tool' },
    { id: 'pick', stage: 'review', n: 4, title: 'Navigate',
      lines: ['Prev / Next, search, or Go to the', 'first unannotated scan'],
      href: 'user-guide/explore-and-annotate.html#moving-between-scans' },
    { id: 'inspect', stage: 'review', n: 5, title: 'Inspect',
      lines: ['Zoom and scroll; check the Timing', 'badge, Event, Confound and Stack'],
      href: 'user-guide/explore-and-annotate.html#auxiliary-signal-options' },
    { id: 'annotate', stage: 'review', n: 6, title: 'Annotate',
      lines: ['Signal Quality and Notes for the', 'recording; label time windows'],
      href: 'user-guide/explore-and-annotate.html#annotations' },
    { id: 'compute', stage: 'compare', n: 7, title: 'Compute the metrics', optional: true,
      lines: ['Once per dataset, in a second', 'terminal; then reload the page'],
      href: 'user-guide/quality-metrics.html#computing-the-metrics' },
    { id: 'scatter', stage: 'compare', n: 8, title: 'Scatter plot',
      lines: ['Two metrics, or a metric against', 'age or sex; spot unusual scans'],
      href: 'user-guide/quality-metrics.html#scatter-plot' },
    { id: 'stats', stage: 'compare', n: 9, title: 'Stats tab',
      lines: ['One scan: waveforms, metrics and', 'where it sits in the dataset'],
      href: 'user-guide/quality-metrics.html#stats-tab' },
    { id: 'annotations', stage: 'outputs', from: 'review', title: 'Annotation files', output: true,
      lines: ['One JSON per scan and channel'],
      href: 'user-guide/datasets.html#where-files-are-saved' },
    { id: 'metrics', stage: 'outputs', from: 'compare', title: 'Metrics files and PDF report', output: true,
      lines: ['quality_metrics.tsv, run log, PDF'],
      href: 'user-guide/quality-metrics.html#what-it-writes' },
  ];
  const byId = Object.fromEntries(STEPS.map((s) => [s.id, s]));

  // kind: 'loop' and 'review' (terracotta), 'compare' (saffron), else ink
  const LINKS = [
    { source: 'install', target: 'dataset' },
    { source: 'dataset', target: 'start' },
    { source: 'pick', target: 'inspect', kind: 'review' },
    { source: 'inspect', target: 'annotate', kind: 'review' },
    { source: 'annotate', target: 'pick', kind: 'loop', label: 'next scan' },
    { source: 'compute', target: 'scatter', kind: 'compare', label: 'unlocks 8 and 9' },
    { source: 'scatter', target: 'stats', kind: 'compare', label: 'double-click a point' },
    { source: 'annotate', target: 'annotations', kind: 'out', wideOnly: true },
    { source: 'compute', target: 'metrics', kind: 'out', wideOnly: true },
  ];

  const R = 14;            // station radius
  const WIDE_MIN = 900;
  const WIDE_MAX = 1100;
  const NARROW_MIN = 380;  // narrower screens scale the drawing down

  const linkColor = (l) => {
    if (l.kind === 'loop' || l.kind === 'review') return COLORS.review;
    if (l.kind === 'compare') return COLORS.compare;
    return INK;
  };
  const ringColor = (s) => COLORS[s.from || s.stage];

  // ---- Layouts: a centre (cx, cy) per station, the right edge of its text
  // (ex), stage titles, washes and the troubleshooting note

  function layoutWide(width) {
    const W = Math.min(width, WIDE_MAX);
    const m = 26; // inner margin, so the washes stay on the paper
    const gap = 80;
    const colW = (W - 2 * m - 2 * gap) / 3;
    const colX = [m, m + colW + gap, m + 2 * (colW + gap)];
    const top = 80;
    const row = 104;
    const place = {
      install: [0, 0], dataset: [0, 1], start: [0, 2],
      pick: [1, 0], inspect: [1, 1], annotate: [1, 2],
      compute: [2, 0], scatter: [2, 1], stats: [2, 2],
    };
    const pos = {};
    for (const [id, [c, r]] of Object.entries(place)) {
      pos[id] = { col: c, cx: colX[c] + R + 6, cy: top + r * row + R, ex: colX[c] + colW };
    }
    // Washes: about 20 px of clear margin around the stations, their text and
    // the troubleshooting note; the review wash also holds the loop's line
    const washTop = top - 26;
    const washH = 2 * row + 124;
    const outCy = washTop + washH + 58;
    pos.annotations = { col: 1, cx: colX[1] + R + 6, cy: outCy, ex: colX[1] + colW };
    pos.metrics = { col: 2, cx: colX[2] + R + 6, cy: outCy, ex: colX[2] + colW };
    return {
      W, H: outCy + 44, pos, wide: true,
      titles: [
        { stage: 'setup', x: colX[0] + 6, y: 34 },
        { stage: 'review', x: colX[1] + 6, y: 34 },
        { stage: 'compare', x: colX[2] + 6, y: 34 },
        { stage: 'outputs', x: colX[0] + 6, y: outCy + 6 },
      ],
      washes: [
        { stage: 'setup', x: colX[0] - 20, y: washTop, w: colW + 40, h: washH },
        { stage: 'review', x: colX[1] - 36, y: washTop, w: colW + 56, h: washH },
        { stage: 'compare', x: colX[2] - 20, y: washTop, w: colW + 40, h: washH },
        // Outputs: one band across, with the "Outputs" title inside it
        { stage: 'outputs', x: colX[0] - 20, y: outCy - 34, w: colX[2] + colW - colX[0] + 40, h: 68 },
      ],
      note: { x: colX[0] + R * 2 + 18, y: top + 2 * row + R + 62 },
    };
  }

  function layoutNarrow(width) {
    const W = Math.max(width, NARROW_MIN);
    const left = 70; // room for the side routes
    const cx = left + R;
    const order = [
      ['setup', ['install', 'dataset', 'start']],
      ['review', ['pick', 'inspect', 'annotate']],
      ['compare', ['compute', 'scatter', 'stats']],
      ['outputs', ['annotations', 'metrics']],
    ];
    const pos = {};
    const titles = [];
    const washes = [];
    let note = null;
    let y = 0;
    for (const [stage, ids] of order) {
      y += y ? 46 : 30;
      titles.push({ stage, x: left - 2, y });
      y += 40;
      const startY = y;
      const step = stage === 'outputs' ? 64 : 104;
      ids.forEach((id, i) => { pos[id] = { col: 0, cx, cy: startY + i * step + R, ex: W }; });
      // Bottom of the last station's text, then ~20 px of margin
      let end = startY + (ids.length - 1) * step + R + (stage === 'outputs' ? 28 : 40);
      if (stage === 'setup') {
        note = { x: cx + R + 14, y: end + 22 };
        end += 26;
      }
      washes.push({ stage, x: left - 44, y: startY - 22, w: W - left + 36, h: end - startY + 42 });
      y = end + 20;
    }
    return { W, H: y + 6, pos, wide: false, titles, washes, note };
  }

  // ---- Paths

  const spline = d3.line().curve(d3.curveBasis);
  const sCurve = d3.linkHorizontal();

  function route(link, L, lanes) {
    const a = L.pos[link.source];
    const b = L.pos[link.target];
    const gapR = R + 5;

    if (a.col === b.col) {
      const lo = Math.min(a.cy, b.cy);
      const hi = Math.max(a.cy, b.cy);
      const between = Object.entries(L.pos).some(
        ([id, o]) => id !== link.source && id !== link.target && o.col === a.col && o.cy > lo && o.cy < hi
      );
      if (!between) {
        const dir = b.cy > a.cy ? 1 : -1;
        const y1 = a.cy + dir * gapR;
        const y2 = b.cy - dir * (gapR + 2);
        return { d: `M${a.cx},${y1} L${b.cx},${y2}`, lx: a.cx + 12, ly: (y1 + y2) / 2 + 4, anchor: 'start', arrow: true };
      }
      // Around the stations in between, on the left
      lanes.n = (lanes.n ?? -1) + 1;
      const off = 26 + lanes.n * 16;
      const x = a.cx - off;
      const ya = a.cy + (link.kind === 'loop' ? 0 : 4);
      const yb = b.cy + (link.kind === 'loop' ? 5 : -5);
      return {
        d: spline([[a.cx - gapR, ya], [x, ya], [x, (ya + yb) / 2], [x, yb], [b.cx - gapR - 2, yb]]),
        lx: x - 6, ly: (ya + yb) / 2, rotate: true, arrow: true,
      };
    }

    if (b.cx < a.cx) {
      // Back from the right-hand column, leaving just above the station's
      // centre so it does not meet a link arriving from the left
      const y1 = a.cy - 5;
      return { d: sCurve({ source: [a.cx - gapR, y1], target: [b.ex - 18, b.cy] }), lx: (a.cx - gapR + b.ex - 18) / 2, ly: Math.min(y1, b.cy) - 9, anchor: 'middle', arrow: true };
    }
    // Forward to the next column. Going down, it leaves just below the
    // station's centre (a link may arrive there from the right); going up, it
    // arrives just below the target's centre
    const x1 = a.ex - 18;
    const x2 = b.cx - gapR - 2;
    const y1 = a.cy + (b.cy > a.cy ? 10 : 0);
    const y2 = b.cy + (a.cy > b.cy ? 7 : 0);
    const d = sCurve({ source: [x1, y1], target: [x2, y2] });
    // Level: label above the middle. Sloped: to the left of the midpoint
    if (Math.abs(y1 - y2) < 1) return { d, lx: (x1 + x2) / 2, ly: y1 - 8, anchor: 'middle', arrow: true };
    return { d, lx: (x1 + x2) / 2 - 8, ly: (y1 + y2) / 2 + 4, anchor: 'end', arrow: true };
  }

  // ---- Drawing

  let drawn = false;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function render() {
    const width = Math.floor(root.clientWidth) || 800;
    const L = width >= WIDE_MIN ? layoutWide(width) : layoutNarrow(width);
    const lanes = {};
    const routes = LINKS
      .filter((l) => L.wide || !l.wideOnly)
      .map((l) => ({ link: l, ...route(l, L, lanes) }));

    root.replaceChildren();
    const pad = 18;
    // Scales down to fit the column, never up past its drawn size
    const svg = d3.select(root).append('svg')
      .attr('viewBox', `${-pad} ${-pad} ${L.W + 2 * pad} ${L.H + 2 * pad}`)
      .style('width', '100%')
      .style('max-width', `${L.W + 2 * pad}px`)
      .attr('role', 'group');

    const defs = svg.append('defs');
    // Watercolour edge: noise displaces the shape, then a soft blur
    const wash = defs.append('filter').attr('id', 'wf-wash')
      .attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
    wash.append('feTurbulence').attr('type', 'fractalNoise').attr('baseFrequency', 0.014).attr('numOctaves', 3).attr('seed', 7).attr('result', 'noise');
    wash.append('feDisplacementMap').attr('in', 'SourceGraphic').attr('in2', 'noise').attr('scale', 22).attr('result', 'moved');
    wash.append('feGaussianBlur').attr('in', 'moved').attr('stdDeviation', 5);
    // Paper grain
    const grain = defs.append('filter').attr('id', 'wf-grain');
    grain.append('feTurbulence').attr('type', 'fractalNoise').attr('baseFrequency', 0.85).attr('numOctaves', 2).attr('stitchTiles', 'stitch');
    grain.append('feColorMatrix').attr('type', 'matrix')
      .attr('values', '0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 0.07 0');
    for (const [key, color] of Object.entries({ ink: INK, setup: COLORS.setup, review: COLORS.review, compare: COLORS.compare })) {
      defs.append('marker').attr('id', 'wf-arrow-' + key)
        .attr('viewBox', '0 0 10 10').attr('refX', 7).attr('refY', 5)
        .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto-start-reverse')
        .append('path').attr('d', 'M1,1.5 L8.5,5 L1,8.5 Q3,5 1,1.5 z').attr('fill', color);
    }
    const markerKey = (l) => (l.kind === 'loop' || l.kind === 'review' ? 'review' : l.kind === 'compare' ? 'compare' : 'ink');

    // Paper
    svg.append('rect').attr('x', -pad).attr('y', -pad).attr('width', L.W + 2 * pad).attr('height', L.H + 2 * pad)
      .attr('rx', 18).attr('fill', PAPER);
    svg.append('rect').attr('x', -pad).attr('y', -pad).attr('width', L.W + 2 * pad).attr('height', L.H + 2 * pad)
      .attr('rx', 18).attr('filter', 'url(#wf-grain)').attr('fill', PAPER);

    // Washes
    svg.append('g').selectAll('rect').data(L.washes).join('rect')
      .attr('x', (d) => d.x).attr('y', (d) => d.y).attr('width', (d) => d.w).attr('height', (d) => d.h)
      .attr('rx', 40).attr('fill', (d) => WASHES[d.stage]).attr('fill-opacity', 0.55)
      .attr('filter', 'url(#wf-wash)');

    // Stage titles: number in the stage colour, name in light weight
    const title = svg.append('g').selectAll('text').data(L.titles).join('text')
      .attr('class', 'wf-stage').attr('x', (d) => d.x).attr('y', (d) => d.y)
      .attr('fill', (d) => COLORS[d.stage]);
    title.filter((d) => STAGES[d.stage][0]).append('tspan').attr('class', 'wf-stage-num').text((d) => STAGES[d.stage][0] + '  ');
    title.append('tspan').text((d) => STAGES[d.stage][1]);
    // Wide: a dashed leader from the "Outputs" title across the empty part of
    // its band to the first output
    if (L.wide) {
      const outTitle = title.filter((d) => d.stage === 'outputs').node();
      const box = outTitle.getBBox();
      const y = L.pos.annotations.cy;
      svg.append('line').attr('class', 'wf-leader')
        .attr('x1', box.x + box.width + 14).attr('y1', y)
        .attr('x2', L.pos.annotations.cx - R - 12).attr('y2', y)
        .attr('stroke', COLORS.outputs);
    }

    // A tag such as "Optional": small italic text above the stage title
    svg.append('g').selectAll('text').data(L.titles.filter((d) => STAGES[d.stage][2])).join('text')
      .attr('class', 'wf-stage-tag')
      .attr('x', (d) => d.x).attr('y', (d) => d.y - 22)
      .attr('fill', (d) => COLORS[d.stage])
      .text((d) => STAGES[d.stage][2]);

    // Links
    const linkSel = svg.append('g').selectAll('path').data(routes).join('path')
      .attr('class', 'wf-link')
      .attr('d', (d) => d.d)
      .attr('stroke', (d) => linkColor(d.link))
      .attr('stroke-opacity', (d) => (d.link.kind === 'out' ? 0.75 : 0.9))
      .attr('stroke-dasharray', (d) => (d.link.kind === 'out' ? '1 6' : null))
      .attr('marker-end', (d) => (d.arrow ? `url(#wf-arrow-${markerKey(d.link)})` : null));

    const labelSel = svg.append('g').selectAll('text').data(routes.filter((d) => d.link.label && d.lx !== undefined)).join('text')
      .attr('class', 'wf-label')
      .attr('fill', (d) => linkColor(d.link))
      .attr('text-anchor', (d) => (d.rotate ? 'middle' : d.anchor))
      .attr('transform', (d) => (d.rotate ? `translate(${d.lx},${d.ly}) rotate(-90)` : `translate(${d.lx},${d.ly})`))
      .text((d) => d.link.label);

    // Stations
    const node = svg.append('g').selectAll('a').data(STEPS).join('a')
      .attr('class', 'wf-node')
      .attr('href', (d) => d.href)
      .attr('transform', (d) => `translate(${L.pos[d.id].cx},${L.pos[d.id].cy})`);
    node.append('title').text((d) => `${d.title}: ${d.lines.join(' ')}`);
    // Halo so lines stop short of the station
    node.append('circle').attr('r', R + 4).attr('fill', PAPER).attr('fill-opacity', 0.9);
    node.append('circle').attr('class', 'wf-dot')
      .attr('r', (d) => (d.output ? R - 1 : R))
      .attr('fill', (d) => (d.output ? PAPER : COLORS[d.stage]))
      .attr('stroke', (d) => (d.output ? ringColor(d) : d.optional ? COLORS[d.stage] : 'none'))
      .attr('stroke-width', (d) => (d.output ? 3.5 : 0))
      .attr('fill-opacity', (d) => (d.optional ? 0.55 : 1));
    // Outputs: a bold ring with a centre dot in the colour of the stage that writes it
    node.filter((d) => d.output).append('circle')
      .attr('r', 4.5).attr('fill', (d) => ringColor(d)).attr('pointer-events', 'none');
    node.filter((d) => d.n).append('text').attr('class', 'wf-num')
      .attr('text-anchor', 'middle').attr('dy', '0.35em').text((d) => d.n);
    node.append('text').attr('class', 'wf-title')
      .attr('x', R + 14).attr('y', (d) => (d.output ? 5 : 1))
      .text((d) => d.title);
    node.each(function (d) {
      const g = d3.select(this);
      d.lines.forEach((t, i) => {
        g.append('text').attr('class', 'wf-detail')
          .attr('x', R + 14).attr('y', (d.output ? 23 : 20) + i * 16)
          .text(t);
      });
    });

    svg.append('a').attr('href', 'user-guide/troubleshooting.html')
      .append('text').attr('class', 'wf-note').attr('x', L.note.x).attr('y', L.note.y)
      .text('Not starting? See ')
      .append('tspan').attr('class', 'wf-note-target').text('Troubleshooting');

    // Draw the lines on, once
    if (!drawn && !reduceMotion) {
      linkSel.each(function (d, i) {
        const path = d3.select(this);
        const len = this.getTotalLength();
        const marker = path.attr('marker-end');
        const dash = path.attr('stroke-dasharray');
        path.attr('marker-end', null)
          .attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
          .transition().delay(150 + i * 110).duration(700).ease(d3.easeCubicOut)
          .attr('stroke-dashoffset', 0)
          .on('end', () => path.attr('stroke-dasharray', dash).attr('marker-end', marker));
      });
      node.attr('opacity', 0)
        .transition().delay((d, i) => 80 + i * 60).duration(400)
        .attr('opacity', 1)
        .on('end interrupt', function () { d3.select(this).attr('opacity', null); });
    }
    drawn = true;

    // Grow the station under the pointer (nothing else changes)
    function highlight(id) {
      node.select('.wf-dot').transition().duration(160)
        .attr('r', (d) => (d.id === id ? R + 3 : d.output ? R - 1 : R));
    }
    node.on('mouseenter focus', (event, d) => highlight(d.id))
      .on('mouseleave blur', () => highlight(null));
  }

  render();
  let frame = 0;
  let lastWidth = root.clientWidth;
  new ResizeObserver(() => {
    if (root.clientWidth === lastWidth) return;
    lastWidth = root.clientWidth;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  }).observe(root);
})();
