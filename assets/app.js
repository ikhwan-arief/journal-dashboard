/*! Copyright (c) 2026 Ikhwan Arief (ikhwan[at]eng.unand.ac.id). All rights reserved.
 * Licensed under the PolyForm Noncommercial License 1.0.0
 * (https://polyformproject.org/licenses/noncommercial/1.0.0). Commercial use requires prior
 * written permission from the copyright holder. See LICENSE and NOTICE. */
import { MODULES, SDGS, SDG_COLORS, METRIC_KINDS, INSTITUTION, configureInstitution, languageName, csvCell, filterQuery, metricDrill, journalWindow, snapshotYearOf, withoutPeriod, workSdgs, citingShard, CITING_FIELDS, distributionStory, ORIGIN_GROUPS } from './metrics.js';
import { renderImpactMetrics, renderJournalRecap, renderJournalHeader, renderAuthorHeader, renderJournalMetrics, renderJournalCitations, renderJournalTable, journalEmbedURL, journalWidgetInstall, METRIC_TITLES, metricYear } from './journal-panel.js';
import { EXPORT_CONTROLS, SHOW_AUDIT_TAB, CONTENT_PROTECTION } from './config.js';
import { el, panel, bar, line, donut, stacked, scatter, heatmap, treemap, network, dots, smallMultiples, countryBubbleMap, destroyCharts, boxPlot, percentileBand, chartStory, shareBar, ORIGIN_COLORS, downloadText, PALETTE, applyTheme, sdgBars } from './charts.js';
const sdgColor = id => SDG_COLORS[Number(id) - 1] || PALETTE[0];
const $ = id => document.getElementById(id), nf = new Intl.NumberFormat('en-US'), df = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const num = n => n === null || n === undefined ? 'Not available' : nf.format(n);
const decimal = n => n === null || n === undefined ? 'Not available' : df.format(n);
const pct = n => n === null || n === undefined ? 'Not available' : decimal(n) + '%';
// Institution wording comes from manifest.institution (see setInstitution); nothing here names a specific institution.
const home = () => INSTITUTION.short_name;
const homeCountry = () => manifest?.institution?.country || INSTITUTION.country_code || 'the home country';
let scopeName = {}, descriptions = {};
function setInstitution() {
    configureInstitution(manifest.institution);
    const short = home(), name = INSTITUTION.name;
    scopeName = { all: `All works in the journals of ${short}`, affiliated: `Works affiliated with ${short}`, funded: `Works funded by ${short}`, published: `Works published in the journals of ${short}` };
    descriptions = { overview: `Publication output, citation impact and reach of the journals published by ${name}.`,
        publications: 'Browse the articles published in these journals and find the works behind every indicator.', authors: 'The people who published in these journals, ranked by their articles in the active filter.',
        citations: 'Citation distribution and journal impact, with a population you can inspect.', collaboration: 'Connections with institutions, countries and sectors through co-authored articles.',
        topics: 'Research fields, thematic concentration and shifts in the journals\' output over time.', sdgs: 'The journal portfolio mapped to the Sustainable Development Goals.',
        oa: 'Open access status and the routes through which knowledge is distributed.', funding: `Funders recorded on the articles published in the journals of ${short}.`,
        journals: `Profiles of the journals mapped to ${short} as publisher.`, repositories: 'Availability of copies, document formats and metadata completeness.',
        audit: 'Data quality, coverage and the limits of interpretation, stated openly.' };
    // Optional colour theme (config "theme", checked at build): base colours become CSS variables; every tint derives from them.
    const theme = manifest.institution.theme || {}, root = document.documentElement.style;
    const vars = { primary: '--forest', accent: '--green', highlight: '--gold', paper: '--paper', ink: '--ink', muted: '--muted', border: '--border' };
    for (const [key, name] of Object.entries(vars)) if (theme[key]) root.setProperty(name, theme[key]);
    applyTheme(theme);
    if (theme.accent) for (const [i, name] of [[2, '--teal'], [3, '--blue'], [4, '--plum'], [5, '--sage']]) root.setProperty(name, PALETTE[i]);
    if (theme.primary) document.querySelector('meta[name="theme-color"]').setAttribute('content', theme.primary);
    for (const id of ['breadcrumb-name', 'footer-name']) $(id).textContent = name;
    $('brand-name').textContent = short;
    const mark = $('brand-mark'), logo = manifest.institution.logo || {};
    mark.replaceChildren();
    if (logo.on_dark) mark.append(el('img', { src: logo.on_dark, alt: '', width: '96', height: '44' }));
    else { mark.classList.add('monogram'); mark.textContent = (short.match(/[A-Za-z0-9]/g) || ['?']).slice(0, 3).join('').toUpperCase(); }
    const icon = logo.on_light || logo.on_dark;
    if (icon) document.head.append(el('link', { rel: 'icon', href: icon }));
    const select = $('filter-scope');
    select.replaceChildren();
    for (const scope of ['all', 'affiliated', 'funded', 'published']) if (hasScope(scope))
        // Short labels keep the select readable when the organisation has a long name; the scope line spells it out.
        option(select, scope, { all: 'All', affiliated: 'Affiliated', funded: 'Funded', published: 'Published' }[scope]);
}
let manifest, history = [], currentModule = 'overview', filter = {}, data, worker, requestID = 0, renderID = 0, tablePage = 0, tableSort = 'citations';
let topicGroup = '', topicSubfield = '';
let geographyPromise;
let journalDataset, journalDatasetPromise;
const pending = new Map(), overviewCache = new Map();
// Neutral tabs default to every journal work on the full corpus; research-output tabs keep the published scope.
// Scopes exist only when the snapshot has them: a journal snapshot has "published"; a snapshot that also carries
// "affiliated"/"funded" (the institution dashboard this grew out of) adds those scopes to the selector.
const NEUTRAL_MODULES = new Set(['publications', 'oa', 'repositories']);
const hasScope = scope => Boolean(manifest?.files.overviews[scope]);
const moduleEnabled = id => (id !== 'audit' || SHOW_AUDIT_TAB) && (id !== 'journals' || hasScope('published'));
const researchScope = () => hasScope('published') ? 'published' : hasScope('affiliated') ? 'affiliated' : hasScope('funded') ? 'funded' : 'all';
const defaultScope = module => NEUTRAL_MODULES.has(module) ? 'all' : module === 'journals' ? 'published' : module === 'funding' && hasScope('funded') ? 'funded' : researchScope();
const defaultCorpus = module => NEUTRAL_MODULES.has(module) ? 'all' : 'core';
const moduleDefaults = module => ({ ...manifest.default_filter, scope: defaultScope(module), corpus: defaultCorpus(module) });
const corpusName = corpus => corpus === 'core' ? 'Core corpus' : 'All corpus';
const icons = ['◈', '▤', '♙', '↗', '⌘', '▦', '◎', '◉', '◇', '▥', '▱', '◌'];
async function getJSON(url) { const response = await fetch(url); if (!response.ok)
    throw new Error('The snapshot is not available or could not be read.'); return response.json(); }
function note(message, error = false) { $('notice').replaceChildren(); if (message)
    $('notice').append(el('div', { class: 'notice' + (error ? ' error' : '') }, message)); }
function safeURL(value) { try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
}
catch {
    return null;
} }
function external(label, url) { const safe = safeURL(url); return safe ? el('a', { href: safe, target: '_blank', rel: 'noopener noreferrer' }, label) : el('span', {}, label); }
function setHash(module, next = filter) {
    // Only values that differ from the tab defaults go into the URL; a tab switch leaves a clean hash.
    const query = filterQuery(next, moduleDefaults(module));
    const hash = module + (query ? '?' + query : '');
    if (location.hash.slice(1) !== hash) $('content').setAttribute('aria-busy', 'true');
    location.hash = hash;
}
// A navigation choice always starts from the tab's own defaults: no filter from the previous tab is carried over.
function openTab(id) {
    topicGroup = '';
    topicSubfield = '';
    const previousHash = location.hash;
    setHash(id, moduleDefaults(id));
    if (location.hash === previousHash) route();
}
const journalPage = () => currentModule === 'journals' && Boolean(filter.journal);
const currentJournal = () => journalPage() ? journalDataset?.journals.find(j => j.id === filter.journal) : null;
// Author profile page (#authors?author=A…): every work in the snapshot that lists the author.
const authorPage = () => currentModule === 'authors' && Boolean(filter.author);
const openAuthor = (author, extra = {}) => setHash('authors', { author, ...extra });
// Drills stay inside a journal or author page; on the journals overview one of the institution's journals opens its own page.
function drill(patch) {
    if (journalPage()) return setHash('journals', { ...filter, ...patch });
    if (authorPage()) return setHash('authors', { ...filter, ...patch });
    if (currentModule === 'journals' && patch.source && journalDataset?.journals.some(j => j.id === patch.source)) {
        const { source, ...rest } = patch;
        return setHash('journals', { journal: source, ...rest });
    }
    setHash('publications', { ...filter, ...patch });
}
function readRoute() {
    const [route, query = ''] = location.hash.slice(1).split('?');
    currentModule = MODULES.some(([id]) => id === route) && moduleEnabled(route) ? route : 'overview';
    const allowed = new Set(['from', 'to', 'scope', 'corpus', 'type', 'language', 'license', 'version', 'locationType', 'local', 'origin', 'field', 'topic', 'oa', 'author', 'partner', 'country', 'funder', 'award', 'source', 'sdg', 'design', 'bin', 'audit', 'metric', 'dateQuality', 'fwciQuality', 'q', 'journal', 'metricYear', 'metricKind', 'metricPart']);
    filter = moduleDefaults(currentModule);
    for (const [k, v] of new URLSearchParams(query))
        if (allowed.has(k))
            filter[k] = v;
    if (!hasScope(filter.scope))
        filter.scope = defaultScope(currentModule);
    if (!['core', 'all'].includes(filter.corpus))
        filter.corpus = defaultCorpus(currentModule);
    if (!filter.to || Number(filter.to) > Number(manifest.default_filter.to))
        filter.to = manifest.default_filter.to;
    // A journal page has one fixed population: works published by that journal, full corpus.
    if (currentModule === 'journals' && filter.journal) Object.assign(filter, { scope: 'published', corpus: 'all', source: filter.journal });
    else delete filter.journal;
    // An author page also has one fixed population: all works listing the author, any scope, full corpus.
    if (authorPage()) Object.assign(filter, { scope: 'all', corpus: 'all' });
    if (currentModule !== 'publications' && !journalPage()) { delete filter.metricKind; delete filter.metricPart; }
}
function task(action, options = {}) {
    if (!worker) {
        worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data: message }) => { const item = pending.get(message.id); if (!item)
            return; pending.delete(message.id); message.error ? item.reject(new Error(message.error)) : item.resolve(message.result); };
        worker.onerror = () => { for (const item of pending.values())
            item.reject(new Error('Processing the snapshot failed. Reload the page.')); pending.clear(); worker.terminate(); worker = null; };
    }
    return new Promise((resolve, reject) => { const id = ++requestID; pending.set(id, { resolve, reject }); worker.postMessage({ id, action, filter: { ...filter }, options, manifest, history }); });
}
function isDefault() { const baseline = { ...manifest.default_filter, scope: filter.scope, corpus: filter.scope === 'all' ? 'all' : 'core' }; return Object.entries(filter).filter(([k]) => k !== 'metricYear').every(([k, v]) => !v || String(v) === String(baseline[k] ?? '')) && ['from', 'to', 'scope', 'corpus'].every(k => String(filter[k]) === String(baseline[k])); }
async function getSummary() { if (isDefault()) {
    const scope = filter.scope;
    if (!overviewCache.has(scope))
        overviewCache.set(scope, await getJSON(manifest.files.overviews[scope].path));
    return overviewCache.get(scope);
} return task('summary', { ratios: currentModule === 'citations' }); }
function option(select, value, label) { select.append(el('option', { value }, label)); }
async function getJournalDataset() {
    if (!manifest.files.journal_metrics) return null;
    if (!journalDatasetPromise) journalDatasetPromise = getJSON(manifest.files.journal_metrics.path).then(result => {
        if (result.schema_version !== 1 || result.updated_at !== manifest.updated_at || result.policy?.version !== 1 ||
            !Array.isArray(result.journals) || !Array.isArray(result.years)) throw new Error('The journal metrics dataset does not match the snapshot.');
        return result;
    }).catch(error => { journalDatasetPromise = undefined; throw error; });
    return journalDatasetPromise;
}
function openJournal(journal, year) { setHash('journals', { journal, metricYear: year }); }
function periodLabel() {
    if (!filter.from && !filter.to) return 'All years';
    if (!filter.from) return `Up to ${filter.to}`;
    if (!filter.to) return `Since ${filter.from}`;
    return `${filter.from}–${filter.to}`;
}
function syncFilters() {
    const lastYear = Math.max(Number(manifest.default_filter.to), filter.metricKind ? Number(filter.to) : 0);
    const availableYears = [...manifest.dataset_years, lastYear, filter.from, filter.to]
        .map(Number).filter(year => Number.isInteger(year) && year >= 1500 && year <= lastYear);
    const firstYear = Math.min(...availableYears);
    for (const key of ['from', 'to', 'scope', 'corpus', 'type', 'field', 'oa']) {
        const field = $('filter-' + key);
        if (key === 'from' || key === 'to') {
            field.replaceChildren();
            if (key === 'from') option(field, '', 'All years');
            for (let year = lastYear; year >= firstYear; year--)
                option(field, year, `${year}${year === data.current_year ? ' (current)' : ''}`);
        }
        if (['type', 'field'].includes(key)) {
            field.replaceChildren();
            option(field, '', key === 'type' ? 'All types' : 'All fields');
            for (const row of data.facets[key === 'type' ? 'types' : 'fields'])
                option(field, row.id, row.name);
            if (filter[key] && ![...field.options].some(o => o.value === filter[key]))
                option(field, filter[key], filter[key]);
        }
        field.value = filter[key] ?? '';
    }
    $('active-filters').replaceChildren();
    const labels = { topic: 'Topic', author: 'Author', partner: 'Partner', country: 'Country', funder: 'Funder', award: 'Award', source: 'Source', sdg: 'SDG', design: 'Study design', language: 'Language', license: 'License', version: 'Version', locationType: 'Location', local: `${home()} affiliation`, origin: 'Author origin', bin: 'Citation range', audit: 'Audit', metric: 'Indicator', dateQuality: 'Timeline-eligible date', fwciQuality: 'FWCI eligibility', q: 'Search' };
    $('filter-scope').disabled = $('filter-corpus').disabled = journalPage() || authorPage();
    for (const [key, label] of Object.entries(labels))
        if (filter[key] !== undefined && filter[key] !== '' && !(key === 'source' && journalPage()) && !(key === 'author' && authorPage())) {
            const chip = el('span', { class: 'chip' }, `${label}: ${key === 'language' ? languageName(filter[key]) : filter[key]}`), button = el('button', { type: 'button', 'aria-label': `Remove filter ${label}` }, '×');
            button.onclick = () => { const next = { ...filter }; delete next[key]; setHash(currentModule, next); };
            chip.append(button);
            $('active-filters').append(chip);
        }
}
function kpis(container) {
    const k = data.kpis, grid = el('div', { class: 'kpi-grid' });
    const rows = [['Publications', num(k.publications), 'Unique works in the active filter', '', data.top.years.map(r => r.count)],
        ['Cumulative citations', num(k.citations), 'Citations to the selected works, as of the snapshot date', '', data.citation_years.map(r => r[1])],
        ['Open access', pct(k.oa), 'Works that can be read openly', 'oa', data.oa_years.map(r => r.total ? Object.entries(r.oa).filter(([key]) => key !== 'closed').reduce((n, [, v]) => n + v, 0) / r.total : 0)],
        ['International collaboration', pct(k.international), 'More than one affiliation country identified', 'international', data.oa_years.map(r => r.total ? r.international / r.total : 0)],
        ['Mean FWCI', decimal(k.fwci), `Available for ${num(k.fwci_n)} works · ${pct(k.fwci_coverage)}`, 'fwci', []],
        ['Top 10% works', k.eligible ? num(k.top10) : 'Not available', `${pct(k.top10_share)} of ${num(k.eligible)} works with the metric`, 'top10', []]];
    for (const [label, value, foot, metric, series] of rows) {
        const card = el('article', { class: 'kpi' });
        card.append(el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value' }, value), el('div', { class: 'kpi-foot' }, foot));
        if (metric === 'fwci') fwciHelp(card);
        const link = el('button', { class: 'kpi-link', type: 'button', 'aria-label': `Show works for ${label}` }, '↗');
        link.onclick = () => drill({ metric });
        card.append(link);
        if (series.length > 1) {
            const max = Math.max(...series, 1), min = Math.min(...series, 0), points = series.map((n, i) => `${i / (series.length - 1) * 70},${22 - (n - min) / (max - min || 1) * 20}`).join(' '), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 72 24');
            svg.setAttribute('class', 'sparkline');
            svg.setAttribute('aria-hidden', 'true');
            const poly = document.createElementNS(svg.namespaceURI, 'polyline');
            poly.setAttribute('points', points);
            poly.setAttribute('fill', 'none');
            poly.setAttribute('stroke', PALETTE[0]);
            poly.setAttribute('stroke-width', '1.8');
            svg.append(poly);
            card.append(svg);
        }
        grid.append(card);
    }
    container.append(grid);
}
function minis(container, rows) { const grid = el('div', { class: 'mini-stats' }); for (const [label, value, note] of rows) {
    const c = el('div', { class: 'mini-stat' });
    c.append(el('span', {}, label), el('strong', {}, value), el('small', {}, note || ''));
    if (label.includes('FWCI')) fwciHelp(c);
    grid.append(c);
} container.append(grid); }
function fwciHelp(container, { open = false, work = false, timeline = false } = {}) {
    const details = el('details', { class: 'fwci-help' });
    details.open = open;
    details.append(el('summary', {}, 'What FWCI means and how it is measured'),
        el('p', {}, 'FWCI (Field-Weighted Citation Impact) measures the citation impact of a work while accounting for its field, year and publication type.'),
        el('p', {}, 'FWCI per work = citations received ÷ expected citations. The benchmark is the mean citation count of OpenAlex works with the same year, type and subfield. The window covers the publication year and the three following years; cumulative citation counts may use a different span.'),
        el('p', {}, 'FWCI 1 = the global benchmark mean; 2 = twice that; 0.5 = half. The most recent years have an incomplete citation window.'));
    if (!work) details.append(el('p', {}, `Dashboard mean FWCI = sum of valid FWCI scores ÷ number of works with a valid FWCI in the filter and group shown. FWCI coverage = works with the metric ÷ all works${timeline ? ' with an eligible date in that year' : ' in the same group'} × 100%. Zero values count; missing values are not treated as 0.`));
    details.append(el('p', {}, 'Per-work scores come from OpenAlex; the dashboard does not recompute the global benchmark. This is a work metric, not a journal score.'),
        external('OpenAlex FWCI method ↗', 'https://help.openalex.org/data/works/citations/'));
    container.append(details);
}
function intro(container, text) { container.append(el('div', { class: 'module-intro' }, text)); }
function years() { return data.top.years.filter(r => Number.isFinite(Number(r.id))).map(r => Number(r.id)); }
function groupedYears(kind) { return years().map(year => ({ year, total: data.top.years.find(r => Number(r.id) === year)?.count || 0, values: Object.fromEntries(data.top[kind].map(r => [r.id, r.years[year] || 0])) })); }
function groupBar(grid, title, kind, key, noteText = '', limit = 10) { const p = panel(grid, title, noteText); bar(p, data.top[kind], { limit, onClick: r => drill({ [key]: r.id }) }); return p; }
function pubTable(container, rows = data.publications, total = data.total, { candidate = false } = {}) {
    const section = el('section', { class: 'panel table-panel publication-table' }), head = el('div', { class: 'panel-head' }), label = el('div');
    label.append(el('h2', {}, candidate ? 'Affiliation candidates to review' : 'Publications behind the numbers'), el('p', {}, candidate ? `Text-based candidates; not confirmed as ${home()} works.` : `${num(total)} works in scope · click a title for details`));
    head.append(label);
    section.append(head);
    if (!candidate) {
        const toolbar = el('div', { class: 'table-toolbar' }), search = el('input', { class: 'search-input', type: 'search', placeholder: 'Search title, DOI or author · press Enter', 'aria-label': 'Search publications' });
        search.value = filter.q || '';
        search.onkeydown = e => { if (e.key === 'Enter') {
            e.preventDefault();
            drill({ q: search.value.trim() });
        } };
        const sort = el('select', { 'aria-label': 'Sort publications' });
        for (const [v, l] of [['citations', 'Most cited'], ['year', 'Newest'], ['title', 'Title A–Z']])
            option(sort, v, l);
        sort.value = tableSort;
        sort.onchange = () => { tableSort = sort.value; tablePage = 0; loadTable(section); };
        toolbar.append(search, sort);
        section.append(toolbar);
    }
    const tableWrap = el('div', { class: 'table-scroll' }), table = el('table'), thead = el('thead'), tr = el('tr');
    const columns = [['Publication', ''], ['Year', 'num'], ...(filter.metricKind ? [[filter.metricKind === 'fwci' ? 'Work FWCI' : 'Citations in window', 'num']] : []), ['Cumulative citations', 'num'], ['Access', '']];
    for (const [text, cls] of columns)
        tr.append(el('th', { scope: 'col', class: cls }, text));
    thead.append(tr);
    table.append(thead);
    const tbody = el('tbody');
    table.append(tbody);
    tableWrap.append(table);
    section.append(tableWrap);
    function renderRows(items) {
        tbody.replaceChildren();
        for (const row of items) {
            const tr = el('tr'), title = el('td'), button = el('button', { class: 'work-title', type: 'button', 'data-work-id': row.id }, row.title);
            button.onclick = () => openWork(row.id);
            title.append(button);
            if (row.source_name)
                title.append(el('span', { class: 'work-source' }, row.source_name));
            if (row.retracted)
                title.append(el('span', { class: 'warning-tag' }, 'Retraction flag · check the context'));
            if (row.record_source === 'crossref')
                title.append(el('span', { class: 'source-tag', title: 'Registered under the DOI prefix at Crossref but not found in OpenAlex: no FWCI, topics, SDGs or affiliations.' }, 'Crossref only'));
            const access = el('td');
            access.append(el('span', { class: `oa-tag ${row.oa_status === 'closed' ? 'closed' : ''}` }, row.oa_status || 'Audit candidate'));
            tr.append(title, el('td', { class: 'num' }, row.year || '—'));
            if (filter.metricKind) tr.append(el('td', { class: 'num journal-contribution' }, filter.metricKind === 'fwci' ? decimal(row.journal_citations) : num(row.journal_citations)));
            tr.append(el('td', { class: 'num' }, row.citations === undefined ? '—' : num(row.citations)), access);
            tbody.append(tr);
        }
        if (!items.length) {
            const td = el('td', { colspan: columns.length }, 'No publications match this filter.');
            const row = el('tr');
            row.append(td);
            tbody.append(row);
        }
    }
    renderRows(rows);
    const pagination = el('div', { class: 'pagination' }), count = el('span', {}, candidate ? `${num(rows.length)} candidates shown` : `${total?1:0}–${Math.min(50, total)} of ${num(total)}`), buttons = el('div');
    if (!candidate) {
        const prev = el('button', { type: 'button' }, '← Previous'), next = el('button', { type: 'button' }, 'Next →');
        prev.disabled = true;
        next.disabled = total <= 50;
        prev.onclick = () => { tablePage = Math.max(0, tablePage - 1); loadTable(section); };
        next.onclick = () => { tablePage++; loadTable(section); };
        buttons.append(prev, next);
        section.tableControls = { prev, next, count };
    }
    pagination.append(count, buttons);
    section.append(pagination);
    section.renderRows = renderRows;
    container.append(section);
    return section;
}
async function loadTable(section) { note('Loading snapshot details…'); try {
    const page = await task('page', { page: tablePage, sort: tableSort });
    if (!section.isConnected)
        return;
    section.renderRows(page.rows);
    const c = section.tableControls;
    c.prev.disabled = tablePage === 0;
    c.next.disabled = (tablePage + 1) * 50 >= page.total;
    c.count.textContent = `${page.total ? tablePage * 50 + 1 : 0}–${Math.min((tablePage + 1) * 50, page.total)} of ${num(page.total)}`;
    note('');
}
catch (e) {
    note(e.message, true);
} }
function selectors(container) {
    const configs = {
        authors: [['author', `${home()} authors`, data.top.authors]], collaboration: [['partner', 'Partner institutions', data.top.partners], ['country', 'Countries', data.top.countries]],
        topics: [['topic', 'Mapped topics', data.facets.topics]], sdgs: [['sdg', 'SDG goals', Array.from({ length: 17 }, (_, i) => ({ id: String(i + 1), name: `SDG ${i + 1} · ${SDGS[i]}` }))]],
        funding: [['funder', 'Funders', data.top.funders], ['award', 'Awards', data.top.awards]],
        publications: [['topic', 'Mapped topics', data.facets.topics], ['source', 'Sources', data.top.sources]],
        audit: [['audit', 'Check type', [{ id: 'doi', name: 'No DOI' }, { id: 'abstract', name: 'No abstract' }, { id: 'source', name: 'Unknown source' }, { id: 'date', name: 'Implausible date' }, { id: 'affiliation', name: 'Incomplete affiliation' }, {id:'author_id',name:'Authors without a profile ID'}, { id: 'retracted', name: 'Retraction flag' }]]],
    };
    const list = configs[currentModule];
    if (!list)
        return;
    const form = el('form', { class: 'table-toolbar' });
    for (const [key, label, rows] of list) {
        if (key === 'topic') {
            topicSelector(form, rows);
            continue;
        }
        const input = el('select', { 'aria-label': label });
        option(input, '', `All · ${label}`);
        for (const r of rows)
            option(input, r.id, r.name);
        input.value = filter[key] || '';
        input.onchange = () => setHash(currentModule, { ...filter, [key]: input.value });
        form.append(input);
    }
    container.append(form);
}
function topicSelector(form, rows) {
    const groups = new Map(), fieldNames = new Map(data.facets.fields.map(row => [row.id, row.name]));
    for (const row of rows) {
        const field = row.field || 'unknown';
        if (!groups.has(field)) groups.set(field, []);
        groups.get(field).push(row);
    }
    const groupLabel = field => fieldNames.get(field) || 'Unmapped field';
    const activeTopic = rows.find(row => row.id === filter.topic);
    if (activeTopic) {
        topicGroup = activeTopic.field || 'unknown';
        topicSubfield = activeTopic.subfield || 'Other topics';
    }
    if (!groups.has(topicGroup)) { topicGroup = ''; topicSubfield = ''; }
    const group = el('select', { id: 'topic-group', 'aria-label': 'Topic group' });
    const subfield = el('select', { id: 'topic-subfield', 'aria-label': 'Topic subfield' });
    const topic = el('select', { id: 'mapped-topic', 'aria-label': 'Mapped topic', 'aria-describedby': 'topic-help' });
    option(group, '', 'Choose a field group');
    for (const [field, topics] of [...groups].sort((a, b) => groupLabel(a[0]).localeCompare(groupLabel(b[0]), 'en')))
        option(group, field, `${groupLabel(field)} (${num(topics.length)} topics)`);
    group.value = topicGroup;
    function fillTopics() {
        topic.replaceChildren();
        option(topic, '', topicSubfield ? 'Choose a topic' : 'Choose a field and subfield first');
        const topics = (groups.get(topicGroup) || []).filter(row => (row.subfield || 'Other topics') === topicSubfield);
        for (const row of topics.sort((a, b) => a.name.localeCompare(b.name, 'en')))
            option(topic, row.id, row.name);
        if (filter.topic && !rows.some(row => row.id === filter.topic))
            option(topic, filter.topic, `Active topic · ${filter.topic}`);
        topic.disabled = (!topicGroup || !topicSubfield) && !filter.topic;
        topic.value = filter.topic || '';
    }
    function fillSubfields() {
        const subfields = new Map();
        for (const row of groups.get(topicGroup) || []) {
            const label = row.subfield || 'Other topics';
            subfields.set(label, (subfields.get(label) || 0) + 1);
        }
        subfield.replaceChildren();
        option(subfield, '', topicGroup ? 'Choose a subfield' : 'Choose a field group first');
        for (const [label, count] of [...subfields].sort((a, b) => a[0].localeCompare(b[0], 'en')))
            option(subfield, label, `${label} (${num(count)} topics)`);
        if (!subfields.has(topicSubfield)) topicSubfield = '';
        subfield.value = topicSubfield;
        subfield.disabled = !topicGroup;
        fillTopics();
    }
    function clearTopicOrFill() {
        if (!filter.topic) { fillSubfields(); return; }
        const next = { ...filter };
        delete next.topic;
        setHash(currentModule, next);
    }
    group.onchange = () => {
        topicGroup = group.value;
        topicSubfield = '';
        clearTopicOrFill();
    };
    subfield.onchange = () => { topicSubfield = subfield.value; clearTopicOrFill(); };
    topic.onchange = () => setHash(currentModule, { ...filter, topic: topic.value });
    fillSubfields();
    const groupLabelNode = el('label', { class: 'topic-control' }, 'Topic group');
    const subfieldLabelNode = el('label', { class: 'topic-control' }, 'Subfield');
    const topicLabelNode = el('label', { class: 'topic-control mapped-topic-control' }, 'Mapped topic');
    groupLabelNode.append(group);
    subfieldLabelNode.append(subfield);
    topicLabelNode.append(topic);
    form.append(groupLabelNode, subfieldLabelNode, topicLabelNode, el('small', { id: 'topic-help', class: 'topic-help' }, 'Choose a field, a subfield, then a topic. The filter applies once a topic is chosen.'));
}
// The single Journals table: dataset metrics merged with every journal's output in the active filter.
async function journalTable(content) {
    const section = el('section', { class: 'panel table-panel journal-table', 'aria-busy': 'true' });
    section.append(el('p', { class: 'panel-note' }, 'Loading the journal table…'));
    content.append(section);
    if (!journalDataset?.journals.length) { section.replaceChildren(el('p', { class: 'empty-state' }, `No journals are mapped to ${home()} as publisher yet.`)); section.setAttribute('aria-busy', 'false'); return; }
    const thisRender = renderID, year = metricYear(journalDataset.years, journalDataset.defaults.year, filter);
    try {
        const result = await task('entities', { kind: 'sources', pageSize: 'all' });
        if (thisRender !== renderID) return;
        renderJournalTable(section, journalDataset, year, new Map(result.rows.map(r => [r.id, r])), openJournal);
    }
    catch (error) {
        if (thisRender !== renderID) return;
        section.replaceChildren(el('p', { class: 'empty-state' }, 'The journal table could not be shown. Reload the page.'));
        section.setAttribute('aria-busy', 'false');
    }
}
// Context above a drill list: which metric, year and population the listed works form.
function metricContext(content, journal) {
    const kind = filter.metricKind, year = Number(filter.metricYear);
    const row = journal ? journal.series[kind].find(r => r.year === year) : data.metric_row;
    const context = el('section', { class: 'panel journal-drill-context' });
    const owner = journal ? journal.name : scopeName[filter.scope];
    context.append(el('h2', {}, `${journal && kind === 'fwci' ? 'Journal FWCI' : METRIC_TITLES[kind]} · ${year} · ${owner}`));
    if (row) context.append(el('p', {}, kind === 'fwci'
        ? `${num(row.denominator)} works with a valid FWCI out of ${num(row.total_documents)} works published in ${row.year}. Sum of FWCI scores ${decimal(row.numerator)} ÷ ${num(row.denominator)} works with the metric = ${decimal(row.value)}.`
        : `${filter.metricPart === 'numerator' ? 'Documents targeted by the numerator, including documents with zero citations' : 'Denominator documents'}. ${num(row.numerator)} citations ÷ ${num(row.denominator)} documents. Publication period ${row.publication_from}–${row.publication_to}; citations ${row.citation_from}–${row.citation_to}.`));
    context.append(el('p', {}, `The ${kind === 'fwci' ? 'Work FWCI column shows the scores that form the mean' : 'Citations in window column shows what each work contributes'}. Cumulative citations and the general indicator cards use all citations as of the snapshot. ${journal ? 'The list holds only this journal\'s works. ' : 'The list uses the same scope and filters as the indicator. '}Search only narrows the list of documents; it does not recompute the value. Applying Explore the data ends this metric breakdown.`));
    if (kind === 'fwci') fwciHelp(context);
    const back = el('button', { class: 'button secondary', type: 'button' }, journal ? 'Back to the journal page' : 'Back to Citation impact');
    back.onclick = () => journal ? openJournal(journal.id, year)
        : setHash('citations', { ...withoutPeriod(filter), from: manifest.default_filter.from, to: manifest.default_filter.to, metricYear: year });
    context.append(back); content.append(context);
}
function render() {
    destroyCharts();
    const content = $('content');
    content.replaceChildren();
    content.setAttribute('aria-busy', 'false');
    const title = MODULES.find(([id]) => id === currentModule)[1];
    $('page-title').textContent = currentModule === 'overview' ? 'Journal portfolio' : title;
    $('page-description').textContent = descriptions[currentModule];
    document.title = `${title} · ${INSTITUTION.name}`;
    document.querySelectorAll('.nav-link').forEach(a => { const active = a.dataset.module === currentModule; a.classList.toggle('active', active); active ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
    syncFilters();
    const journal = currentJournal(), author = authorPage() ? data.author_profile : null;
    if (author) {
        $('page-title').textContent = author.name;
        $('page-description').textContent = `Author profile in the journals of ${home()}.`;
        document.title = `${author.name} · Authors · ${INSTITUTION.name}`;
        renderAuthorHeader(content, author, home(), () => setHash('authors', {}));
    }
    if (journal) {
        document.title = `${journal.name} · Journals · ${INSTITUTION.name}`;
        renderJournalHeader(content, journalDataset, journal, () => setHash('journals', { metricYear: filter.metricYear }));
    }
    const scope = el('div', { class: 'scope-line' });
    scope.append(el('span', {}, `${journal ? journal.name : author ? `Works of ${author.name}` : scopeName[filter.scope]} · ${periodLabel()} · ${corpusName(filter.corpus)}`), el('strong', {}, `${num(data.total)} unique works`));
    content.append(scope);
    if ((!filter.from || Number(filter.from) <= data.current_year) && (!filter.to || Number(filter.to) >= data.current_year))
        intro(content, `${data.current_year} is not complete yet. The year in progress is not compared as if it were a full calendar year.`);
    if (filter.scope === 'all' && !journal && !author) {
        // Only the scopes this snapshot really has are named; a journal snapshot has one.
        const parts = [hasScope('affiliated') && `affiliated with ${home()}`, hasScope('funded') && `funded by ${home()}`, hasScope('published') && `published in the journals of ${home()}`].filter(Boolean);
        const phrase = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0];
        intro(content, `The All scope combines the works ${phrase}; each work counts once.${hasScope('affiliated') ? ` Some works have no ${home()} author, so these numbers do not measure ${home()} research output alone.` : ''}`);
    }
    else if (filter.scope !== 'affiliated' && !journal && !author)
        intro(content, filter.scope === 'funded' ? `This scope holds works that list ${home()} as a funder. Authors may be affiliated with other institutions.` : `This scope holds the works published in the journals of ${home()}, including articles by authors outside ${home()}.`);
    kpis(content);
    if (currentModule === 'journals' && !journal)
        renderJournalRecap(content, journalDataset, filter, year => setHash('journals', { ...filter, metricYear: year }));
    if (journal && !filter.metricKind)
        renderJournalMetrics(content, journalDataset, journal, filter, { onYear: year => setHash('journals', { ...filter, metricYear: year }),
            onDrill: (kind, part, year) => setHash('journals', { ...metricDrill(year, kind, part, journal.id) }) });
    if (currentModule === 'citations') {
        const ratios = data.citation_ratios, year = metricYear(ratios.years, ratios.default_year, filter);
        renderImpactMetrics(content, ratios, { title: 'Citation impact indicators', fwciTitle: 'FWCI', years: ratios.years, snapshotYear: ratios.snapshot_year, year,
            populationLabel: scopeName[filter.scope].charAt(0).toLowerCase() + scopeName[filter.scope].slice(1),
            populationText: `The population follows the active scope (${scopeName[filter.scope]}) and the Explore the data filters except the period; the publication period is set by the metric year window.`,
            note: `4-year citation ratio (CiteScore pattern), 2-year citation ratio (JIF pattern) and FWCI for ${scopeName[filter.scope]} in the selected metric year. The Explore the data filters apply except the period: the publication window follows the metric year. FWCI uses the same date checks and minimum base as the FWCI timeline.`,
            footer: `${scopeName[filter.scope]} · ${corpusName(filter.corpus)} · Snapshot ${manifest.updated_at}`,
            onYear: next => setHash('citations', { ...filter, metricYear: next }),
            onDrill: (kind, part, metric) => kind === 'fwci' ? drill({ from: metric, to: metric, metric: 'fwci', fwciQuality: 'valid' })
                : setHash('publications', { ...withoutPeriod(filter), ...metricDrill(metric, kind, part) }) });
    }
    if (filter.metricKind) metricContext(content, journal);
    if (!journal && !author) selectors(content);
    const grid = el('div', { class: 'charts-grid' });
    content.append(grid);
    const k = data.kpis;
    const drillYear = r => drill({ from: r.id ?? r.year, to: r.id ?? r.year });
    if (currentModule === 'overview') {
        growthTimeline(grid);
        fwciTimeline(grid);
        const p = panel(grid, 'Publications over time', 'Unique works by publication year.');
        line(p, data.top.years, { onClick: drillYear });
        const q = panel(grid, 'Work types', 'Document types follow the OpenAlex normalisation.');
        stacked(q, groupedYears('types'), data.top.types.slice(0, 6), { onClick: (y, s) => drill({ from: y.year, to: y.year, type: s.id }) });
        treemap(panel(grid, 'Research field landscape', 'One main field per work; click a field to explore.'), data.top.fields, r => drill({ field: r.id }));
        groupBar(grid, 'Top partner institutions', 'partners', 'partner', 'One work can involve several partners.');
        minis(content, [['Growth ' + k.growth_year, pct(k.growth), 'Compared with the previous complete year'],
            ['Authors observed', num(k.authors), 'Profiles with an OpenAlex ID in the filter'],
            ['Partner institutions', num(k.partners), 'From publication affiliations'], ['Works cited', pct(k.cited_share), 'At least one citation in the snapshot']]);
    }
    else if (currentModule === 'publications') {
        growthTimeline(grid);
        const annual = data.annual_fwci;
        fwciTimeline(grid);
        stacked(panel(grid, 'Work types by year', 'Unique works; minor types may fall outside the top six series.'), groupedYears('types'), data.top.types.slice(0, 6), { onClick: (y, s) => drill({ from: y.year, to: y.year, type: s.id }) });
        bar(panel(grid, 'Citation distribution', 'Click a range to see its publications.'), data.histogram, { horizontal: false, onClick: r => drill({ bin: r.id }) });
        groupBar(grid, 'Top publication sources', 'sources', 'source');
        groupBar(grid, 'Metadata language', 'languages', 'language', 'Language of the title or abstract, not necessarily of the full text.');
        annualFWCITable(content, annual);
    }
    else if (author) {
        // Two per row, every chart on this author's works only; clicks narrow this page.
        line(panel(grid, 'Publications over time', 'The author\'s works by publication year. Click a year to narrow this page.'), data.top.years, { onClick: drillYear });
        line(panel(grid, 'Citations by year received', 'Citations to the author\'s works in each year (OpenAlex counts_by_year); the available window is limited.'), data.citation_years.map(([year, count]) => ({ year, count })), { label: 'Citations', unit: 'citations' });
        stacked(panel(grid, 'Work types by year', 'Minor types may fall outside the top six series.'), groupedYears('types'), data.top.types.slice(0, 6), { onClick: (y, s) => drill({ from: y.year, to: y.year, type: s.id }) });
        bar(panel(grid, 'Citation distribution', 'Number of works per citation range. Click a range to see its works.'), data.histogram, { horizontal: false, onClick: r => drill({ bin: r.id }) });
        groupBar(grid, 'Top publication sources', 'sources', 'source');
        groupBar(grid, 'Metadata language', 'languages', 'language', 'Language of the title or abstract, not necessarily of the full text.');
        sdgCard(grid, 'SDGs of the author\'s works');
        donut(panel(grid, 'Open access routes', 'OA status of the author\'s works at the snapshot date.'), data.top.oa, r => drill({ oa: r.id === 'unknown' ? '' : r.id }));
        treemap(panel(grid, 'Research fields', 'One main field per work; click a field to narrow this page.'), data.top.fields, r => drill({ field: r.id }));
        groupBar(grid, 'Leading topics', 'topics', 'topic', 'One work can belong to several topics.');
        groupBar(grid, 'Co-authors\' institutions', 'partners', 'partner', `Institutions other than ${home()} on the author's works.`);
        const fwciYears = data.annual_fwci.filter(r => r.count > 0);
        const fwciPanel = panel(grid, 'Mean FWCI by publication year', 'Mean of valid FWCI scores of the author\'s works per publication year; dashed line: global benchmark 1. Years with few works are volatile.');
        line(fwciPanel, fwciYears.map(r => ({ year: r.year, value: r.fwci, n: r.fwci_n })), { value: 'value', label: 'Mean FWCI', unit: 'FWCI', reference: 1, referenceLabel: 'Global benchmark FWCI 1', color: PALETTE[3],
            tooltip: r => `${r.year}: mean FWCI ${r.value === null ? 'not available' : decimal(r.value)} · ${num(r.n)} works with FWCI${r.n < 5 ? ' · small base' : ''}`, onClick: drillYear });
        fwciHelp(fwciPanel.node);
        minis(content, [['h-index here', num(k.h_index), 'Within the works on this page'], ['Median citations', decimal(k.median_citations), 'Per work'], ['Works cited', pct(k.cited_share), 'At least one citation'], ['FWCI coverage', pct(k.fwci_coverage), 'Works with a valid FWCI']]);
        collaborationMap(grid, { title: 'Collaboration countries', includeHome: true, unit: 'works',
            note: `Affiliation countries of all authors on these works, including ${homeCountry()}. Bubble area is proportional to the number of works; one work can count for several countries.` });
    }
    else if (currentModule === 'authors') {
        intro(content, 'Every statistic in the author charts counts the authors of the articles in the active filter, whatever their affiliation. An author counts once per article, and only authors with an OpenAlex ID form a profile.');
        const authorBars = panel(grid, 'Most productive authors in these journals', 'Authors by articles in the active filter. Click an author to open their profile.');
        bar(authorBars, data.top.authors, { limit: 10, onClick: r => openAuthor(r.id) });
        scatter(panel(grid, 'Author productivity and citations', 'At most the 50 most productive authors in the active filter. Click an author to open their profile.'), data.top.authors, { onClick: r => openAuthor(r.id) });
        smallMultiples(panel(grid, 'Author activity across years', 'Line charts for the top 10 authors by articles in the active filter. Each author\'s range starts and ends at their publication years within the selected chart range; gaps in between stay at zero. The vertical scale is shared; horizontal ranges may differ. Click a point to open that author\'s profile for the year.', true), data.top.authors, years(), (r, y) => openAuthor(r.id, { from: y, to: y }), { individual: true });
        minis(content, [['Authors observed', num(k.authors), 'Profiles with an OpenAlex ID in the filter'], ['With ORCID', num(data.coverage.orcid_authors), 'Of the observed author profiles'], ['First authors', num(k.first), 'Profiles first author on at least one article'], ['Corresponding authors', num(k.corresponding), 'Profiles flagged corresponding on at least one article']]);
        entityTable(content, 'authors');
        intro(content, `${num(data.quality.author_id)} works have authorships without an OpenAlex author ID. Their available names, affiliations and positions are still shown; these authorships are not merged into one author profile and cannot be ranked.`);
    }
    else if (currentModule === 'citations') {
        fwciTimeline(grid);
        distributionCharts(grid, { wide: true });
        bar(panel(grid, 'Citation distribution of works', 'Includes works not yet cited.'), data.histogram, { horizontal: false, onClick: r => drill({ bin: r.id }) });
        line(panel(grid, 'Citations by year received', 'Counts from counts_by_year; the available window is limited, not the full history.'), data.citation_years.map(([year, count]) => ({ year, count })), { label: 'Citations observed',unit:'citations' });
        scatter(panel(grid, 'Work age and citations', 'At most the 250 most cited works; age is counted from the snapshot year.'), data.scatter, { x: 'age', y: 'citations', xTitle: 'Work age (years)', onClick: r => openWork(r.id) });
        bar(panel(grid, 'Normalised impact groups', `Percentile coverage: ${num(k.eligible)} works · ${pct(k.percentile_coverage)}.`), k.eligible ? [{ id: 'top1', name: 'Top 1%', count: k.top1 }, { id: 'top10', name: 'Top 10% (includes top 1%)', count: k.top10 }] : [], { limit: 2, onClick: r => drill({ metric: r.id }) });
        const net = panel(grid, filter.scope === 'affiliated' ? `Links between ${home()} works` : 'Links between the selected works', 'A subset of at most the 40 most cited works; links are observed references.', true);
        const select = el('select', { 'aria-label': 'Citation network type' });
        for (const [v, l] of [['citations', 'Direct citation'], ['coupling', 'Bibliographic coupling'], ['cocitation', 'Co-citation']])
            option(select, v, l);
        net.actions.append(select);
        const draw = () => { net.body.replaceChildren(); net.node.querySelector('.chart-data')?.remove(); net.actions.querySelector('.chart-export')?.remove(); network(net, data.networks[select.value], r => openWork(r.id)); };
        select.onchange = draw;
        draw();
        minis(content, [['Median citations', decimal(k.median_citations), 'Little affected by outliers'], ['Scope h-index', num(k.h_index), 'Only the active set of works'], ['Mean citations', decimal(data.total ? k.citations / data.total : null), 'Cumulative citations per work'], ['FWCI coverage', pct(k.fwci_coverage), 'Missing values are left out of the mean']]);
    }
    else if (currentModule === 'collaboration') {
        scatter(panel(grid, 'Partner countries', `Countries other than ${homeCountry()}; one work can count for several countries.`), data.top.countries.filter(r => r.id !== INSTITUTION.country_code), { bubble: true, onClick: r => drill({ country: r.id }) });
        groupBar(grid, 'Connected institutions', 'partners', 'partner', 'Multiple affiliations can also form publication links.');
        collaborationMap(grid);
        network(panel(grid, 'Institutional collaboration network', 'Lines show co-authored works; they are not evidence of a formal agreement.', true), data.networks.partners, r => r.id !== INSTITUTION.id && drill({ partner: r.id }));
        smallMultiples(panel(grid, 'Partners by publication year', 'Line charts for the top 10 partner institutions. Years that are zero for every partner shown are hidden, so the axis years may not be consecutive. This filters the display only; source data is not removed. The vertical scale is shared; one work can involve several partners.', true), data.top.partners, years(), (r, y) => drill({ partner: r.id, from: y, to: y }), { omitEmpty: true });
        line(panel(grid, 'International collaboration share', 'Percentage of works with more than one identified country.'), data.oa_years.map(y => ({ year: y.year, count: y.total ? y.international / y.total * 100 : null })), { percent: true });
        bar(panel(grid, 'Partner sectors', 'One work can cover more than one sector.'), data.top.sectors, { limit: 10 });
        entityTable(content, 'partners');
    }
    else if (currentModule === 'topics') {
        treemap(panel(grid, 'Main field composition', 'Area is proportional to the number of works.', true), data.top.fields, r => drill({ field: r.id }));
        heatmap(panel(grid, 'Research topics over time', 'Top ten topics; one work can belong to several topics.'), data.top.topics, years(), (r, y) => drill({ topic: r.id, from: y, to: y }));
        const impact = panel(grid, 'Field volume and impact', 'Bubble size follows volume; the vertical axis is the mean FWCI of works with the metric in each field.');
        scatter(impact, data.top.fields.filter(r => r.fwci_n).map(r => ({ ...r, impact: r.fwci_sum / r.fwci_n })), { y: 'impact', yTitle: 'Mean FWCI', bubble: true, onClick: r => drill({ field: r.id }) });
        fwciHelp(impact.node);
        groupBar(grid, 'Leading topics', 'topics', 'topic','Categories can overlap; their sum is not a count of unique works.');
        const latest = Math.min(Number(filter.to) || data.current_year - 1, data.current_year - 1), growing = data.top.topics.map(r => ({ ...r, growth: r.years[latest - 1] ? ((r.years[latest] || 0) - r.years[latest - 1]) / r.years[latest - 1] * 100 : null })).filter(r => r.growth !== null && r.growth > 0).sort((a, b) => b.growth - a.growth);
        bar(panel(grid, 'Growing topics', `Percentage growth ${latest} over ${latest - 1} among the top 50 topics; only bases above 0.`), growing, { value: 'growth', unit: '%', onClick: r => drill({ topic: r.id }) });
        minis(content, [['Share of the three largest fields', pct(k.top3_fields_share), 'Includes the unknown category if present'], ['Field concentration (HHI)', decimal(k.field_concentration), 'Range 0–1; higher means more concentrated']]);
    }
    else if (currentModule === 'sdgs') {
        intro(content, 'SDG labels come from a text classification model. One work can belong to several goals. Category counts must not be summed as unique works or read as evidence of measured social impact.');
        const all = Array.from({ length: 17 }, (_, i) => data.top.sdgs.find(r => r.id === String(i + 1)) || { id: String(i + 1), name: `SDG ${i + 1} · ${SDGS[i]}`, count: 0, years: {} });
        const p = panel(grid, 'Portfolio across the 17 goals', 'Official goal order 1–17, with the UN icon and colour of each goal. Click a goal to explore its publications.', true);
        sdgBars(p, all, { limit: 17, onClick: r => drill({ sdg: r.id }) });
        sdgNotice(p.node);
        smallMultiples(panel(grid, 'SDGs across years', 'Line charts for the 10 goals with the most works. Years that are zero for every goal shown are hidden, so the axis years may not be consecutive. Source data stays intact. The vertical scale is shared; one work can belong to several goals.', true), data.top.sdgs, years(), (r, y) => drill({ sdg: r.id, from: y, to: y }), { omitEmpty: true, colorOf: r => sdgColor(r.id) });
        const fieldIds = data.top.fields.slice(0, 8).map(r => r.id);
        scatter(panel(grid, 'SDGs and fields', 'X axis: SDG number; Y axis: the order of main fields listed below the chart.'), data.sdg_fields.filter(r => fieldIds.includes(r.field)).map(r => ({ ...r, name: `SDG ${r.sdg} · ${r.name}`, x: Number(r.sdg), y: fieldIds.indexOf(r.field) + 1 })), { x: 'x', y: 'y', xTitle: 'SDG number', yTitle: 'Main field order', bubble: true, colorOf: r => sdgColor(r.sdg), onClick: r => drill({ sdg: r.sdg, field: r.field }) });
        grid.lastElementChild.append(el('p', { class: 'panel-note' }, data.top.fields.slice(0, 8).map((r, i) => `${i + 1}. ${r.name}`).join(' · ')));
        groupBar(grid, 'Identified study designs', 'designs', 'design', 'Automatic classification; categories can overlap.');
    }
    else if (currentModule === 'oa') {
        donut(panel(grid, 'Open access routes', 'OA status at the snapshot date.'), data.top.oa, r => drill({ oa: r.id === 'unknown' ? '' : r.id }));
        stacked(panel(grid, 'OA composition over time', 'Share of each category per year; the denominator is all works of that year.'), data.oa_years.map(y => ({ ...y, values: y.oa })), data.top.oa, { percentage: true, onClick: (y, s) => drill({ from: y.year, to: y.year, oa: s.id }) });
        const statuses = data.top.oa.map(r => r.id), rows = data.top.fields.slice(0, 8).map(r => ({ ...r, years: Object.fromEntries(statuses.map(s => [s, data.oa_fields.find(x => x.field === r.id && x.oa === s)?.count || 0])) }));
        heatmap(panel(grid, 'Fields and access routes', 'Number of works; categories follow the OpenAlex status.', true), rows, statuses, (r, s) => drill({ field: r.id, oa: s }));
        minis(content, [['Any repository copy', num(data.coverage.any_repo), 'At least one repository holds a copy'], ['License known', num(data.coverage.license), 'At least one licensed copy'], ['PDF available', num(data.coverage.pdf), 'Content service metadata'], ['Open works', pct(k.oa), 'Does not by itself grant reuse rights']]);
    }
    else if (currentModule === 'funding') {
        intro(content, hasScope('funded') ? `Use the Scope option to tell all works funded by ${home()} apart from the funders of works affiliated with ${home()}. Missing funding metadata does not mean the research was unfunded.` : `OpenAlex lists no funder record for ${home()}, so this tab shows the funders recorded on works in the active scope. Missing funding metadata does not mean the research was unfunded.`);
        // Recorded funders and the funder-topic network sit side by side; the yearly lines span the row below.
        groupBar(grid, 'Recorded funders', 'funders', 'funder');
        network(panel(grid, 'Funders and research topics', 'Links show a funder and a topic on the same work.'), data.networks.funding, r => drill(r.id.startsWith('F') ? { funder: r.id } : { topic: r.id }));
        smallMultiples(panel(grid, 'Funding by year', 'Line charts for the 10 funders with the most publications in the active scope. Years that are zero for every funder shown are hidden, so the axis years may not be consecutive. Source data stays intact. The vertical scale is shared; one work can have several funders.', true), data.top.funders, years(), (r, y) => drill({ funder: r.id, from: y, to: y }), { omitEmpty: true });
        minis(content, [['Works with a funder', num(data.total - data.quality.funder), 'Funding metadata completeness'], ['Awards identified', num(data.top.awards.length), 'At most 50 in the summary'], ['List APC known', num(k.apc_n), 'List price, not institutional spending'], ['OpenAPC payments', num(k.paid_verified), 'Articles with OpenAPC provenance']]);
        intro(content, `Mean known list APC: ${k.apc_mean === null ? 'Not available' : 'US$ ' + decimal(k.apc_mean)}. ${num(k.paid_fallback)} estimated payment records use provenance other than OpenAPC. These are not summed as actual ${home()} spending.`);
        entityTable(content, 'funders');
    }
    else if (journal && !filter.metricKind) {
        // Two per row: citations per year | publications per year, types | access, countries | affiliation origin.
        // Citations per year is fixed for the journal; the other charts use the journal-only summary and narrow this page.
        renderJournalCitations(grid, journalDataset, journal, filter, year => setHash('journals', { ...filter, metricYear: year }));
        line(panel(grid, 'Journal publications over time', 'Journal works by publication year. Click a year to narrow this page.'), data.top.years, { onClick: drillYear });
        distributionCharts(grid, { owner: journal.name });
        stacked(panel(grid, 'Work types by year', 'Unique works of this journal; minor types may fall outside the top six series.'), groupedYears('types'), data.top.types.slice(0, 6), { onClick: (y, s) => drill({ from: y.year, to: y.year, type: s.id }) });
        stacked(panel(grid, 'Access composition by year', 'Share of OA status for this journal\'s works per year.'), data.oa_years.map(y => ({ ...y, values: y.oa })), data.top.oa, { percentage: true, onClick: (y, s) => drill({ from: y.year, to: y.year, oa: s.id }) });
        // SDG card beside author affiliation (as in the OJS widget).
        sdgCard(grid, 'SDGs of journal works');
        originPanel(grid);
        // Contributor countries as a full-width bubble map at the bottom, home country included.
        collaborationMap(grid, { title: 'Contributor countries', includeHome: true, unit: 'works',
            note: `Every author affiliation country on this journal's works, including ${homeCountry()}. Bubble area is proportional to the number of works; one work can count for several countries. Hover, focus or tap a bubble to see its count.` });
    }
    else if (currentModule === 'journals' && !journal) {
        groupBar(grid, 'Sources by output', 'sources', 'source', 'Mapped sources; not an official list of all active journals.');
        scatter(panel(grid, 'Source volume and citations'), data.top.sources, { bubble: true, onClick: r => drill({ source: r.id }) });
        groupBar(grid, 'Contributor countries', 'countries', 'country', `Works published by ${home()} can be written by researchers outside ${home()}.`);
        stacked(panel(grid, 'Access composition by year'), data.oa_years.map(y => ({ ...y, values: y.oa })), data.top.oa, { percentage: true, onClick: (y, s) => drill({ from: y.year, to: y.year, oa: s.id }) });
        const origins = panel(grid, 'Author origin by journal', `The 10 journals with the most works in the active filter. Each bar = 100% of that journal's authorships. ${originNote()}`, true);
        origins.node.classList.add('source-origins');
        origins.body.style.height = '510px';
        stacked(origins, data.top.journals.map(r => ({ year: r.name, total: ORIGIN_GROUPS.reduce((n, g) => n + (r.origin?.[g] || 0), 0), source: r.id, values: r.origin || {} })), originSeries(), { percentage: true, horizontal: true, unit: 'authorships', onClick: (y, s) => drill({ source: y.source, origin: s.id }) });
        journalTable(content);
    }
    else if (currentModule === 'repositories') {
        const c = data.coverage, coverage = [['Abstract', c.abstract], ['Content service PDF', c.pdf], ['TEI XML', c.xml], [`${home()} repository copy`, c.repo], ['License known', c.license]].map(([name, count]) => ({ name: `${name} · ${num(count)} works`, count: data.total ? count / data.total * 100 : 0 }));
        bar(panel(grid, 'Metadata and document coverage', 'Percentage of the unique works matching the filter.'), data.total ? coverage : [], { limit: 5, unit: '%' });
        dots(panel(grid, 'Metadata completeness', 'Percentage of complete works; click to review the incomplete ones.'), data.total ? [['DOI', data.total - data.quality.doi], ['Abstract', c.abstract], ['Source', data.total - data.quality.source], ['Main field', data.total - data.quality.field], ['Funder recorded', data.total - data.quality.funder]].map(([name, n], i) => ({ id: ['doi', 'abstract', 'source', 'field', 'funder'][i], name, count: n / data.total * 100 })) : [], r => drill({ audit: r.id }));
        groupBar(grid, 'Recognised licenses', 'licenses', 'license', 'One work can have several licenses at different locations.');
        bar(panel(grid, 'Available copy versions', 'One work can have more than one version.'), data.top.versions, { onClick: r => drill({ version: r.id }) });
        const rows = data.top.versions.map(r => ({ ...r, name: r.name.replace('Version', '') }));
        smallMultiples(panel(grid, 'Copy versions by publication year', 'Line charts of works per copy version. One work can have more than one version. Years that are zero for every version shown are hidden, so the axis years may not be consecutive. The vertical scale is shared. Click a point to explore the works.', true), rows, years(), (r, y) => drill({ version: r.id, from: y, to: y }), { omitEmpty: true });
        const locationTypes = [...new Set(data.version_locations.map(r => r.type))], versionRows = data.top.versions.map(r => ({ ...r, years: Object.fromEntries(locationTypes.map(t => [t, data.version_locations.find(v => v.version === r.id && v.type === t)?.count || 0])) }));
        heatmap(panel(grid, 'Versions and location types', 'One work can have several version/location pairs.', true), versionRows, locationTypes, (r, type) => drill({ version: r.id, locationType: type }));
    }
    else if (currentModule === 'audit') {
        const labels = { doi: 'No DOI', abstract: 'No abstract', source: 'Empty source', field: 'Empty field', funder: 'No funder recorded', affiliation: 'Incomplete affiliation', author_id:'Authors without a profile ID', date: 'Year needs checking', retracted: 'Retraction flag' };
        bar(panel(grid, 'Coverage and review flags', 'Missing metadata is not always an error.'), Object.entries(data.quality).map(([id, count]) => ({ id, name: labels[id], count })), { limit: 9, onClick: r => drill({ audit: r.id }) });
        heatmap(panel(grid, 'Review flags by year', 'Works with a flag; one work can have several flags.'), Object.entries(data.quality).map(([id, count]) => ({ id, name: labels[id], count, years: data.quality_years[id] })), years(), (r, y) => drill({ audit: r.id, from: y, to: y }));
        methodPanel(grid);
    }
    if (!data.total)
        intro(content, 'No works match this combination of filters. Change the period or remove extra filters to widen the search.');
    if (currentModule === 'publications' || journal || author) pubTable(content);
    if (journal && !filter.metricKind) renderJournalInstallation(content, journal);
}
// Last block on a journal profile: native widget and iframe are separate installation choices.
function copyField(value, label) {
    const row = el('div', { class: 'journal-embed-actions' });
    const input = el('input', { type: 'text', readonly: '', value, 'aria-label': label, spellcheck: 'false' });
    const copy = el('button', { class: 'button secondary', type: 'button' }, 'Copy');
    const status = el('span', { class: 'journal-embed-status', role: 'status', 'aria-live': 'polite' });
    copy.onclick = async () => {
        input.focus();
        input.select();
        try {
            await navigator.clipboard.writeText(url);
            status.textContent = 'Copied.';
        } catch {
            status.textContent = 'Selected; copy it with Ctrl/Cmd+C.';
        }
    };
    row.append(input, copy);
    return [row, status];
}
function renderJournalInstallation(content, journal) {
    const iframeURL = journalEmbedURL(manifest.institution.site_url, journal.id);
    const widget = journalWidgetInstall(manifest.institution.site_url, journal.id);
    if (!iframeURL || !widget) return;
    const section = el('section', { class: 'panel journal-embed-link', 'aria-labelledby': 'journal-embed-title' });
    const native = el('div', { class: 'journal-install-method' });
    native.append(el('h3', {}, 'Option 1 · Native widget (without iframe)'),
        el('p', {}, 'Add the script once through OJS Custom Header, then put the journal placeholder on its Static Page.'),
        el('label', {}, 'Widget script URL'), ...copyField(widget.script_url, `Widget script URL for ${journal.name}`),
        el('label', {}, 'Custom Header script tag'), ...copyField(widget.script_tag, `Widget script tag for ${journal.name}`),
        el('label', {}, 'Static Page placeholder'), ...copyField(widget.placeholder, `Widget placeholder for ${journal.name}`));
    const frame = el('div', { class: 'journal-install-method' });
    frame.append(el('h3', {}, 'Option 2 · Iframe'),
        el('p', {}, 'Use this address when OJS should display the same widget on an isolated white page. The journal ID is already included.'),
        el('label', {}, 'Iframe URL'), ...copyField(iframeURL, `Iframe URL for ${journal.name}`),
        el('p', { class: 'panel-note' }, external('Open iframe preview ↗', iframeURL)));
    section.append(el('h2', { id: 'journal-embed-title' }, 'Embed this journal in OJS'),
        el('p', { class: 'journal-install-intro' }, 'Choose one installation method. Do not install both methods on the same OJS page.'), native, frame);
    content.append(section);
}
// SDG card shared by journal and author pages: top 8 goals in the chart, the rest named in the note.
function sdgCard(grid, title) {
    const goals = data.top.sdgs.filter(r => r.count > 0), others = goals.slice(8);
    const p = panel(grid, title, `Unique works per goal; one work can belong to several goals. Automatic OpenAlex classification, not a measure of impact.${others.length ? ` Other goals: ${others.map(r => `SDG ${r.id} (${num(r.count)})`).join(', ')}.` : ''} Click a goal to narrow this page.`);
    sdgBars(p, goals, { limit: 8, onClick: r => drill({ sdg: r.id }) });
    sdgNotice(p.node);
}
// UN attribution for the official icons and colours; the UN has not reviewed this dashboard.
function sdgNotice(container) {
    const note = el('p', { class: 'panel-note sdg-notice' }, 'SDG icons: United Nations, ');
    note.append(external('un.org/sustainabledevelopment ↗', 'https://www.un.org/sustainabledevelopment/'),
        document.createTextNode('. The content of this publication has not been approved by the United Nations and does not reflect the views of the United Nations or its officials or Member States.'));
    container.append(note);
}
function timelineTrack(p, label) {
    const controls = el('div', { class: 'timeline-controls' });
    const earlier = el('button', { class: 'text-button', type: 'button', 'aria-label': `Scroll ${label} to earlier years` }, '← Earlier years');
    const later = el('button', { class: 'text-button', type: 'button', 'aria-label': `Scroll ${label} to later years` }, 'Later years →');
    controls.append(el('span', { class: 'timeline-hint' }, 'Click a year to open the works behind the number.'), earlier, later);
    const track = el('div', { class: 'growth-timeline', tabindex: '0', role: 'region', 'aria-label': `${label}; scroll to browse every year` });
    earlier.onclick = () => track.scrollBy({ left: -track.clientWidth * .8, behavior: 'auto' });
    later.onclick = () => track.scrollBy({ left: track.clientWidth * .8, behavior: 'auto' });
    p.node.append(controls, track);
    requestAnimationFrame(() => { if (track.isConnected) track.scrollLeft = track.scrollWidth; });
    return track;
}
function growthTimeline(grid) {
    const rows = data.publication_growth, normalization = data.growth_normalization;
    const signed = value => value === null ? 'Not available' : `${value > 0 ? '+' : ''}${decimal(value)}`;
    const status = row => row.status === 'incomplete' ? 'Year not complete' : row.status === 'small_base' ? 'Small comparison base'
        : row.status === 'zero_base' ? 'Zero base' : row.status === 'no_comparison' ? 'No comparison year' : signed(row.growth) + '%';
    const p = panel(grid, 'Annual publication growth timeline',
        'Growth over the previous calendar year, after date checks and comparison-base eligibility. Dashed line: 0% growth.', true);
    p.node.classList.add('growth-panel');
    const description = row => `${row.year}: ${num(row.count)} timeline-eligible works · previous year ${num(row.previous)} works · growth ${status(row)}`;
    const firstEligible = rows.findIndex(row => row.growth !== null);
    line(p, firstEligible < 0 ? [] : rows.slice(firstEligible), { value: 'growth', label: 'Annual growth after normalisation', unit: '%', color: PALETTE[2], reference: 0, referenceLabel: '0% growth',
        tooltip: description, onClick: row => drill({ from: row.year, to: row.year, dateQuality: 'valid' }) });
    p.node.append(el('p', { class: 'normalization-note' },
        `Normalisation in use: ${num(normalization.excluded_count)} of ${num(normalization.input_count)} works are left out of the timeline because of their dates; KPIs and the original metadata stay available. A percentage is shown only when the base is ≥ ${normalization.policy.min_previous} works and the year is complete. This threshold is a display policy, not a statistical test. The chart starts at the first year that meets the rules; the cards still show the count for every eligible year.`));
    const track = timelineTrack(p, 'Publication growth timeline');
    for (const row of rows) {
        const state = row.incomplete ? 'partial' : row.growth === null ? 'unavailable' : row.growth < 0 ? 'negative' : 'positive';
        const button = el('button', { class: `timeline-year ${state}`, type: 'button', 'data-year': row.year, 'aria-label': description(row), title: description(row) });
        button.append(el('span', { class: 'timeline-date' }, String(row.year)), el('strong', {}, num(row.count)), el('span', {}, 'timeline-eligible works'),
            el('span', { class: 'timeline-growth' }, row.growth === null ? status(row) : `${row.growth > 0 ? '↑ ' : row.growth < 0 ? '↓ ' : '→ '}${signed(row.growth)}%`),
            el('small', {}, row.previous === null ? 'No comparison year' : `Base: ${num(row.previous)} works`));
        if (row.raw_count !== row.count) button.append(el('small', {}, `Raw metadata: ${num(row.raw_count)} works`));
        button.onclick = () => drill({ from: row.year, to: row.year, dateQuality: 'valid' });
        track.append(button);
    }
    const details = el('details', { class: 'normalization-details' });
    details.append(el('summary', {}, 'Normalisation notes and numbers before filtering'));
    const reasons = { invalid_year: 'Missing or invalid year', before_institution: `Year before ${normalization.policy.first_year}`,
        future_year: 'Year after the snapshot year', epoch_date: 'Placeholder date 31 December 1969 / 1 January 1970' };
    const list = el('ul');
    for (const [key, label] of Object.entries(reasons)) list.append(el('li', {}, `${label}: ${num(normalization.excluded[key])} works.`));
    details.append(el('p', {}, 'The date rules screen candidate anomalies for this analysis; they do not decide that every such record is wrong. Years are not guessed or corrected. Large jumps with an adequate base are shown without capping or smoothing.'), list,
        el('p', {}, `${normalization.policy.first_year} is used as the institution's historical start. Publications of predecessor institutions may need a separate review. `));
    if (normalization.policy.year_source) details.lastElementChild.append(external(`Source for the ${home()} founding year ↗`, normalization.policy.year_source));
    details.append(el('p', {}, `Works after filtering: ${num(normalization.retained_count)}. Years with a base of 1–${normalization.policy.min_previous - 1} works: ${num(normalization.small_base_years)}. The numbers below use the metadata before filtering, with the active filter:`));
    const raw = el('ul', { class: 'raw-growth-values' });
    for (const row of normalization.raw_rows.filter(row => row.count || row.growth !== null))
        raw.append(el('li', {}, `${row.year}: ${num(row.count)} works · base ${num(row.previous)} · raw growth ${row.growth === null ? 'Not available' : signed(row.growth) + '%'}`));
    details.append(raw);
    p.node.append(details);
}
// Bubble map of countries; Collaboration leaves the home country out (partners), a journal page keeps it (contributors).
function collaborationMap(grid, { title = 'Partner country map', note, includeHome = false, unit } = {}) {
    const rows = data.country_map.filter(row => includeHome || row.id !== INSTITUTION.country_code);
    const p = panel(grid, title, note ?? `Every country or area other than ${homeCountry()} in the active filter. One work can count for several countries. Hover, focus or tap a bubble to see its data. Map interaction does not change the Explore the data filters.`, true);
    p.node.classList.add('world-map-panel');
    const draw = async () => {
        p.node.setAttribute('aria-busy', 'true');
        p.body.replaceChildren(el('div', { class: 'empty-state' }, 'Preparing the country map…'));
        try {
            if (!rows.length) { p.body.replaceChildren(); countryBubbleMap(p, rows, {}); return; }
            geographyPromise ||= getJSON('assets/world-map.json').catch(error => { geographyPromise = null; throw error; });
            const geography = await geographyPromise;
            if (!p.node.isConnected) return;
            p.body.replaceChildren();
            countryBubbleMap(p, rows, geography, unit ? { unit } : {});
        }
        catch {
            if (!p.node.isConnected) return;
            const retry = el('button', { type: 'button', class: 'button secondary' }, 'Reload map');
            retry.onclick = draw;
            p.body.replaceChildren(el('p', { class: 'empty-state' }, 'The local map data could not be loaded.'), retry);
        }
        finally { p.node.setAttribute('aria-busy', 'false'); }
    };
    draw();
}
// Box plot of FWCI and percentile band of citations per work, by publication year. Used on the Citation impact tab
// and on every journal page, with the same rules, so a journal reads against the whole portfolio.
function distributionCharts(grid, { wide = false, owner = scopeName[filter.scope] } = {}) {
    const min = 10, open = r => drill({ from: r.year, to: r.year });
    const box = panel(grid, 'FWCI distribution by publication year (box plot)', `${owner} · spread of FWCI scores of the works in each publication year, after the same date checks as the FWCI timeline. A mean can be lifted by a few highly cited works; the median and box show where most works are. Years with fewer than ${min} works with FWCI show one dot per work instead of a box; 10–29 works are a small base.`, wide);
    boxPlot(box, data.fwci_timeline, { reference: 1, referenceLabel: 'FWCI 1 · global benchmark', unit: 'FWCI', onClick: open });
    chartStory(box, distributionStory('fwci', data.fwci_timeline, data.current_year));
    const band = panel(grid, 'Citations per work by publication year', `${owner} · cumulative citations per work as of the snapshot. Older works have had more time to be cited, so recent years sit lower by construction. Years with fewer than ${min} works show one dot per work instead of a band; 10–29 works are a small base.`, wide);
    percentileBand(band, data.citation_distribution, { unit: 'citations', onClick: open });
    chartStory(band, distributionStory('citations', data.citation_distribution, data.current_year));
}
// Author origin: each authorship in one group (home institution, another institution in the home country, abroad,
// not recorded). A 100% bar of all years, then 100% bars per publication year (or per journal).
const possessive = name => name.endsWith('s') ? `${name}'` : `${name}'s`;
const originSeries = () => [{ id: 'home', name: `${possessive(home())} authors` }, { id: 'national', name: `Other authors from ${manifest?.institution?.country || homeCountry()}` },
    { id: 'international', name: 'International authors' }, { id: 'unknown', name: 'Affiliation not recorded' }].map(s => ({ ...s, color: ORIGIN_COLORS[s.id] }));
const originNote = () => `Each author of each work counts once, in one group: ${home()} first, then another institution in ${manifest?.institution?.country || homeCountry()}, then an institution abroad (all countries together). Authors without an affiliation or country in OpenAlex are shown as not recorded. Click a bar to list the works with authors of that group.`;
function originPanel(grid, { title = 'Author affiliation', wide = false, extra = {} } = {}) {
    const series = originSeries(), origin = data.author_origin, p = panel(grid, title, originNote(), wide);
    if (!origin.years.length) { empty(p); return; }
    shareBar(p, series.map(s => ({ ...s, count: origin.total[s.id] })));
    stacked(p, origin.years.map(r => ({ year: r.year, total: r.total, values: r.values })), series, { percentage: true, unit: 'authorships',
        onClick: (y, s) => drill({ from: y.year, to: y.year, origin: s.id, ...extra }) });
}
function fwciTimeline(grid) {
    const rows = data.fwci_timeline, normalization = data.fwci_normalization;
    const p = panel(grid, 'FWCI timeline',
        `${scopeName[filter.scope]} · mean FWCI by publication year after date and metric eligibility checks. Dashed line: global benchmark FWCI 1. The spread behind each mean is in the FWCI distribution box plot.`, true);
    p.node.classList.add('fwci-panel');
    const status = row => row.status === 'small_sample' ? 'Small metric base' : row.status === 'no_metric' ? 'Not available' : decimal(row.fwci);
    const description = row => `${row.year}: mean ${status(row)}${row.status === 'valid' ? ' FWCI' : ''} · ${num(row.fwci_n)} of ${num(row.count)} date-eligible works · coverage ${pct(row.coverage)}${row.year >= data.current_year ? ' · Year not complete' : ''}${row.year + 3 >= data.current_year ? ' · Citation window not complete' : ''}`;
    const open = row => drill({ from: row.year, to: row.year, metric: 'fwci', fwciQuality: 'valid' });
    const firstEligible = rows.findIndex(row => row.status === 'valid');
    line(p, firstEligible < 0 ? [] : rows.slice(firstEligible), { value: 'fwci', label: 'Mean FWCI of eligible works', unit: 'FWCI', reference: 1, referenceLabel: 'FWCI 1 · fixed global benchmark', color: PALETTE[3], tooltip: description, onClick: open });
    p.node.append(el('p', { class: 'normalization-note' },
        `FWCI normalisation: ${num(normalization.excluded_count)} works are left out because of their dates and ${num(normalization.invalid_fwci_count)} invalid FWCI values are removed. The line and card scores are shown only for years with ≥ ${normalization.policy.min_works} works with the metric; small-base years are still listed in the notes. Zero is a valid value and high valid FWCI values are not capped. The general KPIs still follow the metadata and the active filter.`));
    const guide = el('div', { class: 'fwci-guide' });
    guide.append(el('strong', {}, 'Why is the FWCI benchmark 1?'), el('p', {},
        'This global benchmark is fixed. Any target chosen by the institution should be shown separately. The timeline groups snapshot scores by publication year; it is not a history of score changes between snapshots.'));
    fwciHelp(guide, { open: true, timeline: true });
    p.node.append(guide);
    const track = timelineTrack(p, 'FWCI timeline');
    for (const row of rows.filter(row => row.count > 0)) {
        const button = el('button', { class: `timeline-year fwci-year${row.year >= data.current_year ? ' partial' : ''}`, type: 'button', 'data-year': row.year, 'aria-label': description(row), title: description(row) });
        button.append(el('span', { class: 'timeline-date' }, String(row.year)), el('strong', { class: row.status !== 'valid' ? 'metric-unavailable' : '' }, row.status === 'valid' ? decimal(row.fwci) : '—'), el('span', {}, row.status === 'valid' ? 'mean FWCI' : status(row)),
            el('span', { class: 'timeline-growth' }, `Coverage ${pct(row.coverage)}`), el('small', {}, `${num(row.fwci_n)} of ${num(row.count)} works`));
        if (row.year >= data.current_year) button.append(el('small', {}, 'Year not complete'));
        if (row.year + 3 >= data.current_year) button.append(el('small', {}, 'Citation window not complete'));
        button.disabled = row.status !== 'valid';
        button.onclick = () => open(row);
        track.append(button);
    }
    const details = el('details', { class: 'normalization-details fwci-normalization-details' });
    details.append(el('summary', {}, 'FWCI filtering notes and raw numbers'));
    details.append(el('p', {}, `Dates are checked with the same rules as publication growth: missing/invalid year, before ${normalization.date_policy.first_year}, after the snapshot year, and the dates 1969-12-31/1970-01-01. This screens candidate anomalies; correct years are not guessed. The threshold of ${normalization.policy.min_works} works is a display policy, not a statistical test. ${num(normalization.small_sample_years)} years have a base of 1–${normalization.policy.min_works - 1} works with the metric.`));
    const reasons = { invalid_year: 'Missing/invalid year', before_institution: `Before ${normalization.date_policy.first_year}`, future_year: 'After the snapshot year', epoch_date: 'Epoch placeholder date' };
    const list = el('ul');
    for (const [key, label] of Object.entries(reasons)) list.append(el('li', {}, `${label}: ${num(normalization.excluded[key])} works.`));
    list.append(el('li', {}, `Negative/non-numeric/infinite FWCI: ${num(normalization.invalid_fwci_count)} values; missing FWCI on date-eligible works: ${num(normalization.missing_fwci_count)}.`));
    details.append(list);
    const raw = el('ul', { class: 'raw-growth-values raw-fwci-values' });
    for (const row of normalization.raw_rows.filter(row => row.count > 0)) raw.append(el('li', {}, `${row.year}: raw mean ${decimal(row.fwci)} FWCI · ${num(row.fwci_n)} of ${num(row.count)} works · coverage ${pct(row.coverage)}`));
    details.append(raw);
    p.node.append(details, el('p', { class: 'panel-note' }));
    p.node.lastElementChild.append(external('OpenAlex FWCI definition and calculation ↗', normalization.policy.source));
}
function annualFWCITable(container, rows) {
    const section = el('section', { class: 'panel table-panel annual-fwci' });
    section.append(el('h2', {}, 'Raw FWCI data by publication year'), el('p', { class: 'panel-note' },
        `${scopeName[filter.scope]}. Numbers before timeline filtering. Mean = sum of valid FWCI / number of works with a valid FWCI in that year. Zero counts; missing values are left out. This is the mean impact of works in the active scope, not a metric for journals published by ${home()}. The year in progress is not complete.`));
    fwciHelp(section);
    const wrap = el('div', { class: 'table-scroll' }), table = el('table', { 'aria-label': 'Annual FWCI' }), head = el('thead'), tr = el('tr');
    for (const label of ['Publication year', 'Works', 'Works with FWCI', 'FWCI coverage', 'Mean FWCI']) tr.append(el('th', { scope: 'col' }, label));
    head.append(tr);
    const body = el('tbody');
    for (const row of rows) {
        const item = el('tr'), year = el('td'), button = el('button', { class: 'work-title', type: 'button' }, `${row.year}${row.year === data.current_year ? ' (current)' : ''}`);
        button.onclick = () => drill({ from: row.year, to: row.year });
        year.append(button);
        item.append(year);
        for (const value of [num(row.count), num(row.fwci_n), pct(row.coverage), decimal(row.fwci)]) item.append(el('td', { class: 'num' }, value));
        body.append(item);
    }
    table.append(head, body);
    wrap.append(table);
    section.append(wrap);
    container.append(section);
}
function entityTable(container, kind) {
    const settings = {
        authors: { title: 'Top 500 authors', key: 'author', name: 'Author',
            note: 'Sorted by the number of articles in the active filter. Every author with an OpenAlex ID is listed, whatever the affiliation; an author counts once per article. At most 500 profiles, 50 per page.',
            columns: ['Articles in filter', 'Citations to those articles', 'First-author articles', 'Corresponding articles', 'ORCID'],
            values: r => [num(r.count), num(r.citations), num(r.first), num(r.corresponding), r.orcid ? 'Yes' : 'No'] },
        partners: { title: 'Collaborating institutions', key: 'partner', name: 'Partner institution',
            note: `Every institution other than ${home()} observed on works in the active filter; 50 per page. One work can involve several partners. Click an institution to see the related works.`,
            columns: ['Country (ISO code)', 'Sector', 'Joint publications', 'Citations to joint works'],
            values: r => [r.metadata?.country || 'Not available', r.metadata?.type || 'Not available', num(r.count), num(r.citations)] },
        funders: { title: 'Funding organisations', key: 'funder', name: 'Funding organisation',
            note: 'Every funder recorded on works in the active scope; 50 per page. A work counts once per funder and can list several funders.',
            columns: ['Publications', 'Citations to funded works'], values: r => [num(r.count), num(r.citations)] },
        sources: { title: 'Metadata of every source in the filter', key: 'source', name: 'Source',
            note: `Every source with works in the active filter, not only the top 50; 50 per page. Share without ${home()} affiliation = works without a ${home()} authorship / all of the source's works in the filter × 100%. Unmapped affiliation metadata can affect this classification. APC prices are not institutional spending.`,
            columns: ['Type', 'ISSN', 'Works', `Share without ${home()} affiliation`, 'DOAJ', 'List APC (US$)'],
            values: r => { const s = r.metadata || {}; return [s.type || 'Not available', (s.issn || []).join(', ') || 'Not available', num(r.count), pct(r.count ? (r.count - r.local) / r.count * 100 : null), typeof s.doaj === 'boolean' ? (s.doaj ? 'Yes' : 'No') : 'Not available', decimal(s.apc_usd ?? null)]; } },
    };
    const config = settings[kind], section = el('section', { class: 'panel table-panel entity-table', 'data-kind': kind, 'aria-busy': 'true' });
    section.append(el('h2', {}, config.title), el('p', { class: 'panel-note' }, config.note));
    const form = el('form', { class: 'table-toolbar', role: 'search' }), search = el('input', { class: 'search-input', type: 'search', placeholder: 'Search a name or ID in the list', 'aria-label': `Search ${config.name.toLowerCase()}` }), submit = el('button', { type: 'submit', class: 'button secondary' }, 'Search');
    form.append(search, submit);
    const status = el('p', { class: 'panel-note', role: 'status', 'aria-live': 'polite' }, 'Loading the list from the snapshot…');
    const wrap = el('div', { class: 'table-scroll' }), table = el('table', { 'aria-label': config.title }), head = el('thead'), tr = el('tr'), body = el('tbody');
    for (const label of ['Rank', config.name, ...config.columns]) tr.append(el('th', { scope: 'col' }, label));
    head.append(tr);
    table.append(head, body);
    wrap.append(table);
    const pagination = el('div', { class: 'pagination' }), count = el('span'), buttons = el('div');
    const prev = el('button', { type: 'button' }, '← Previous'), next = el('button', { type: 'button' }, 'Next →'), last = el('button', { type: 'button' }, 'Last →');
    buttons.append(prev, next, last);
    pagination.append(count, buttons);
    section.append(form, status, wrap, pagination);
    container.append(section);
    let page = 0, query = '', lastPage = 0, sequence = 0;
    async function load(targetPage = 0) {
        const request = ++sequence;
        section.setAttribute('aria-busy', 'true');
        prev.disabled = next.disabled = last.disabled = true;
        status.textContent = 'Loading the list from the snapshot…';
        try {
            const result = await task('entities', { kind, search: query, page: targetPage });
            if (request !== sequence || !section.isConnected) return;
            page = result.page;
            lastPage = Math.max(0, Math.ceil(result.total / result.page_size) - 1);
            body.replaceChildren();
            for (const row of result.rows) {
                const item = el('tr'), name = el('td'), button = el('button', { class: 'work-title', type: 'button' }, row.name);
                button.onclick = () => kind === 'authors' ? openAuthor(row.id) : drill({ [config.key]: row.id });
                name.append(button);
                item.append(el('td', { class: 'num' }, num(row.rank)), name);
                for (const value of config.values(row)) item.append(el('td', {}, value));
                body.append(item);
            }
            if (!result.rows.length) {
                const row = el('tr');
                row.append(el('td', { colspan: String(config.columns.length + 2) }, 'No data matches the filter and search.'));
                body.append(row);
            }
            const first = result.total ? page * result.page_size + 1 : 0, end = Math.min((page + 1) * result.page_size, result.total);
            count.textContent = `${num(first)}–${num(end)} of ${num(result.total)}`;
            status.textContent = kind === 'authors'
                ? `Top ${num(Math.min(500, result.eligible))} profiles of ${num(result.eligible)} authors with an ID in the active filter${query ? ' · ' + num(result.total) + ' search results' : ''}.`
                : `${num(result.eligible)} ${kind === 'sources' ? 'sources' : kind === 'funders' ? 'funders' : 'partner institutions'} in the active filter${query ? ' · ' + num(result.total) + ' search results' : ''}.`;
            prev.disabled = page === 0;
            next.disabled = last.disabled = page >= lastPage;
        }
        catch (error) {
            if (request !== sequence || !section.isConnected) return;
            body.replaceChildren();
            count.textContent = '';
            status.textContent = error.message + ' Press Search to try again.';
        }
        finally {
            if (request === sequence) section.setAttribute('aria-busy', 'false');
        }
    }
    form.onsubmit = event => { event.preventDefault(); query = search.value.trim(); load(); };
    prev.onclick = () => load(page - 1);
    next.onclick = () => load(page + 1);
    last.onclick = () => load(lastPage);
    load();
}
function methodPanel(grid) {
    const p = panel(grid, 'Reading the data', 'Definitions, coverage and limitations.', true);
    p.body.className = 'method-grid';
    const rows = [['Consistent scopes', 'Affiliated, funded and published works are different sets. The extended corpus is not merged in without an explicit choice.'],
        ['Citations and time', 'Cumulative citations hold at the snapshot date. The publication year of a work differs from the year a citation was received.'],
        ['Normalised metrics', 'FWCI and percentiles are computed only for works with valid data. Coverage and denominators are always shown.'],
        ['Author profiles', 'Affiliations come from publications and can be mismatched. The number of profiles is not the number of active staff.'],
        ['SDGs and topics', 'Automatic classification. One work can carry several labels and category counts can overlap.'],
        ['Refresh and quality', 'The snapshot is refreshed after validation. The previous data is kept if a run fails.']];
    for (const [title, text] of rows) {
        const box = el('div', { class: 'method-item' });
        box.append(el('h3', {}, title), el('p', {}, text));
        if (title === 'Normalised metrics') fwciHelp(box);
        p.body.append(box);
    }
    p.node.append(el('p', { class: 'panel-note' }, `Snapshot ${manifest.updated_at}. ${manifest.authorships_refreshed_at?'Authorship metadata rechecked '+formatDate(manifest.authorships_refreshed_at)+'. ':''}OpenAlex metadata is CC0; document rights follow their original licenses. Networks are limited to 40 nodes and 150 links. Source: help.openalex.org.`));
}
// Shared work detail: tabs "Details" and "Citing works" for every module that opens a work.
let detailToken = 0;
const citingCache = new Map();
function workTabs(body) {
    const list = el('div', { class: 'work-tabs', role: 'tablist', 'aria-label': 'Publication detail sections' });
    const tabs = [['detail', 'Details'], ['citing', 'Citing works']].map(([key, label], i) =>
        el('button', { type: 'button', role: 'tab', id: `work-tab-${key}`, 'aria-controls': `work-panel-${key}`, 'aria-selected': String(i === 0), tabindex: i === 0 ? '0' : '-1' }, label));
    const panels = ['detail', 'citing'].map((key, i) => { const p = el('div', { role: 'tabpanel', id: `work-panel-${key}`, 'aria-labelledby': `work-tab-${key}`, tabindex: '0' }); p.hidden = i !== 0; return p; });
    const select = i => tabs.forEach((tab, j) => { tab.setAttribute('aria-selected', String(i === j)); tab.tabIndex = i === j ? 0 : -1; panels[j].hidden = i !== j; if (i === j) tab.focus(); });
    tabs.forEach((tab, i) => {
        tab.onclick = () => select(i);
        tab.onkeydown = e => { if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) { e.preventDefault(); select(e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length); } };
    });
    list.append(...tabs);
    body.append(list, ...panels);
    return { panel: panels[0], citingPanel: panels[1], citingTab: tabs[1] };
}
function sdgSection(w) {
    const box = el('section', { class: 'work-sdgs', 'aria-labelledby': 'work-sdg-title' }), policy = manifest.sdg || {};
    box.append(el('h3', { id: 'work-sdg-title' }, 'Sustainable Development Goals (SDGs)'));
    const goals = workSdgs(w);
    if (goals === null) box.append(el('p', {}, 'The SDG field is not available in this snapshot.'));
    else if (!goals.length) box.append(el('p', {}, 'No SDG labels are identified in the current data.'));
    else {
        const list = el('ul', { class: 'sdg-list' });
        for (const g of goals) {
            const button = el('button', { type: 'button', class: 'sdg-chip', 'data-sdg': g.id, title: 'Show other works with this SDG' });
            // The official icon (whole, scaled) beside the name, with the goal colour as a left rule.
            button.style.borderLeftColor = sdgColor(g.number);
            button.append(el('img', { src: `assets/sdg/sdg-${g.number}.png`, alt: '', width: '28', height: '28', loading: 'lazy' }),
                el('span', {}, `SDG ${g.number} · ${g.name}`));
            // Same drill as the SDG charts: keeps the journal page or author filter that is active.
            button.onclick = () => { $('detail-dialog').close(); drill({ sdg: g.id }); };
            const li = el('li'); li.append(button, el('span', { class: 'sdg-score' }, g.score === null ? 'score not available' : `confidence score ${decimal(g.score)}`)); list.append(li);
        }
        box.append(list);
        sdgNotice(box);
    }
    const classifier = policy.classifier === 'openalex-2026-10' ? 'OpenAlex classifier (since October 2026)' : 'classifier version not recorded';
    box.append(el('p', { class: 'panel-note' }, `Source: OpenAlex, field ${policy.field || 'sustainable_development_goals'} · ${classifier}${policy.threshold ? ` · score threshold ${decimal(policy.threshold)}` : ''} · retrieved ${formatDate(policy.retrieved_at || manifest.updated_at)}${policy.scores === false || !w.sdg_scores ? ' · scores not stored in this snapshot' : ''}.`),
        el('p', { class: 'panel-note' }, 'Automatic classification from text metadata; not an assessment or verification of real impact on the SDGs. The score is the classifier\'s confidence, not a probability or a measure of contribution. A work can have zero, one or several goals.'));
    return box;
}
async function citingFor(id) {
    const info = manifest.files.citing;
    if (!info?.entries?.length) return { status: 'unavailable', rows: [] };
    const path = `data/citing/${info.large?.includes(id) ? 'w/' + id : citingShard(id)}.json`, entry = info.entries.find(e => e.path === path);
    if (!entry) return { status: info.status, retrieved_at: info.retrieved_at, rows: [] };
    if (!citingCache.has(path)) citingCache.set(path, getJSON(path).catch(error => { citingCache.delete(path); throw error; }));
    const shard = await citingCache.get(path);
    const via = shard.via?.[id] || [];
    return { status: shard.status, retrieved_at: shard.retrieved_at, sources: info.sources || ['openalex'],
        rows: (shard.cited[id] || []).map((i, k) => ({ ...Object.fromEntries(CITING_FIELDS.map((f, j) => [f, shard.works[i][j]])), via: ['OpenAlex', 'Crossref', 'OpenAlex and Crossref'][via[k] ?? 0] })) };
}
async function loadCiting(w, panel, tab, token) {
    panel.replaceChildren(el('p', { 'aria-live': 'polite' }, 'Loading citing works…'));
    if (!w.scopes.some(s => s === 'published' || s === 'affiliated')) {
        panel.replaceChildren(el('p', {}, `Citing works are prepared for works published by ${home()} and works affiliated with ${home()}.`));
        return;
    }
    let result;
    try { result = await citingFor(w.id); }
    catch { if (token === detailToken) panel.replaceChildren(el('p', { class: 'notice error' }, 'Citing works could not be loaded. Check the connection and open the work details again.')); return; }
    if (token !== detailToken) return;
    if (result.status === 'unavailable') { panel.replaceChildren(el('p', {}, 'Citing works are not available in this snapshot.')); return; }
    tab.textContent = `Citing works (${num(result.rows.length)})`;
    renderCiting(panel, w, result);
}
function renderCiting(panel, w, result) {
    const rows = result.rows, counts = el('div', { class: 'detail-grid' });
    const bySource = s => rows.filter(r => r.via === s).length;
    const sourceText = (result.sources || []).includes('crossref') ? `OpenAlex ${num(bySource('OpenAlex'))} · Crossref ${num(bySource('Crossref'))} · both ${num(bySource('OpenAlex and Crossref'))}` : 'OpenAlex';
    for (const [label, value] of [['Cumulative citations (OpenAlex)', num(w.citations)], ['Citing works identified', num(rows.length)], ['Relation source', sourceText]]) { const c = el('div'); c.append(el('small', {}, label), el('span', {}, value)); counts.append(c); }
    const status = result.status === 'stale' ? 'Citing data from the previous retrieval because the latest refresh failed' : result.status === 'sample' ? 'Test sample, not complete' : 'Complete for this snapshot';
    panel.replaceChildren(counts, el('p', { class: 'panel-note' }, `${status} · retrieved ${result.retrieved_at ? formatDate(result.retrieved_at) : 'date not recorded'}. A relation is recorded only when the citing work's reference list contains this work: in OpenAlex, or in the references deposited at Crossref (Cited-by, for DOIs under the organisation's prefix). The number of citing works can differ from cumulative citations because of retrieval timing and reference matching. The publication year of a citing work is not the citation year in the Citations per year chart.`));
    // Distinguish "no citations", "not in the local sample" and "cited but no citing work proven by a reference list".
    if (!rows.length) {
        const message = !w.citations ? 'This work has no citations in the current data.'
            : result.status === 'sample' ? `OpenAlex records ${num(w.citations)} citations for this work, but it is not in the citing-data test sample. The full list is available after a full retrieval.`
            : `OpenAlex records ${num(w.citations)} citations, but this retrieval found no citing work that can be proven through its reference list.`;
        panel.append(el('p', {}, message));
        return;
    }
    const toolbar = el('div', { class: 'table-toolbar' }), search = el('input', { class: 'search-input', type: 'search', placeholder: 'Search title, author or source', 'aria-label': 'Search citing works' });
    const order = el('select', { 'aria-label': 'Sort citing works' });
    for (const [v, l] of [['desc', 'Newest first'], ['asc', 'Oldest first']]) option(order, v, l);
    const shown = el('span', { class: 'panel-note', role: 'status', 'aria-live': 'polite' });
    toolbar.append(search, order, shown);
    const wrap = el('div', { class: 'table-scroll' }), table = el('table', { class: 'citing-table', 'aria-label': 'Citing works' }), head = el('tr'), body = el('tbody');
    for (const [h, cls] of [['Year', 'num'], ['Citing work', ''], ['Source', ''], ['Authors', ''], ['Type', ''], ['Provenance', ''], ['Link', '']]) head.append(el('th', { scope: 'col', class: cls }, h));
    const thead = el('thead'); thead.append(head); table.append(thead, body); wrap.append(table);
    const more = el('button', { type: 'button', class: 'button secondary' }, 'Load more');
    let limit = 50;
    const text = r => [r.title, r.source, ...(r.authors || [])].join(' ').toLocaleLowerCase('en');
    const draw = () => {
        const term = search.value.trim().toLocaleLowerCase('en'), dir = order.value === 'asc' ? 1 : -1;
        const list = rows.filter(r => !term || text(r).includes(term)).sort((a, b) => ((a.year ?? 0) - (b.year ?? 0)) * dir || String(a.title).localeCompare(String(b.title)));
        body.replaceChildren();
        for (const r of list.slice(0, limit)) {
            const authors = r.authors?.length ? r.authors.join('; ') + (r.author_count > r.authors.length ? ` and ${num(r.author_count - r.authors.length)} more` : '') : 'Not available';
            const link = safeURL(r.url) ? external('Open ↗', r.url) : safeURL(r.doi) ? external('DOI ↗', r.doi) : el('span', {}, 'Not available');
            const tr = el('tr', { 'data-citing-id': r.id });
            tr.append(el('td', { class: 'num' }, r.year ?? '—'), el('td', {}, r.title || 'Title not available'), el('td', {}, r.source || 'Not available'),
                el('td', {}, authors), el('td', {}, r.type || 'Not available'), el('td', {}, r.via || 'OpenAlex'));
            // el() takes text only, so the link element is appended to its cell.
            const cell = el('td'); cell.append(link); tr.append(cell);
            body.append(tr);
        }
        if (!list.length) { const tr = el('tr'); tr.append(el('td', { colspan: '7' }, 'No citing works match.')); body.append(tr); }
        shown.textContent = `Showing ${num(Math.min(limit, list.length))} of ${num(list.length)}${term ? ` search results (total ${num(rows.length)})` : ''}`;
        more.hidden = list.length <= limit;
    };
    search.oninput = () => { limit = 50; draw(); };
    order.onchange = () => { limit = 50; draw(); };
    more.onclick = () => { limit += 50; draw(); };
    panel.append(toolbar, wrap, more);
    draw();
}
async function openWork(id) {
    // Each opening gets a token, so a slower response for a previous work is never shown.
    const token = ++detailToken, dialog = $('detail-dialog');
    $('detail-body').replaceChildren(el('p', {}, 'Loading publication details…'));
    if (!dialog.open)
        dialog.showModal();
    try {
        const w = await task('detail', { id });
        if (token !== detailToken) return;
        if (!w)
            throw new Error('The work was not found in the loaded period.');
        const body = $('detail-body');
        body.replaceChildren(el('h2', {}, w.title));
        if (w.scopes.includes('audit') && !w.scopes.includes('affiliated'))
            body.append(el('p', { class: 'notice' }, `Affiliation audit candidate. Not confirmed as a ${home()} work.`));
        if (w.retracted)
            body.append(el('p', { class: 'notice error' }, 'The metadata carries a retraction flag. Check the source and context before using this work.'));
        body.append(el('p', {}, `${w.source_name || 'Unknown source'} · ${w.year || 'Unknown year'} · ${w.type}`));
        if (w.record_source === 'crossref')
            body.append(el('p', { class: 'notice' }, 'Known only from Crossref (DOI registered under the organisation\'s prefix, not found in OpenAlex). Citations are Crossref\'s count; FWCI, topics, SDGs, funders and author affiliations are not available for this record.'));
        const { panel, citingPanel, citingTab } = workTabs(body);
        loadCiting(w, citingPanel, citingTab, token);
        const details = el('div', { class: 'detail-grid' });
        for (const [label, value] of [['Cumulative citations', num(w.citations)], ['FWCI', decimal(w.fwci)], ['Access status', w.oa_status], ['Main topic', w.topic_name || 'Not available'], ['DOI', w.doi || 'Not available'], ['Scope', w.scopes.map(s => scopeName[s] || 'Audit candidate').join(' · ')]]) {
            const c = el('div');
            c.append(el('small', {}, label), el('span', {}, value));
            details.append(c);
        }
        panel.append(details);
        fwciHelp(panel, { work: true });
        panel.append(sdgSection(w));
        panel.append(el('h3', {}, `Authors and ${home()} affiliation`));
        const authors = el('ul', { class: 'detail-list' });
        for (const a of w.author_names) {
            const roles = `${a.home ? ' · ' + home() : ''}${a.position === 'first' ? ' · first author' : ''}${a.corresponding ? ' · corresponding' : ''}`;
            const li = el('li', {}, a.id && a.home ? roles : `${a.name || a.id}${roles}`);
            // Authors with an ID and an affiliated authorship link to their profile page.
            if (a.id && a.home) {
                const open = el('button', { type: 'button', class: 'author-link', 'data-author-profile': a.id, title: 'Open author profile' }, a.name || a.id);
                open.onclick = () => { $('detail-dialog').close(); openAuthor(a.id); };
                li.prepend(open);
            }
            if (a.orcid) {
                li.append(document.createTextNode(' · '), external('ORCID ↗', a.orcid));
            }
            if (a.institution_names?.length)
                li.append(el('div', { class: 'work-source' }, a.institution_names.join('; ')));
            authors.append(li);
        }
        panel.append(authors);
        if (w.funding.length)
            panel.append(el('p', {}, 'Recorded funders: ' + w.funding.filter(Boolean).map(f => f.name).join('; ')));
        if (w.award_details.length)
            panel.append(el('p', {}, 'Awards: ' + w.award_details.filter(Boolean).map(a => a.name).join('; ')));
        if (w.source_details) {
            const s = w.source_details, flag = v => typeof v === 'boolean' ? (v ? 'Yes' : 'No') : 'Not available';
            panel.append(el('p', {}, `Source metadata · ISSN: ${(s.issn || []).join(', ') || 'Not available'} · DOAJ: ${flag(s.doaj)} · OJS: ${flag(s.ojs)} · Source list APC: ${s.apc_usd === null || s.apc_usd === undefined ? 'Not available' : 'US$ ' + decimal(s.apc_usd)}.`));
        }
        if (w.apc_list || w.apc_paid)
            panel.append(el('p', {}, `List APC: ${w.apc_list?.value_usd === undefined ? 'Not available' : 'US$ ' + decimal(w.apc_list.value_usd)}. Estimated payment: ${w.apc_paid?.value_usd === undefined ? 'Not available' : 'US$ ' + decimal(w.apc_paid.value_usd)}. Provenance: ${w.apc_paid?.provenance || 'Not available'}. Not actual ${home()} spending.`));
        const links = el('div', { class: 'detail-links' });
        for (const [label, url] of [[w.record_source === 'crossref' ? 'Crossref ↗' : 'OpenAlex ↗', w.record_source === 'crossref' ? 'https://api.crossref.org/works/' + encodeURIComponent(String(w.doi || '').replace('https://doi.org/', '')) : 'https://openalex.org/' + w.id], ['DOI ↗', w.doi], ['Open copy ↗', w.oa_url]])
            if (safeURL(url)) {
                const a = external(label, url);
                a.classList.add('button', 'secondary');
                links.append(a);
            }
        panel.append(links);
        panel.append(el('h3', {}, 'Copy locations and versions'));
        const list = el('ul', { class: 'detail-list' });
        for (const l of w.locations) {
            const li = el('li', {}, `${l.version || 'Unknown version'} · ${l.license || 'Unknown license'} · `);
            li.append(external(l.source || 'Source page', l.url));
            if (safeURL(l.pdf)) {
                li.append(document.createTextNode(' · '), external('PDF ↗', l.pdf));
            }
            list.append(li);
        }
        panel.append(list, el('p', {}, `Data retrieved ${formatDate(manifest.updated_at)}. PDF and XML were not checked by downloading their content.`));
    }
    catch (e) {
        if (token === detailToken) $('detail-body').replaceChildren(el('p', {}, e.message));
    }
}
// Dates are shown in the institution's time zone, with its short zone name (for example WITA or GMT+8).
function formatDate(value) { return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: INSTITUTION.timezone, timeZoneName: 'short' }).format(new Date(value)); }
async function route() {
    const thisRender = ++renderID;
    readRoute();
    tablePage = 0;
    tableSort = 'citations';
    note('');
    const invalidYear = value => value !== '' && value !== undefined && (!Number.isInteger(Number(value)) || Number(value) < 1500 || Number(value) > 2100);
    if (invalidYear(filter.from) || invalidYear(filter.to) || (filter.from && filter.to && Number(filter.from) > Number(filter.to))) {
        destroyCharts();
        $('content').replaceChildren(el('div', { class: 'empty-state' }, 'Fix the year range to show data.'));
        $('content').setAttribute('aria-busy', 'false');
        note('Invalid year range. The start year must be less than or equal to the end year.', true);
        return;
    }
    $('content').setAttribute('aria-busy', 'true');
    if (!isDefault())
        note('Processing the snapshot for the selected filter. Details load only when needed.');
    try {
        if (currentModule === 'journals') {
            journalDataset = await getJournalDataset();
            if (thisRender !== renderID) return;
            if (filter.journal && !journalDataset?.journals.some(j => j.id === filter.journal))
                throw new Error('Journal not found in this snapshot. Go back to the Journals tab.');
        }
        if (filter.metricKind) {
            const year = Number(filter.metricYear), snapshotYear = snapshotYearOf(manifest);
            if (!METRIC_KINDS.includes(filter.metricKind) || !['numerator', 'denominator'].includes(filter.metricPart) ||
                !Number.isInteger(year) || year < snapshotYear - 6 || year > snapshotYear || filter.metricKind === 'fwci' && !filter.journal)
                throw new Error('Invalid metric context. Go back to the tab the metric came from.');
            const window = journalWindow(filter.metricKind, year);
            // A journal drill keeps only the journal and search; a citation drill keeps the active filter.
            filter = filter.journal
                ? { journal: filter.journal, scope: 'published', corpus: 'all', source: filter.journal, ...metricDrill(year, filter.metricKind, filter.metricPart, filter.journal), from: window.publication_from, to: window.publication_to, q: filter.q || '' }
                : { ...filter, from: window.publication_from, to: window.publication_to };
        }
        const result = await getSummary();
        if (thisRender !== renderID)
            return;
        // A profile exists for every author with an OpenAlex ID anywhere in the snapshot.
        if (authorPage() && !filter.from && !result.author_profile?.eligible) {
            destroyCharts();
            const box = el('div', { class: 'empty-state' }), go = el('button', { type: 'button', class: 'button secondary' }, 'Show this author\'s works in Publications');
            go.onclick = () => setHash('publications', { author: filter.author, scope: 'all', corpus: 'all' });
            box.append(el('p', {}, `No profile: author ${filter.author} does not appear in this snapshot.`), go);
            $('content').replaceChildren(box);
            $('content').setAttribute('aria-busy', 'false');
            note('');
            return;
        }
        data = result;
        render();
        note('');
    }
    catch (e) {
        if (thisRender !== renderID)
            return;
        destroyCharts();
        $('content').replaceChildren(el('div', { class: 'empty-state' }, 'Data for this filter cannot be shown. Reload or reset the filters.'));
        note(e.message, true);
        $('content').setAttribute('aria-busy', 'false');
    }
}
const fileSlug = () => (home() || 'institution').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'institution';
async function exportData(type) {
    if (!manifest)
        return;
    const exportFilter = { ...filter }, button = $(type === 'csv' ? 'export-csv' : 'export-json');
    button.disabled = true;
    note('Preparing the export of every work that matches the filter…');
    try {
        const rows = await task('export',{format:type});
        if (type === 'json')
            downloadText(JSON.stringify({ metadata: { snapshot: manifest.updated_at, filter: exportFilter, source: 'OpenAlex', ror: manifest.institution.ror }, results: rows }, null, 2), `${fileSlug()}-publications.json`, 'application/json');
        else {
            const keys = Object.keys(rows[0] || { id: '', title: '', retrieved_at: '' });
            downloadText('\uFEFF' + [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(csvCell).join(',')).join('\r\n'), `${fileSlug()}-publications.csv`, 'text/csv;charset=utf-8');
        }
        note('Export complete. The scope and snapshot date are included in the file.');
    }
    catch (e) {
        note(e.message, true);
    }
    finally {
        button.disabled = false;
    }
}
async function init() {
    document.documentElement.dataset.exportControls = EXPORT_CONTROLS ? 'visible' : 'hidden';
    document.documentElement.dataset.contentProtection = CONTENT_PROTECTION ? 'enabled' : 'disabled';
    if (CONTENT_PROTECTION) {
        document.addEventListener('contextmenu', event => {
            if (!event.target.closest('input,textarea,select,[contenteditable="true"]')) event.preventDefault();
        });
        // Copying and cutting page content is blocked; form fields (search, filters) keep normal editing.
        for (const type of ['copy', 'cut']) document.addEventListener(type, event => {
            if (!event.target.closest?.('input,textarea,select,[contenteditable="true"]')) event.preventDefault();
        });
        document.addEventListener('dragstart', event => {
            if (event.target.closest('img,svg,canvas')) event.preventDefault();
        });
        document.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && !event.altKey && ['s', 'p', 'u'].includes(event.key.toLowerCase())) {
                event.preventDefault();
                note('Save, print and view-source shortcuts are disabled on this dashboard.');
            }
        });
    }
    document.querySelector('.skip-link').onclick = event => {event.preventDefault();$('main').focus();$('main').scrollIntoView();};
    // Built after the manifest arrives: the Journals tab exists only when the institution has a publisher role.
    const buildNav = () => MODULES.forEach(([id, label, number], i) => { if (!moduleEnabled(id)) return; const a = el('a', { href: '#' + id, class: 'nav-link', 'data-module': id }); a.append(el('span', { class: 'nav-number', 'aria-hidden': 'true' }, icons[i]), el('span', {}, label)); a.onclick = e => { e.preventDefault(); if (!manifest)
        return; document.querySelector('.sidebar').classList.remove('open'); $('menu-toggle').setAttribute('aria-expanded', 'false'); openTab(id); }; $('navigation').append(a); });
    $('filters-form').onsubmit = e => { e.preventDefault(); if (!manifest)
        return; const next = { ...filter }; delete next.metricKind; delete next.metricPart; for (const [k, v] of new FormData(e.currentTarget))
        next[k] = v; setHash(currentModule, next); };
    $('reset').onclick = () => {
        topicGroup = '';
        topicSubfield = '';
        if (!manifest) return;
        const previousHash = location.hash;
        setHash(currentModule, journalPage() ? { journal: filter.journal } : authorPage() ? { author: filter.author } : moduleDefaults(currentModule));
        if (location.hash === previousHash) route();
    };
    $('menu-toggle').onclick = () => { const active = document.querySelector('.sidebar').classList.toggle('open'); $('menu-toggle').setAttribute('aria-expanded', String(active)); };
    $('close-detail').onclick = () => $('detail-dialog').close();
    $('detail-dialog').onclick = e => { if (e.target === $('detail-dialog')) {
        const r = e.target.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
            e.target.close();
    } };
    $('print').onclick = () => window.print();
    $('export-csv').onclick = () => exportData('csv');
    $('export-json').onclick = () => exportData('json');
    try {
        manifest = await getJSON('data/manifest.json');
        if (manifest.schema_version !== 1 || !manifest.complete)
            throw new Error('The snapshot is incomplete or its format is not supported.');
        setInstitution();
        buildNav();
        // The brand returns to the overview with the same clean reset as a navigation choice.
        document.querySelector('.brand').onclick = e => { e.preventDefault(); if (!manifest) return; openTab('overview'); };
        const age = (Date.now() - Date.parse(manifest.updated_at)) / 86400000;
        $('freshness').textContent = age > 10 ? 'Needs refresh' : 'Refreshed weekly';
        $('freshness').classList.toggle('stale', age > 10);
        $('freshness').title = formatDate(manifest.updated_at);
        $('snapshot-caption').textContent = `Snapshot ${formatDate(manifest.updated_at)}`;
        history = await getJSON(manifest.files.history.path);
        window.addEventListener('hashchange', route);
        await route();
    }
    catch (e) {
        note(e.message + ' Run the data collection and build first.', true);
        $('content').replaceChildren(el('div', { class: 'empty-state' }, 'No snapshot is available yet. No sample data is presented as real data.'));
        $('content').setAttribute('aria-busy', 'false');
    }
}
init();
