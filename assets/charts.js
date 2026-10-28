/*! Copyright (c) 2026 Ikhwan Arief (ikhwan[at]eng.unand.ac.id). All rights reserved.
 * Licensed under the PolyForm Noncommercial License 1.0.0
 * (https://polyformproject.org/licenses/noncommercial/1.0.0). Commercial use requires prior
 * written permission from the copyright holder. See LICENSE and NOTICE. */
import {csvCell, INSTITUTION, SDG_COLORS} from './metrics.js';
export const PALETTE = ['#28745B', '#B8934A', '#368C88', '#587AA5', '#8A7098', '#9BAE96', '#49705F', '#C4AB76', '#7F9DAD', '#B3A6B8'];
export const OA_COLORS = { diamond: '#28745B', gold: '#B8934A', hybrid: '#587AA5', green: '#7DA286', bronze: '#A57D54', closed: '#ADB5AD', unknown: '#DBDFDA' };
// Chrome colours of charts; applyTheme replaces them (and the palette) from manifest.institution.theme.
export const CHART = { primary: '#183D34', reference: '#947337', grid: '#edf0e9', tick: '#63736b', label: '#526358', text: '#25332d', link: '#85a594', mapSea: '#edf4f5', mapLand: '#d8e3d9', bubble: '#28745b' };
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
export function applyTheme(theme = {}) {
    if (!theme.accent) return;
    const primary = theme.primary || CHART.primary, accent = theme.accent, highlight = theme.highlight || '#B8934A', ink = theme.ink || CHART.text, muted = theme.muted || '#5c6e63';
    if (Array.isArray(theme.palette) && theme.palette.length >= 4) PALETTE.splice(0, PALETTE.length, ...theme.palette);
    else PALETTE.splice(0, 2, accent, highlight);
    // OA "gold" keeps a gold hue and "green" a green one: those colours are part of the category names.
    Object.assign(OA_COLORS, { diamond: accent, hybrid: PALETTE[3] || OA_COLORS.hybrid });
    Object.assign(CHART, { primary, reference: mix(highlight, '#000000', .2), grid: mix(accent, '#ffffff', .93), tick: muted, label: muted, text: ink,
        link: mix(accent, '#ffffff', .45), mapSea: mix(accent, '#ffffff', .94), mapLand: mix(accent, '#ffffff', .82), bubble: accent });
}
const instances = [];
const integer = new Intl.NumberFormat('en-US');
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const colorFor = (id, index = 0) => OA_COLORS[id] || PALETTE[id ? [...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % PALETTE.length : index % PALETTE.length];
function ink(color) { const rgb = color.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return 1.05 / (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 + .05) >= 4.5 ? '#ffffff' : '#000000'; }
const NS = 'http://www.w3.org/2000/svg';
export const el = (tag, attrs = {}, text) => { const node = document.createElement(tag); for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value); if (text !== undefined)
    node.textContent = text; return node; };
const svgEl = (tag, attrs = {}, text) => { const node = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value); if (text !== undefined)
    node.textContent = text; return node; };
export function destroyCharts() { for (const chart of instances)
    chart.destroy(); instances.length = 0; }
export function downloadBlob(blob, name) { const url = URL.createObjectURL(blob), a = el('a', { href: url, download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function downloadText(text, name, type = 'text/plain') { downloadBlob(new Blob([text], { type }), name); }
export function panel(grid, title, note = '', wide = false) {
    const node = el('section', { class: `panel${wide ? ' wide' : ''}` });
    const head = el('div', { class: 'panel-head' }), labels = el('div'), actions = el('div', { class: 'panel-actions' });
    labels.append(el('h2', {}, title));
    if (note)
        labels.append(el('p', {}, note));
    head.append(labels, actions);
    const body = el('div', { class: 'chart-body' });
    node.append(head, body);
    grid.append(node);
    return { node, body, actions, title };
}
export function empty(p, message = 'No data is available for this filter.') { p.body.replaceChildren(); p.body.append(el('div', { class: 'empty-state' }, message)); }
function accessible(p, rows, onClick) {
    const detail = el('details', { class: 'chart-data' });
    detail.append(el('summary', {}, 'Show the chart data'));
    const list = el('ul');
    for (const r of rows) {
        const li = el('li'), label = r.description || `${r.name}: ${decimal.format(r.count ?? r.value ?? 0)}`;
        if (onClick) {
            const button = el('button', { type: 'button', class: 'data-drill' }, label);
            button.onclick = () => onClick(r);
            li.append(button);
        }
        else
            li.textContent = label;
        list.append(li);
    }
    detail.append(list);
    p.body.after(detail);
}
function exportControl(p) {
    const button = el('button', { class: 'chart-export', type: 'button', 'aria-label': `Download chart ${p.title}` }, '↓ Image');
    button.onclick = () => {
        const canvas = p.body.querySelector('canvas'), svg = p.body.querySelector('svg');
        if (canvas)
            canvas.toBlob(blob => blob && downloadBlob(blob, `${p.title}.png`));
        else if (svg)
            downloadText(new XMLSerializer().serializeToString(svg), `${p.title}.svg`, 'image/svg+xml');
    };
    p.actions.append(button);
}
function chart(p, type, data, options = {}, extraPlugins = []) {
    if (!globalThis.Chart) {
        empty(p, 'The chart library could not be loaded. Reload the page.');
        return;
    }
    const canvas = el('canvas', { role: 'img', 'aria-label': p.title });
    p.body.append(canvas);
    // Line and bar charts show the tooltip for the nearest year column, so values appear without hitting a point exactly.
    if ((type === 'line' || type === 'bar') && !options.interaction)
        options = { ...options, interaction: { mode: 'nearest', axis: options.indexAxis === 'y' ? 'y' : 'x', intersect: false } };
    const plugins=options.plugins||{},tooltip=plugins.tooltip||{};
    options={...options,plugins:{...plugins,legend:{display:false,...plugins.legend},tooltip:{backgroundColor:CHART.primary,padding:11,cornerRadius:8,...tooltip,callbacks:{footer:()=>p.title.startsWith('History')?['Default filter of each snapshot']:[...(document.querySelector('.scope-line span')?.textContent?.split(' · ')||[]),document.querySelector('.scope-line strong')?.textContent||''],...tooltip.callbacks}}}};
    const c = new Chart(canvas, { type, data, plugins: extraPlugins, options: { responsive: true, maintainAspectRatio: false,
            animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 250 },
            font: { family: 'system-ui' }, plugins: { legend: { display: false }, tooltip: { backgroundColor: CHART.primary, padding: 11, cornerRadius: 8, callbacks: { footer: () => document.querySelector('.scope-line')?.textContent || '' } } },
            scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, color: CHART.tick } }, y: { beginAtZero: true, grid: { color: CHART.grid }, border: { display: false }, ticks: { font: { size: 10 }, color: CHART.tick, precision: 0 } } }, ...options } });
    instances.push(c);
    exportControl(p);
    return c;
}
export function bar(p, rows, { horizontal = true, onClick, color, limit = 10, value = 'count', unit = 'works' } = {}) {
    rows = rows.slice(0, limit);
    if (!rows.length) {
        empty(p);
        return;
    }
    chart(p, 'bar', { labels: rows.map(r => r.name.length > 34 ? r.name.slice(0, 32) + '…' : r.name), datasets: [{ data: rows.map(r => r[value] ?? 0),
                backgroundColor: rows.map((r, i) => color || colorFor(r.id, i)), borderRadius: 4, maxBarThickness: 24 }] }, { indexAxis: horizontal ? 'y' : 'x', scales: horizontal ? { x: { beginAtZero: true, grid: { color: CHART.grid }, ticks: { font: { size: 9 }, precision: 0 } }, y: { grid: { display: false }, ticks: { font: { size: 10 }, color: CHART.label }, border: { display: false } } } : undefined,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: CHART.primary, callbacks: { label: c => `${rows[c.dataIndex].name}: ${decimal.format(rows[c.dataIndex][value] ?? 0)} ${unit}` } } },
        onClick: (_e, elements) => elements[0] && onClick?.(rows[elements[0].index]),
        onHover: (e, elements) => { if (e.native?.target)
            e.native.target.style.cursor = elements.length && onClick ? 'pointer' : 'default'; } });
    accessible(p, rows.map(r => ({ ...r, count: r[value], description: `${r.name}: ${decimal.format(r[value] ?? 0)} ${unit}` })), onClick);
}
// SDG list with the official full icons (number, title and pictogram; scaled, never cropped) and goal-coloured bars.
// rows: { id: '1'..'17', name, count }; the order is kept as given.
export function sdgBars(p, rows, { onClick, limit = 17 } = {}) {
    const list = rows.slice(0, limit), max = Math.max(1, ...list.map(r => r.count || 0));
    p.body.style.height = 'auto';
    if (!list.length || !list.some(r => r.count)) { empty(p); return; }
    const box = el('ol', { class: 'sdg-bars' });
    for (const r of list) {
        const n = Number(r.id), item = el('li'), button = el('button', { type: 'button', class: 'sdg-bar', 'data-sdg': r.id, 'aria-label': `${r.name}: ${integer.format(r.count || 0)} works` });
        button.append(el('img', { src: `assets/sdg/sdg-${n}.png`, alt: `SDG ${n}`, width: '40', height: '40', loading: 'lazy' }));
        const track = el('span', { class: 'sdg-bar-track' }), fill = el('span', { class: 'sdg-bar-fill' }), label = el('span', { class: 'sdg-bar-label' });
        fill.style.width = `${(r.count || 0) / max * 100}%`;
        fill.style.background = SDG_COLORS[n - 1];
        track.append(fill);
        label.append(el('span', { class: 'sdg-bar-name' }, r.name), track);
        button.append(label, el('span', { class: 'sdg-bar-count' }, integer.format(r.count || 0)));
        if (onClick) button.onclick = () => onClick(r); else button.disabled = true;
        item.append(button); box.append(item);
    }
    p.body.append(box);
}
export function line(p, rows, { onClick, value = 'count', label = 'Publications', color = PALETTE[0], percent = false, unit='works', reference = null, referenceLabel, tooltip, footer } = {}) {
    if (!rows.length || !rows.some(r => Number.isFinite(r[value]))) {
        empty(p);
        return;
    }
    const datasets = [{ label, data: rows.map(r => r[value] ?? null), borderColor: color,
        backgroundColor: color + '12', fill: true, tension: .25, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2 }];
    if (Number.isFinite(reference)) datasets.push({ label: referenceLabel || `Reference ${unit} ${reference}`, data: rows.map(() => reference),
        borderColor: CHART.reference, borderDash: [6, 5], pointRadius: 0, borderWidth: 1.5, fill: false });
    chart(p, 'line', { labels: rows.map(r => r.name ?? r.year ?? r.id), datasets }, {
        plugins: { legend: { display: Number.isFinite(reference), position: 'bottom' }, tooltip: { callbacks: {
            label: c => c.datasetIndex === 0 && tooltip ? tooltip(rows[c.dataIndex]) : `${c.dataset.label}: ${decimal.format(c.raw)} ${percent ? '%' : unit}`,
            ...(footer ? { footer: () => footer } : {}),
        } } },
        onClick: (_e, e) => e[0]?.datasetIndex === 0 && onClick?.(rows[e[0].index]), scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 12 } }, y: { beginAtZero: true, max: percent ? 100 : undefined, grid: { color: CHART.grid }, ticks: { font: { size: 9 } } } } });
    accessible(p, rows.map(r => ({ ...r, name: String(r.name ?? r.year ?? r.id), count: r[value], description: tooltip ? tooltip(r) : `${r.name??r.year??r.id}: ${Number.isFinite(r[value]) ? decimal.format(r[value]) + ' ' + (percent?'%':unit) : 'Not available'}` })), onClick);
}
// Distribution charts on stock Chart.js (no plugin file): rows are { year, distribution: { p10, q1, median, q3, p90, max, mean, n, small_base } }.
// One colour per kind of value, the same in both charts. Only three hues are used because only three stay apart for
// every reader when all marks are on screen together (checked for colour-vision deficiency); median and maximum are
// neutral ink and are also told apart by shape, and every value is in the tooltip and the chart data list.
// Author origin groups: three hues that stay apart for colour-vision deficiency, plus grey for "not recorded".
export const ORIGIN_COLORS = Object.freeze({ home: '#2a78d6', national: '#1baf7a', international: '#eb6834', unknown: '#c4c9c6' });
// One 100% bar of all years, with the count and share of each group written next to its swatch.
export function shareBar(p, parts, { unit = 'authorships' } = {}) {
    const total = parts.reduce((n, x) => n + x.count, 0), pctText = n => total ? `${decimal.format(n / total * 100)}%` : '—';
    const box = el('div', { class: 'share-total' }), bar = el('div', { class: 'share-bar', role: 'img',
        'aria-label': parts.map(x => `${x.name}: ${integer.format(x.count)} ${unit} (${pctText(x.count)})`).join('; ') });
    for (const x of parts) if (x.count) { const seg = el('span', { title: `${x.name}: ${integer.format(x.count)} ${unit} (${pctText(x.count)})` }); seg.style.width = `${x.count / total * 100}%`; seg.style.background = x.color; bar.append(seg); }
    const legend = el('ul', { class: 'dist-legend share-legend' });
    for (const x of parts) {
        const swatch = el('span', { class: 'dist-swatch band', 'aria-hidden': 'true' }); swatch.style.background = x.color;
        const item = el('li'); item.append(swatch, el('span', {}, `${x.name}: `), el('strong', {}, pctText(x.count)), el('span', {}, ` (${integer.format(x.count)})`)); legend.append(item);
    }
    box.append(el('p', { class: 'share-caption' }, `All years · ${integer.format(total)} ${unit}`), bar, legend);
    p.body.before(box);
}
// "How to read this chart": plain sentences under a chart.
export function chartStory(p, lines, title = 'How to read this chart') {
    if (!lines?.length) return;
    const box = el('div', { class: 'chart-story' }), list = el('ul');
    for (const line of lines) {
        const [head, ...rest] = line.split(': '), item = el('li');
        if (rest.length && head.length < 40) item.append(el('strong', {}, head + ': '), rest.join(': ')); else item.textContent = line;
        list.append(item);
    }
    box.append(el('h3', {}, title), list);
    p.node.append(box);
}
export const DIST_COLORS = Object.freeze({ inner: '#2a78d6', outer: '#1baf7a', mean: '#eb6834', median: '#1f2a25', max: '#7b8580', reference: '#7b8580' });
const tint = (color, share) => mix(color, '#ffffff', 1 - share);   // opaque colour at `share` strength on white
const niceCeil = v => { const m = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / m * 2) / 2 * m; };
const fmt = v => decimal.format(v);
function distributionLines(d, unit = '') {
    if (!d) return ['Too few works for a distribution'];
    return [`Median ${fmt(d.median)} · mean ${fmt(d.mean)}${unit ? ' ' + unit : ''}`, `P25–P75: ${fmt(d.q1)}–${fmt(d.q3)}`, `P10–P90: ${fmt(d.p10)}–${fmt(d.p90)}`,
        `Maximum ${fmt(d.max)}`, `${integer.format(d.n)} works${d.small_base ? ' · small base' : ''}`];
}
// Legend as HTML under the chart: a swatch in the mark's own shape and colour, the label in text ink.
function distributionLegend(p, items) {
    const list = el('ul', { class: 'dist-legend' });
    for (const [shape, color, label] of items) {
        const swatch = el('span', { class: `dist-swatch ${shape}`, 'aria-hidden': 'true' });
        swatch.style.setProperty('--swatch', color);
        const item = el('li'); item.append(swatch, el('span', {}, label)); list.append(item);
    }
    p.body.after(list);
}
// Box plot: a floating bar per year for P25–P75; an inline plugin draws the P10–P90 whiskers, the median, the mean
// and the maximum. The axis stops a little above the highest P90 so one extreme work does not flatten the boxes;
// a maximum above the axis is a triangle at the top. Small-base years are drawn lighter with a dashed outline.
export function boxPlot(p, rows, { reference = null, referenceLabel, unit = '', tooltip, onClick } = {}) {
    const shown = rows.filter(r => r.distribution), C = DIST_COLORS;
    if (!shown.length) { empty(p, 'Too few works per year for a distribution in this filter.'); return; }
    rows = rows.slice(rows.indexOf(shown[0]), rows.indexOf(shown.at(-1)) + 1);   // trim empty ends, keep inner gaps
    const top = niceCeil(Math.max(...shown.map(r => r.distribution.p90), Number.isFinite(reference) ? reference : 0) * 1.15 || 1);
    const datasets = [{ label: 'P25–P75', data: rows.map(r => r.distribution ? [r.distribution.q1, r.distribution.q3] : null),
        backgroundColor: rows.map(r => tint(C.inner, r.distribution?.small_base ? .15 : .35)), borderColor: C.inner, borderWidth: 1.5,
        borderSkipped: false, borderRadius: 2, minBarLength: 2, maxBarThickness: 36 }];
    if (Number.isFinite(reference)) datasets.push({ type: 'line', label: referenceLabel || `Reference ${reference}`, data: rows.map(() => reference),
        borderColor: C.reference, borderDash: [6, 5], pointRadius: 0, borderWidth: 1.5, fill: false });
    const marks = { id: 'boxMarks', afterDatasetsDraw(c) {
        const { ctx, chartArea: area } = c, y = c.scales.y, py = v => y.getPixelForValue(Math.min(v, y.max));
        ctx.save();
        c.getDatasetMeta(0).data.forEach((box, i) => {
            const d = rows[i].distribution, x = box.x, half = box.width / 2, tick = half * .55;
            if (!d) return;
            if (d.small_base) {   // dashed outline over the lighter box
                ctx.setLineDash([3, 3]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
                ctx.strokeRect(x - half, py(d.q3), half * 2, py(d.q1) - py(d.q3)); ctx.setLineDash([]);
            }
            ctx.strokeStyle = C.outer; ctx.lineWidth = 2; ctx.beginPath();
            ctx.moveTo(x, py(d.q3)); ctx.lineTo(x, py(d.p90)); ctx.moveTo(x - tick, py(d.p90)); ctx.lineTo(x + tick, py(d.p90));
            ctx.moveTo(x, py(d.q1)); ctx.lineTo(x, py(d.p10)); ctx.moveTo(x - tick, py(d.p10)); ctx.lineTo(x + tick, py(d.p10));
            ctx.stroke();
            ctx.strokeStyle = C.median; ctx.lineWidth = 3; ctx.beginPath();
            ctx.moveTo(x - half, py(d.median)); ctx.lineTo(x + half, py(d.median)); ctx.stroke();
            if (d.mean <= y.max) {   // mean: diamond with a white ring so it stays visible on the median line
                const m = py(d.mean); ctx.beginPath();
                ctx.moveTo(x, m - 5); ctx.lineTo(x + 5, m); ctx.lineTo(x, m + 5); ctx.lineTo(x - 5, m); ctx.closePath();
                ctx.fillStyle = C.mean; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
            }
            ctx.fillStyle = C.max; ctx.beginPath();
            if (d.max > y.max) { ctx.moveTo(x, area.top); ctx.lineTo(x + 4.5, area.top + 8); ctx.lineTo(x - 4.5, area.top + 8); ctx.closePath(); }
            else ctx.arc(x, py(d.max), 3, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    } };
    const describe = r => tooltip ? tooltip(r) : `${r.year}: ${distributionLines(r.distribution, unit).join(' · ')}`;
    chart(p, 'bar', { labels: rows.map(r => String(r.year)), datasets }, {
        interaction: { mode: 'index', axis: 'x', intersect: false },
        plugins: { legend: { display: false }, tooltip: { filter: item => item.datasetIndex === 0, callbacks: {
            label: c => distributionLines(rows[c.dataIndex].distribution, unit).map((line, i) => i === 3 && rows[c.dataIndex].distribution?.max > top ? line + ' (above the axis)' : line) } } },
        onClick: (_e, e) => e[0] && rows[e[0].index].distribution && onClick?.(rows[e[0].index]),
        onHover: (e, items) => { if (e.native?.target) e.native.target.style.cursor = items.length && onClick ? 'pointer' : 'default'; },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, color: CHART.tick } },
            y: { beginAtZero: true, max: top, grid: { color: CHART.grid }, border: { display: false }, ticks: { font: { size: 9 }, color: CHART.tick } } } }, [marks]);
    accessible(p, shown.map(r => ({ ...r, name: String(r.year), description: describe(r) })), onClick);
    distributionLegend(p, [['box', C.inner, 'Box: middle 50% of works (P25–P75)'], ['whisker', C.outer, 'Whiskers: middle 80% (P10–P90)'],
        ['bar', C.median, 'Median'], ['diamond', C.mean, 'Mean'], ['dot', C.max, 'Maximum (▲ above the axis)'],
        ...(Number.isFinite(reference) ? [['dash', C.reference, referenceLabel || 'Reference']] : []), ['box faint', C.inner, 'Lighter, dashed box: small base']]);
}
// Percentile band: median line inside a P25–P75 band and a lighter P10–P90 band, with the mean dashed for comparison.
// Small-base years have a hollow median point. Chart.js draws higher `order` first, so the bands go under the lines.
export function percentileBand(p, rows, { unit = '', tooltip, onClick } = {}) {
    const shown = rows.filter(r => r.distribution), C = DIST_COLORS;
    if (!shown.length) { empty(p, 'Too few works per year for a distribution in this filter.'); return; }
    rows = rows.slice(rows.indexOf(shown[0]), rows.indexOf(shown.at(-1)) + 1);   // trim empty ends, keep inner gaps
    const v = key => rows.map(r => r.distribution?.[key] ?? null), edge = { borderColor: 'transparent', pointRadius: 0, pointHitRadius: 0, tension: .25 };
    const datasets = [
        { ...edge, label: 'P90', data: v('p90'), fill: false, order: 5 },
        { ...edge, label: 'P10–P90', data: v('p10'), backgroundColor: tint(C.outer, .22), fill: '-1', order: 4 },
        { ...edge, label: 'P75', data: v('q3'), fill: false, order: 3 },
        { ...edge, label: 'P25–P75', data: v('q1'), backgroundColor: tint(C.inner, .4), fill: '-1', order: 2 },
        { label: 'Median', order: 0, data: v('median'), borderColor: C.median, borderWidth: 2, tension: .25, fill: false, pointRadius: 3.5, pointHoverRadius: 6,
            pointBackgroundColor: rows.map(r => r.distribution?.small_base ? '#ffffff' : C.median), pointBorderColor: C.median, pointBorderWidth: 1.5 },
        { label: 'Mean', order: 1, data: v('mean'), borderColor: C.mean, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: .25, fill: false },
    ];
    const describe = r => tooltip ? tooltip(r) : `${r.year}: ${distributionLines(r.distribution, unit).join(' · ')}`;
    chart(p, 'line', { labels: rows.map(r => String(r.year)), datasets }, {
        interaction: { mode: 'index', axis: 'x', intersect: false },
        plugins: { legend: { display: false }, tooltip: { filter: item => item.datasetIndex === 4, callbacks: {
            label: c => distributionLines(rows[c.dataIndex].distribution, unit) } } },
        onClick: (_e, e) => e[0] && rows[e[0].index].distribution && onClick?.(rows[e[0].index]),
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 }, color: CHART.tick, maxTicksLimit: 12 } },
            y: { beginAtZero: true, grid: { color: CHART.grid }, border: { display: false }, ticks: { font: { size: 9 }, color: CHART.tick } } } });
    accessible(p, shown.map(r => ({ ...r, name: String(r.year), description: describe(r) })), onClick);
    distributionLegend(p, [['band', C.inner, 'Middle 50% of works (P25–P75)'], ['band outer', C.outer, 'Middle 80% (P10–P90)'],
        ['line', C.median, 'Median'], ['dash', C.mean, 'Mean'], ['ring', C.median, 'Hollow point: small base']]);
}
export function timelineYears(rows, availableYears, range = '10', { individual = false, omitEmpty = false } = {}) {
    const activeYears = [...new Set(availableYears)].filter(year => rows.some(row => row.years[year] > 0)).sort((a, b) => a - b);
    if (!activeYears.length) return rows.map(() => []);
    const last = activeYears.at(-1), first = range === 'all' ? activeYears[0] : Math.max(activeYears[0], last - Number(range) + 1);
    const window = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    const shared = omitEmpty ? window.filter(year => rows.some(row => row.years[year] > 0)) : window;
    return rows.map(row => {
        if (!individual) return shared;
        const activity = window.filter(year => row.years[year] > 0);
        return activity.length ? window.filter(year => year >= activity[0] && year <= activity.at(-1)) : [];
    });
}
export function smallMultiples(p, allRows, availableYears, onClick, options = {}) {
    const rows = allRows.slice(0, 10);
    const activeYears = availableYears.filter(year => rows.some(row => row.years[year] > 0));
    if (!rows.length || !activeYears.length) { empty(p); return; }
    p.node.classList.add('small-multiples-panel');
    p.body.className = 'small-multiples';
    const controls = el('label', { class: 'series-controls' }, 'Chart range');
    const select = el('select', { 'aria-label': `Chart range ${p.title}` });
    for (const [value, label] of [['10', 'Last 10 years'], ['20', 'Last 20 years'], ['all', 'Full range']]) select.append(el('option', { value }, label));
    controls.append(select, el('span', {}, 'Ranking follows every active filter.'));
    p.node.insertBefore(controls, p.body);
    let currentCharts = [];
    const draw = () => {
        for (const c of currentCharts) { c.destroy(); const index = instances.indexOf(c); if (index >= 0) instances.splice(index, 1); }
        currentCharts = [];
        p.body.replaceChildren();
        const rowYears = timelineYears(rows, availableYears, select.value, options);
        const maximum = Math.max(1, ...rows.flatMap((row, index) => rowYears[index].map(year => row.years[year] || 0)));
        rows.forEach((row, index) => {
            const years = rowYears[index];
            const card = el('section', { class: 'mini-series', 'data-entity': row.id }), head = el('div', { class: 'mini-series-head' }), actions = el('div', { class: 'panel-actions' });
            const labels = el('div'), visible = years.reduce((sum, year) => sum + (row.years[year] || 0), 0);
            labels.append(el('h3', {}, `${index + 1}. ${row.name}`), el('span', { class: 'mini-series-meta' }, `${integer.format(row.count)} works in filter${years.length ? ` · ${integer.format(visible)} in ${years[0]}–${years.at(-1)}` : ''}`));
            head.append(labels, actions);
            const body = el('div', { class: 'mini-series-body' });
            card.append(head, body);
            p.body.append(card);
            if (!years.length) { body.append(el('p', { class: 'empty-state' }, 'No publications in this chart range.')); return; }
            const points = years.map(year => ({ year, count: row.years[year] || 0 }));
            const mini = { node: card, body, actions, title: row.name };
            const lineColor = options.colorOf?.(row) || PALETTE[0];
            const c = chart(mini, 'line', { labels: years, datasets: [{ label: row.name, data: points.map(point => point.count),
                borderColor: lineColor, backgroundColor: lineColor + '12', fill: true, tension: 0, pointRadius: 2.5, pointHoverRadius: 5, borderWidth: 2 }] }, {
                scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, maxTicksLimit: 5 } },
                    y: { beginAtZero: true, max: Math.ceil(maximum * 1.1), ticks: { precision: 0, font: { size: 9 } }, grid: { color: CHART.grid } } },
                plugins: { tooltip: { callbacks: { label: ctx => `${row.name}: ${integer.format(ctx.raw)} works in ${years[ctx.dataIndex]}` } } },
                onClick: (_event, items) => items[0] && onClick?.(row, years[items[0].index]),
            });
            if (c) currentCharts.push(c);
            accessible(mini, points.map(point => ({ ...point, description: `${point.year}: ${integer.format(point.count)} works · ${row.name}` })), point => onClick?.(row, point.year));
        });
    };
    select.onchange = draw;
    draw();
}
// `unit` names what a bubble counts: shared publications on Kolaborasi, works on a journal page.
export function countryBubbleMap(p, rows, geography, { unit = 'joint publications' } = {}) {
    if (!rows.length) { empty(p); return; }
    p.node.classList.add('world-map-panel');
    const project = (lon, lat) => [(lon + 180) * 960 / 360, (85 - lat) * 420 / 145];
    const svg = svgEl('svg', { viewBox: '0 0 960 420', role: 'group', 'aria-label': `Map of ${unit} per country`, xmlns: NS });
    svg.append(svgEl('rect', { x: 0, y: 0, width: 960, height: 420, fill: CHART.mapSea }));
    for (const d of geography.borders) svg.append(svgEl('path', { d, fill: CHART.mapLand, stroke: '#ffffff', 'stroke-width': .65, 'vector-effect': 'non-scaling-stroke' }));
    const tooltip = el('p', { class: 'map-tooltip', role: 'status', 'aria-live': 'polite' }, 'Point at or focus a bubble to see the country name and number of works.');
    const popup = el('div', { class: 'map-popup', role: 'tooltip', hidden: '' });
    const show = (row, group) => {
        const label = `${row.name} (${row.id}): ${integer.format(row.count)} ${unit} · ${integer.format(row.citations)} citations`;
        tooltip.textContent = label;
        popup.textContent = label;
        popup.hidden = false;
        const bounds = p.body.getBoundingClientRect(), bubble = group?.getBoundingClientRect();
        const width = popup.getBoundingClientRect().width;
        const left = bubble ? bubble.x - bounds.x + bubble.width / 2 : bounds.width / 2;
        const top = bubble ? bubble.y - bounds.y : bounds.height / 2;
        popup.style.left = Math.max(8, Math.min(bounds.width - width - 8, left - width / 2)) + 'px';
        popup.style.top = Math.max(8, Math.min(bounds.height - popup.offsetHeight - 8, top - popup.offsetHeight - 10)) + 'px';
    };
    const hide = () => { popup.hidden = true; };
    p.node.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    const mapped = rows.filter(row => geography.countries[row.id]), missing = rows.filter(row => !geography.countries[row.id]);
    const maximum = Math.max(1, ...mapped.map(row => row.count));
    for (const row of [...mapped].sort((a, b) => b.count - a.count)) {
        const position = geography.countries[row.id], [cx, cy] = project(position.lon, position.lat);
        const radius = 28 * Math.sqrt(row.count / maximum), label = `${row.name} (${row.id}): ${integer.format(row.count)} ${unit} · ${integer.format(row.citations)} citations`;
        const group = svgEl('g', { class: 'country-bubble', 'data-country': row.id, tabindex: 0, role: 'img', 'aria-label': label });
        group.append(svgEl('title', {}, label), svgEl('circle', { cx, cy, r: Math.max(7, radius), fill: 'transparent' }),
            svgEl('circle', { class: 'bubble-dot', cx, cy, r: radius, fill: CHART.bubble, 'fill-opacity': .62, stroke: '#ffffff', 'stroke-width': 1.1, 'vector-effect': 'non-scaling-stroke' }));
        group.onpointerenter = group.onfocus = group.onclick = () => show(row, group);
        group.onpointerleave = group.onblur = hide;
        group.onkeydown = event => {
            if (event.key === 'Escape') hide();
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(row, group); }
        };
        svg.append(group);
    }
    const controls = el('div', { class: 'map-controls' }), region = el('select', { 'aria-label': 'Map region' });
    const regions = { world: ['World', [0, 0, 960, 420]], asia: ['Asia', [590, 0, 350, 310]], europe: ['Europe', [440, 5, 220, 200]],
        africa: ['Africa', [425, 100, 230, 260]], americas: ['Americas', [0, 0, 420, 420]], oceania: ['Oceania', [730, 220, 230, 200]] };
    for (const [value, [label]] of Object.entries(regions)) region.append(el('option', { value }, label));
    let view = [...regions.world[1]];
    const draw = () => { hide(); svg.setAttribute('viewBox', view.join(' ')); };
    region.onchange = () => { view = [...regions[region.value][1]]; draw(); };
    const zoom = factor => { const [x, y, width, height] = view, next = Math.max(60, Math.min(960, width * factor)), ratio = height / width;
        view = next >= 960 || next * ratio >= 420 ? [...regions.world[1]]
            : [Math.max(0, Math.min(960 - next, x + (width - next) / 2)), Math.max(0, Math.min(420 - next * ratio, y + (height - next * ratio) / 2)), next, next * ratio]; draw(); };
    const plus = el('button', { type: 'button', class: 'button secondary', 'aria-label': 'Zoom in' }, '+');
    const minus = el('button', { type: 'button', class: 'button secondary', 'aria-label': 'Zoom out' }, '−');
    plus.onclick = () => zoom(.7); minus.onclick = () => zoom(1 / .7);
    const reset = el('button', { type: 'button', class: 'text-button' }, 'World view');
    reset.onclick = () => { region.value = 'world'; region.onchange(); };
    controls.append(region, plus, minus, reset);
    const choose = el('select', { 'aria-label': 'Choose a country on the map' });
    choose.append(el('option', { value: '' }, 'Show country data · filters unchanged'));
    for (const row of rows) choose.append(el('option', { value: row.id }, `${row.name} · ${integer.format(row.count)} works`));
    choose.onchange = () => { const row = rows.find(row => row.id === choose.value); if (row) show(row, null); else hide(); };
    controls.append(choose);
    p.body.append(svg, popup);
    p.node.insertBefore(controls, p.body);
    p.node.append(tooltip, el('p', { class: 'panel-note' },
        `${integer.format(mapped.length)} countries/areas mapped. Bubble area is proportional to the number of works; largest ${integer.format(maximum)} works. Positions use country label points, not campus locations. Geography: Natural Earth (public domain).${missing.length ? ' No coordinates yet: ' + missing.map(row => row.name).join(', ') + '.' : ''}`));
    exportControl(p);
    accessible(p, rows.map(row => ({ ...row, description: `${row.name} (${row.id}): ${integer.format(row.count)} ${unit} · ${integer.format(row.citations)} citations` })));
}
export function donut(p, rows, onClick) {
    if (!rows.length) {
        empty(p);
        return;
    }
    const total = rows.reduce((n, r) => n + r.count, 0);
    chart(p, 'doughnut', { labels: rows.map(r => r.name), datasets: [{ data: rows.map(r => r.count), backgroundColor: rows.map((r, i) => r.color || colorFor(r.id, i)), borderColor: '#fff', borderWidth: 3 }] }, { cutout: '72%', scales: {}, plugins: { legend: { display: true, position: 'right', labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, padding: 14, font: { size: 10 } } }, tooltip: { backgroundColor: CHART.primary, padding: 10, callbacks: { label: c => `${c.label}: ${integer.format(c.raw)} works / ${integer.format(total)} (${decimal.format(total ? c.raw / total * 100 : 0)}%)` } } }, onClick: (_e, e) => e[0] && onClick?.(rows[e[0].index]) });
    accessible(p, rows, onClick);
}
export function stacked(p, years, series, { percentage = false, horizontal = false, onClick, unit = 'works' } = {}) {
    if (!years.length) {
        empty(p);
        return;
    }
    // Only horizontal bars shorten labels; an explicit undefined callback would hide vertical category labels (years).
    const categoryAxis = { stacked: true, grid: { display: false }, ticks: { font: { size: 10 },
        ...(horizontal ? { callback: function (value) { const label = String(this.getLabelForValue(value)), limit = this.chart.width < 500 ? 22 : 45; return label.length > limit ? label.slice(0, limit - 2) + '…' : label; } } : {}) } };
    const valueAxis = { stacked: true, beginAtZero: true, max: percentage ? 100 : undefined, grid: { color: CHART.grid },
        ticks: { font: { size: 9 }, callback: percentage ? value => value + '%' : undefined } };
    chart(p, 'bar', { labels: years.map(y => y.year), datasets: series.map((s, i) => ({ label: s.name,
            data: years.map(y => percentage ? (y.total ? ((y.values[s.id] || 0) / y.total) * 100 : 0) : y.values[s.id] || 0),
            backgroundColor: s.color || colorFor(s.id, i), maxBarThickness: 45, borderRadius: 2 })) }, { indexAxis: horizontal ? 'y' : 'x', scales: { x: horizontal ? valueAxis : categoryAxis, y: horizontal ? categoryAxis : valueAxis },
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, font: { size: 9 }, padding: 10 } }, tooltip: { backgroundColor: CHART.primary, callbacks: { label: c => { const y = years[c.dataIndex], s = series[c.datasetIndex]; return `${s.name}: ${integer.format(y.values[s.id] || 0)} ${unit} / ${integer.format(y.total)}${percentage ? ' · ' + decimal.format(c.raw) + '%' : ''}`; } } } },
        onClick: (_e, e) => { if (e[0])
            onClick?.(years[e[0].index], series[e[0].datasetIndex]); } });
    accessible(p, years.flatMap(y => series.map(s => ({ name: `${y.year} · ${s.name}`, count: y.values[s.id] || 0,
        description: `${y.year} · ${s.name}: ${integer.format(y.values[s.id] || 0)} of ${integer.format(y.total)} ${unit}${percentage ? ' · ' + decimal.format(y.total ? (y.values[s.id] || 0) / y.total * 100 : 0) + '%' : ''}`,
        year: y, series: s }))), onClick ? r => onClick(r.year, r.series) : undefined);
}
export function scatter(p, rows, { x = 'count', y = 'citations', xTitle = 'Publications', yTitle = 'Citations', onClick, bubble = false, colorOf } = {}) {
    rows = rows.filter(r => Number.isFinite(r[x]) && Number.isFinite(r[y]));
    if (!rows.length) {
        empty(p);
        return;
    }
    chart(p, bubble ? 'bubble' : 'scatter', { datasets: [{ label: p.title, data: rows.map(r => ({ x: r[x], y: r[y], r: Math.max(4, Math.min(20, Math.sqrt(r.count || 1) * 1.3)) })), backgroundColor: rows.map((r, i) => (colorOf?.(r) || colorFor(r.id, i)) + 'B3'), borderWidth: 1, borderColor: '#fff', pointRadius: 5 }] }, { scales: { x: { beginAtZero: true, title: { display: true, text: xTitle, font: { size: 10 } }, grid: { color: CHART.grid }, ticks: { font: { size: 9 } } }, y: { beginAtZero: true, title: { display: true, text: yTitle, font: { size: 10 } }, grid: { color: CHART.grid }, ticks: { font: { size: 9 } } } },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: CHART.primary, callbacks: { label: ctx => `${rows[ctx.dataIndex].name || rows[ctx.dataIndex].title}: ${xTitle} ${decimal.format(ctx.parsed.x)}, ${yTitle} ${decimal.format(ctx.parsed.y)}` } } },
        onClick: (_e, e) => e[0] && onClick?.(rows[e[0].index]) });
    accessible(p, rows.slice(0, 50).map(r => ({ ...r, description: `${r.name || r.title}: ${xTitle} ${decimal.format(r[x])}; ${yTitle} ${decimal.format(r[y])}` })), onClick);
}
export function heatmap(p, rows, years, onCell) {
    rows = rows.slice(0, 10);
    if (!rows.length || !years.length) {
        empty(p);
        return;
    }
    p.body.classList.add('tall');
    const wrap = el('div', { class: 'heatmap-wrap' }), grid = el('div', { class: 'heatmap' });
    grid.style.gridTemplateColumns = `minmax(120px,1.5fr) repeat(${years.length}, minmax(35px,1fr))`;
    grid.append(el('span'));
    for (const y of years)
        grid.append(el('span', { class: 'heat-year' }, String(y)));
    const max = Math.max(1, ...rows.flatMap(r => years.map(y => r.years[y] || 0)));
    for (const row of rows) {
        grid.append(el('span', { class: 'heat-label', title: row.name }, row.name));
        for (const year of years) {
            const count = row.years[year] || 0, cell = el('button', { class: 'heat-cell', type: 'button', title: `${row.name} · ${year}: ${integer.format(count)} works`, 'aria-label': `${row.name}, ${year}, ${count} works` }, integer.format(count));
            const strength = count / max, alpha=.06+strength*.88;
            const shade='#'+[40,116,91].map(c=>Math.round(c*alpha+255*(1-alpha)).toString(16).padStart(2,'0')).join('');
            cell.style.backgroundColor = shade;
            cell.style.color = ink(shade);
            cell.onclick = () => onCell?.(row, year);
            grid.append(cell);
        }
    }
    wrap.append(grid, el('div', { class: 'heat-legend' }, 'Darker cells mean more works. Click a cell to explore the publications.'));
    p.body.append(wrap);
    accessible(p, rows);
    const b = el('button', { class: 'chart-export', type: 'button' }, '↓ CSV');
    b.onclick = () => downloadText([['Category','Year','Works'],...rows.flatMap(r => years.map(y => [r.name,y,r.years[y]||0]))].map(row=>row.map(csvCell).join(',')).join('\r\n'), p.title + '.csv', 'text/csv');
    p.actions.append(b);
}
export function dots(p, rows, onClick) {
    if (!rows.length) {
        empty(p);
        return;
    }
    const svg = svgEl('svg', { viewBox: '0 0 800 340', role: 'img', 'aria-label': p.title, xmlns: NS });
    for (let value = 0; value <= 100; value += 25) {
        const x = 290 + value * 4.6;
        svg.append(svgEl('line', { x1: x, y1: 20, x2: x, y2: 290, stroke: CHART.grid }), svgEl('text', { x, y: 320, 'text-anchor': 'middle', 'font-size': 16, fill: CHART.label }, value + '%'));
    }
    rows.forEach((r, index) => { const y = 45 + index * 48, g = svgEl('g', { role: 'button', tabindex: 0, 'aria-label': `${r.name}: ${decimal.format(r.count)} percent` }); g.append(svgEl('text', { x: 10, y: y + 5, 'font-size': 17, fill: CHART.text, 'font-family': 'system-ui' }, r.name), svgEl('line', { x1: 290, y1: y, x2: 290 + r.count * 4.6, y2: y, stroke: '#c9d8ca', 'stroke-width': 4 }), svgEl('circle', { cx: 290 + r.count * 4.6, cy: y, r: 8, fill: colorFor(r.id, index) }), svgEl('title', {}, `${r.name}: ${decimal.format(r.count)}%`)); g.onclick = () => onClick?.(r); g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.(r);
    } }; svg.append(g); });
    p.body.append(svg);
    exportControl(p);
    accessible(p, rows, onClick);
}
export function treemap(p, allRows, onClick) {
    const rows = allRows.slice(0, 12).map(r => ({ ...r })), rest = allRows.slice(12).reduce((n, r) => n + r.count, 0);
    if (rest)
        rows.push({ id: '', name: 'Other fields', count: rest });
    if (!rows.length || !rows.some(r => r.count)) {
        empty(p);
        return;
    }
    p.body.classList.add('tall');
    // Drawn at the box's real size (1 unit = 1 px), so tiles fill the full width and labels keep a readable size.
    const W = Math.max(280, Math.round(p.body.clientWidth || 800)), H = Math.max(220, Math.round(p.body.clientHeight || 340));
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': p.title, xmlns: NS });
    const fontSize = W < 520 ? 12 : 14;
    function divide(items, x, y, w, h) {
        if (items.length === 1) {
            const row = items[0], i = rows.indexOf(row), g = svgEl('g', { class: 'treemap-tile', tabindex: '0', role: 'button', 'aria-label': `${row.name}: ${row.count} works` });
            g.append(svgEl('rect', { x: x + 2, y: y + 2, width: Math.max(0, w - 4), height: Math.max(0, h - 4), rx: 5, fill: colorFor(row.id, i) }));
            g.append(svgEl('title', {}, `${row.name}: ${integer.format(row.count)} works`));
            if (w > 65 && h > fontSize + 15) {
                const max = Math.max(3, Math.floor((w - 20) / (fontSize * .58))), fill = ink(colorFor(row.id, i));
                g.append(svgEl('text', { x: x + 10, y: y + fontSize + 8, fill, 'font-size': fontSize, 'font-family': 'system-ui' }, row.name.length > max ? row.name.slice(0, max - 1) + '…' : row.name));
                if (h > fontSize * 2 + 22)
                    g.append(svgEl('text', { x: x + 10, y: y + fontSize * 2 + 16, fill, 'font-size': fontSize + 6, 'font-weight': 600, 'font-family': 'system-ui' }, integer.format(row.count)));
            }
            const activate = () => row.id && onClick?.(row);
            g.onclick = activate;
            g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate();
            } };
            svg.append(g);
            return;
        }
        const total = items.reduce((n, r) => n + r.count, 0);
        let sum = 0, index = 0;
        while (index < items.length - 1 && sum < total / 2)
            sum += items[index++].count;
        const part = total ? sum / total : .5;
        if (w > h) {
            divide(items.slice(0, index), x, y, w * part, h);
            divide(items.slice(index), x + w * part, y, w * (1 - part), h);
        }
        else {
            divide(items.slice(0, index), x, y, w, h * part);
            divide(items.slice(index), x, y + h * part, w, h * (1 - part));
        }
    }
    divide(rows, 0, 0, W, H);
    p.body.append(svg);
    exportControl(p);
    accessible(p, allRows, onClick);
}
export function network(p, data, onClick) {
    const nodes = data.nodes.slice(0, 40), ids = new Set(nodes.map(n => n.id)), edges = data.edges.filter(e => ids.has(e.source) && ids.has(e.target)).slice(0, 150);
    if (!nodes.length || !edges.length) {
        empty(p, 'No links in this subset yet. The diagram needs at least two connected nodes.');
        return;
    }
    p.body.classList.add('tall');
    // The viewBox follows the panel's real width, so a half-width panel keeps 9 px labels instead of scaling them down.
    const width = Math.max(320, Math.round(p.body.clientWidth || p.node.clientWidth || 800));
    const height = Math.max(260, Math.round(p.body.clientHeight || 340));
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': p.title, xmlns: NS });
    const cx = width / 2, cy = height / 2, rx = Math.max(70, width / 2 - 70), ry = Math.max(60, height / 2 - 55);
    const positions = new Map(nodes.map((n, i) => { const center = n.id === INSTITUTION.id, angle = i / nodes.length * Math.PI * 2; return [n.id, { x: center ? cx : cx + Math.cos(angle) * rx, y: center ? cy : cy + Math.sin(angle) * ry, angle }]; }));
    const maxLabels = width < 620 ? 8 : 12;
    const labelIds = new Set([...nodes].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, maxLabels).map(n => n.id));
    const max = Math.max(...edges.map(e => e.count));
    for (const e of edges) {
        const a = positions.get(e.source), b = positions.get(e.target);
        const l = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: CHART.link, 'stroke-opacity': .23 + e.count / max * .45, 'stroke-width': Math.min(6, 1 + Math.sqrt(e.count) / 4) });
        l.append(svgEl('title', {}, `${e.count} observed links`));
        svg.append(l);
    }
    nodes.forEach((n, i) => {
        const pos = positions.get(n.id), g = svgEl('g', { class: 'network-node', tabindex: 0, role: 'button', 'aria-label': `${n.name}: ${n.count}` });
        g.append(svgEl('circle', { cx: pos.x, cy: pos.y, r: Math.min(21, 5 + Math.sqrt(n.count || 1) / 3), fill: n.id === INSTITUTION.id ? CHART.primary : colorFor(n.id, i), stroke: '#fff', 'stroke-width': 2 }));
        g.append(svgEl('title', {}, `${n.name} · ${integer.format(n.count || 0)}`));
        if (labelIds.has(n.id)) {
            // Labels sit outside the ring and change anchor by side, so they do not pile up in one corner.
            const cos = Math.cos(pos.angle), sin = Math.sin(pos.angle);
            const anchor = cos > .3 ? 'start' : cos < -.3 ? 'end' : 'middle';
            const text = n.name.length > (width < 620 ? 20 : 28) ? n.name.slice(0, width < 620 ? 18 : 26) + '…' : n.name;
            g.append(svgEl('text', { x: pos.x + cos * 24, y: pos.y + sin * 24 + 3, 'text-anchor': anchor, 'font-size': 9, fill: CHART.text, 'font-family': 'system-ui' }, text));
        }
        g.onclick = () => onClick?.(n);
        g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.(n);
        } };
        svg.append(g);
    });
    p.body.append(svg);
    exportControl(p);
    accessible(p, nodes.map(n => ({ ...n, count: n.count || 0 })), onClick);
}
