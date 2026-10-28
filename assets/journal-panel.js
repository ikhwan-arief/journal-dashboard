/*! Copyright (c) 2026 Ikhwan Arief (ikhwan[at]eng.unand.ac.id). All rights reserved.
 * Licensed under the PolyForm Noncommercial License 1.0.0
 * (https://polyformproject.org/licenses/noncommercial/1.0.0). Commercial use requires prior
 * written permission from the copyright holder. See LICENSE and NOTICE. */
import { el, panel, line, bar, PALETTE } from './charts.js';
import { journalRecap, INSTITUTION } from './metrics.js';

const count = n => new Intl.NumberFormat('en-US').format(n);
const ratio = n => n === null || n === undefined ? 'Not available' : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const pct = n => n === null || n === undefined ? 'Not available' : ratio(n) + '%';
const home = () => INSTITUTION.short_name;
export const METRIC_TITLES = { four_year: '4-year citation ratio', two_year: '2-year citation ratio', fwci: 'FWCI' };
const period = (from, to) => from === to ? String(from) : `${from}–${to}`;
const provenance = 'Computed from OpenAlex metadata and citation links at the snapshot date. The result is a dashboard indicator, not an official value from another index provider. Index coverage, document classification and the assigned publication year can affect the result.';
const updated = value => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: INSTITUTION.timezone, timeZoneName: 'short' }).format(new Date(value));
function link(label, href) { return el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label); }

export function metricYear(years, fallback, filter) {
    return years.includes(Number(filter.metricYear)) ? Number(filter.metricYear) : fallback;
}

function formulaHelp(container, kind, populationText) {
    const details = el('details', { class: 'journal-formula' });
    details.append(el('summary', {}, 'Formula and data source'));
    if (kind === 'four_year') {
        details.append(el('p', { class: 'journal-equation' }, 'R₄(Y) = citations in Y−3…Y to eligible documents published in Y−3…Y ÷ number of eligible documents published in Y−3…Y.'),
            el('p', {}, 'Eligible documents: articles, reviews, full conference papers, book chapters and data papers. The numerator and denominator use the same target document types. A dataset is not a data paper; a conference abstract is not a full paper.'),
            el('p', {}, 'Metadata mapping: article, review, conference-paper, proceedings-article (legacy label), book-chapter and data-paper. Metadata classification does not guarantee the same classification or selection as other indexes.'),
            el('p', {}, 'The formula structure follows the four-year CiteScore methodology. The value is computed independently from a different index.'),
            link('Formula methodology ↗', 'https://service.elsevier.com/app/answers/detail/a_id/14880/supporthub/scopus/'));
    } else {
        details.append(el('p', { class: 'journal-equation' }, 'R₂(Y) = citations in Y to all content published in Y−2 and Y−1 ÷ number of articles and reviews published in Y−2 and Y−1.'),
            el('p', {}, 'Citations to editorials, letters and other content can enter the numerator. The denominator counts only article and review metadata. Because the two sets differ, the value is a ratio to articles and reviews, not the mean citations per article.'),
            el('p', {}, 'The formula structure follows the standard two-year JIF. The value is computed independently; 2yr_mean_citedness is not used.'),
            link('Formula methodology ↗', 'https://clarivate.libguides.com/jcr/basics'));
    }
    details.append(el('p', {}, provenance), el('p', {}, `${populationText} Each work counts once per ID. Self-citations are included and retraction flags are kept. Valid high values are not capped. Unrecognised types are not forced into article/review.`),
        el('p', {}, 'Years without a citation entry count as zero only within the supported history. The timeline is limited so every window falls within the ten-year coverage. Historical values can change after metadata updates.'),
        link('Annual citation documentation ↗', 'https://help.openalex.org/data/works/attributes/'));
    container.append(details);
}
function drillButton(label, kind, part, year, onDrill) {
    const button = el('button', { class: 'data-drill', type: 'button', 'data-metric-part': part }, label);
    button.onclick = () => onDrill(kind, part, year);
    return button;
}
function drillActions(row, kind, onDrill) {
    const actions = el('div', { class: 'journal-drill-actions' });
    actions.append(drillButton('Explore numerator target documents', kind, 'numerator', row.year, onDrill),
        drillButton('Explore denominator documents', kind, 'denominator', row.year, onDrill));
    return actions;
}
function breakdown(container, row, kind, onDrill) {
    const details = el('details', { class: 'journal-breakdown' });
    details.append(el('summary', {}, 'Calculation details'),
        el('p', {}, `${count(row.target_documents)} numerator target documents, including those with zero citations. The number of target documents differs from their number of citations.`),
        el('p', {}, `${count(row.retracted)} documents with a retraction flag and ${count(row.unknown_types)} documents of unrecognised type in the publication window.${row.breakdown ? ' The breakdown includes excluded types so the denominator selection can be checked.' : ''}`),
        drillActions(row, kind, onDrill));
    if (row.breakdown) {
        const wrap = el('div', { class: 'table-scroll' }), table = el('table', { 'aria-label': `${METRIC_TITLES[kind]} breakdown` }), head = el('thead'), tr = el('tr'), body = el('tbody');
        for (const label of ['Publication year', 'Metadata type', 'Mapped documents', 'Target documents', 'Citations in window', 'Denominator documents']) tr.append(el('th', { scope: 'col' }, label));
        head.append(tr);
        for (const group of row.breakdown) {
            const tr = el('tr');
            for (const value of [group.year, group.type, group.works, group.targets, group.citations, group.denominator]) tr.append(el('td', {}, String(value)));
            body.append(tr);
        }
        if (!row.breakdown.length) {
            const tr = el('tr'); tr.append(el('td', { colspan: 6 }, 'No documents in this publication window.')); body.append(tr);
        }
        table.append(head, body); wrap.append(table); details.append(wrap);
    }
    container.append(details);
}
function yearPicker(years, snapshotYear, selected, onYear) {
    const toolbar = el('div', { class: 'journal-toolbar' }), label = el('label', {}, 'Metric year');
    const year = el('select', { id: 'metric-year', 'aria-label': 'Citation metric year' });
    for (const y of [...years].reverse()) year.append(el('option', { value: y }, `${y}${y === snapshotYear ? ' · Provisional — year in progress' : ''}`));
    year.value = selected;
    year.onchange = () => onYear(Number(year.value));
    label.append(year); toolbar.append(label);
    return toolbar;
}
function section(container, title) {
    const node = el('section', { class: 'journal-metrics', 'aria-labelledby': 'impact-metrics-title' });
    node.append(el('h2', { id: 'impact-metrics-title' }, title));
    container.append(node);
    return node;
}

// FWCI card and its timeline share one two-column row.
function fwciCard(row2, rows, year, ctx) {
    const container = row2, row = rows.find(r => r.year === year), title = ctx.fwciTitle;
    const card = el('article', { class: 'panel journal-fwci', 'data-impact-fwci': '' });
    card.append(el('h3', {}, title), el('p', { class: 'panel-note' }, `Mean FWCI of works published in ${year} · ${ctx.populationLabel}`));
    // Institution rows hide small bases like the FWCI timeline; journal rows show them with a note.
    const smallHidden = row?.status === 'small_sample';
    card.append(el('div', { class: 'journal-ratio-value journal-fwci-value' }, smallHidden ? 'Small metric base' : ratio(row?.value ?? null)),
        el('p', { class: 'journal-fwci-coverage' }, row ? `${count(row.denominator)} of ${count(row.total_documents)} works have a valid FWCI · coverage ${pct(row.coverage)}` : 'No works in this publication year.'));
    if (row?.numerator !== undefined) card.append(el('p', {}, row.denominator ? `Sum of FWCI scores ${ratio(row.numerator)} ÷ ${count(row.denominator)} works with the metric. Zero values are included; missing, negative or infinite scores are excluded.` : 'Not available — no works with a valid FWCI in this publication year.'));
    if (smallHidden) card.append(el('p', { class: 'journal-small-base' }, `Fewer than 30 works with the metric; the observed mean ${ratio(row.observed)} is not used as a score, as in the FWCI timeline.`));
    else if (row?.small_base) card.append(el('p', { class: 'journal-small-base' }, 'Small document base — fewer than 30 works with the metric.'));
    if (row?.window_incomplete) card.append(el('p', { class: 'journal-small-base' }, `The citation window ${year}–${year + 3} is not complete at the snapshot date. The score can change.`));
    const help = el('details', { class: 'fwci-help' });
    help.append(el('summary', {}, 'What FWCI means and how it is measured'),
        el('p', {}, 'FWCI (Field-Weighted Citation Impact) per work = citations received ÷ citations expected for works with the same year, type and subfield. The window covers the publication year and the three following years. Per-work scores come from OpenAlex; the dashboard does not recompute the global benchmark.'),
        el('p', {}, `${title} here is the mean of valid FWCI scores of works in the selected publication year (${ctx.populationLabel}). Coverage = works with a valid FWCI ÷ all works in that year × 100%. It is not total citations divided by total expected citations.`),
        el('p', {}, 'A benchmark of 1 is the global mean; 2 is twice that and 0.5 half. Consider metadata coverage and the number of works when reading the result.'),
        link('OpenAlex FWCI method ↗', 'https://help.openalex.org/data/works/citations/'));
    card.append(help);
    if (row?.denominator) card.append(drillButton('Explore works with a valid FWCI', 'fwci', 'denominator', year, ctx.onDrill));
    container.append(card);
    const chart = panel(row2, `${title} timeline`, `Mean FWCI score of works by publication year · ${ctx.populationLabel}. Click a year to update the metrics. Missing values leave gaps; the global benchmark stays at 1.`);
    chart.node.dataset.impactTimeline = 'fwci';
    line(chart, rows, { value: 'value', label: `Mean ${title}`, color: PALETTE[2], unit: 'FWCI', reference: 1, referenceLabel: 'Global benchmark FWCI 1', footer: ctx.footer,
        tooltip: r => `${r.year}: FWCI ${r.status === 'small_sample' ? 'small metric base' : ratio(r.value)} · ${count(r.denominator)}/${count(r.total_documents)} works · coverage ${pct(r.coverage)}${r.window_incomplete ? ' · citation window not complete' : ''}${r.small_base ? ' · small document base' : ''}`,
        onClick: r => ctx.onYear(r.year) });
}

/* Shared panel: four-year and two-year citation ratios plus FWCI for one population.
   series = { four_year, two_year, fwci } rows; used by the journal page and the Citation impact tab. */
export function renderImpactMetrics(container, series, ctx) {
    const node = section(container, ctx.title);
    node.append(el('p', { class: 'panel-note' }, ctx.note), yearPicker(ctx.years, ctx.snapshotYear, ctx.year, ctx.onYear));
    // Rows: ratio cards, ratio timelines, then FWCI card beside the FWCI timeline.
    const cards = el('div', { class: 'journal-ratio-grid' }), charts = el('div', { class: 'charts-grid journal-timelines' }), fwciRow = el('div', { class: 'charts-grid journal-timelines journal-fwci-row' });
    node.append(cards, charts, fwciRow);
    for (const [i, kind] of ['four_year', 'two_year'].entries()) {
        const row = series[kind].find(r => r.year === ctx.year), title = METRIC_TITLES[kind];
        const card = el('article', { class: 'panel journal-ratio', 'data-impact-metric': kind });
        card.append(el('h3', {}, title), el('p', { class: 'panel-note' }, kind === 'four_year' ? 'Citations and publications in the same four-year window · CiteScore pattern' : 'One year of citations to the two previous years of publications · JIF pattern'),
            el('div', { class: 'journal-ratio-value' }, ratio(row.value)),
            el('p', { class: 'journal-status' }, row.denominator === 0 ? 'Not available — no denominator documents' : row.status === 'provisional' ? 'Provisional — year not complete' : 'Complete calendar year · data as of the snapshot'));
        if (row.small_base) card.append(el('p', { class: 'journal-small-base' }, 'Small document base — fewer than 30 denominator documents.'));
        const counts = el('dl', { class: 'journal-counts' });
        counts.append(el('dt', {}, kind === 'four_year' ? 'Citations in the 4-year window' : 'Citations in the metric year'),
            el('dd', { 'data-metric-count': 'numerator' }, count(row.numerator)),
            el('dt', {}, kind === 'four_year' ? 'Documents published in the 4-year window' : 'Articles and reviews in the 2 previous years'),
            el('dd', { 'data-metric-count': 'denominator' }, count(row.denominator)));
        card.append(counts, el('p', {}, `Publication period: ${period(row.publication_from, row.publication_to)}. ${kind === 'four_year' ? 'Citation period' : 'Citation year'}: ${period(row.citation_from, row.citation_to)}.`),
            el('p', {}, kind === 'four_year' ? 'Citations per document in the observation window; documents do not all receive the same number of citations.' : 'The numerator covers more content than the denominator. This is not the mean citations per article.'));
        formulaHelp(card, kind, ctx.populationText); breakdown(card, row, kind, ctx.onDrill); cards.append(card);
        const chart = panel(charts, `${title} timeline`, kind === 'four_year'
            ? 'Four-year windows move and overlap. Click a year to update the panel. Missing scores leave gaps.'
            : 'Each point uses citations in the metric year to content of the two previous years. Click a year to update the panel. Missing scores leave gaps.');
        chart.node.dataset.impactTimeline = kind;
        line(chart, series[kind], { value: 'value', label: title, color: PALETTE[i === 0 ? 0 : 3], unit: 'citations per denominator document', footer: ctx.footer,
            tooltip: r => `${r.year}${r.status === 'provisional' ? ' (provisional)' : ''}: ${ratio(r.value)} · ${count(r.numerator)} citations ÷ ${count(r.denominator)} documents · publications ${period(r.publication_from, r.publication_to)} · citations ${period(r.citation_from, r.citation_to)}${r.small_base ? ' · small document base' : ''}`,
            onClick: r => ctx.onYear(r.year) });
    }
    fwciCard(fwciRow, series.fwci, ctx.year, ctx);
    return node;
}

// Journals tab: recap of every metric across all journals mapped to the institution as publisher for the selected and the running year.
export function renderJournalRecap(container, dataset, filter, onYear) {
    const node = section(container, `Citation impact of ${home()} journals`);
    if (!dataset) { node.append(el('p', { class: 'empty-state' }, 'The journal metrics dataset is not available in this snapshot.')); return; }
    if (!dataset.journals.length) { node.append(el('p', { class: 'empty-state' }, `No journal-type sources are mapped to ${home()} as publisher yet.`)); return; }
    const titles = { ...METRIC_TITLES, fwci: 'Journal FWCI' };
    const year = metricYear(dataset.years, dataset.defaults.year, filter), recap = journalRecap(dataset, year), running = journalRecap(dataset, dataset.snapshot_year);
    const series = dataset.years.map(y => journalRecap(dataset, y));
    node.append(el('p', { class: 'panel-note' }, `Recap of ${count(dataset.journals.length)} journals mapped to ${home()} as publisher. The across-journal mean weights every journal with a value equally; pooled = sum of numerators ÷ sum of denominators over all journals, so high-volume journals weigh more. Each journal's values are in the Journals table below; click a journal name to open its page. Data updated: ${updated(dataset.updated_at)}. The Explore the data filters do not change this recap.`),
        yearPicker(dataset.years, dataset.snapshot_year, year, onYear));
    // Three recap cards and their three timelines each fill one three-column row.
    const cards = el('div', { class: 'journal-recap-grid' }), charts = el('div', { class: 'journal-recap-grid journal-recap-timelines' });
    node.append(cards);
    for (const [i, kind] of ['four_year', 'two_year', 'fwci'].entries()) {
        const r = recap[kind], title = titles[kind];
        const card = el('article', { class: 'panel journal-ratio journal-recap', 'data-journal-recap': kind });
        card.append(el('h3', {}, title), el('p', { class: 'panel-note' }, `Across-journal mean · ${kind === 'fwci' ? 'works published in ' : 'metric year '}${year}`),
            el('div', { class: 'journal-ratio-value' }, ratio(r.mean)),
            el('p', { class: 'journal-status' }, r.status === 'unavailable' ? 'Not available — no journal has a value' : r.status === 'provisional' ? 'Provisional — year or citation window not complete' : 'Complete calendar year · data as of the snapshot'));
        const counts = el('dl', { class: 'journal-counts' });
        counts.append(el('dt', {}, 'Across-journal median'), el('dd', { 'data-journal-count': 'median' }, ratio(r.median)),
            el('dt', {}, kind === 'fwci' ? 'Pooled over all works with the metric' : 'Pooled over all journals'), el('dd', { 'data-journal-count': 'pooled' }, ratio(r.pooled)),
            el('dt', {}, 'Journals with a value'), el('dd', { 'data-journal-count': 'journals' }, `${count(r.journals_with_value)} of ${count(recap.journals)}`));
        card.append(counts, el('p', {}, kind === 'fwci'
            ? `Pooled = sum of FWCI scores ${ratio(r.numerator)} ÷ ${count(r.denominator)} works with the metric out of ${count(r.total_documents)} works · coverage ${pct(r.coverage)}. The global FWCI benchmark stays at 1.`
            : `Pooled = ${count(r.numerator)} citations ÷ ${count(r.denominator)} denominator documents across all journals.`));
        if (year !== dataset.snapshot_year) {
            const now = running[kind];
            card.append(el('p', { class: 'journal-running', 'data-journal-running': kind }, `Year in progress ${dataset.snapshot_year} (provisional): mean ${ratio(now.mean)} · pooled ${ratio(now.pooled)} · ${count(now.journals_with_value)} journals with a value.`));
        }
        if (kind === 'fwci') {
            const help = el('details', { class: 'fwci-help' });
            help.append(el('summary', {}, 'What FWCI means and how it is measured'),
                el('p', {}, 'FWCI per work = citations received ÷ citations expected for works with the same year, type and subfield, over the publication year and the three following years. Per-work scores come from OpenAlex.'),
                el('p', {}, 'Journal FWCI = mean of the valid scores of a journal\'s works in the selected publication year. The across-journal mean averages those values; pooled averages every work score with the metric across all journals.'),
                link('OpenAlex FWCI method ↗', 'https://help.openalex.org/data/works/citations/'));
            card.append(help);
        } else formulaHelp(card, kind, 'Works are mapped to a journal through their primary source; every affiliation and the full collected corpus are included.');
        cards.append(card);
        const chart = panel(charts, `${title} timeline`, 'Across-journal mean per metric year. Click a year to update the recap; years without any journal value leave gaps.');
        chart.node.dataset.journalTimeline = kind;
        line(chart, series.map(s => ({ year: s.year, value: s[kind].mean, pooled: s[kind].pooled, n: s[kind].journals_with_value, status: s[kind].status })), {
            value: 'value', label: `${title} · across-journal mean`, color: PALETTE[[0, 3, 2][i]], unit: kind === 'fwci' ? 'FWCI' : 'citations per denominator document',
            ...(kind === 'fwci' ? { reference: 1, referenceLabel: 'Global benchmark FWCI 1' } : {}),
            footer: `All journals mapped to ${home()} as publisher · Snapshot ${dataset.updated_at}`,
            tooltip: s => `${s.year}${s.status === 'provisional' ? ' (provisional)' : ''}: mean ${ratio(s.value)} · pooled ${ratio(s.pooled)} · ${count(s.n)} journals with a value`,
            onClick: s => onYear(s.year) });
    }
    node.append(charts);
    return year;
}

// Journal page header and metric panel: data from journal-metrics.json for this journal only.
// A journal joins through the ROR's publisher in OpenAlex or, when OpenAlex files it elsewhere, through the
// organisation's DOI prefix; the second case is stated on the page.
// ISSNs with their Crossref type, e.g. "2442-5230 (electronic), 0126-2092 (print)".
export function issnText(journal) {
    const types = journal.issn_types || {};
    return journal.issn.map(i => types[i.toUpperCase()] ? `${i} (${types[i.toUpperCase()]})` : i).join(', ');
}
// DOI coverage of the journal against Crossref: registered DOIs, found in OpenAlex, known only from Crossref.
export function coverageText(journal) {
    const c = journal.doi_coverage;
    if (!c) return '';
    const n = v => new Intl.NumberFormat('en-US').format(v || 0);
    return `DOIs at Crossref: ${n(c.crossref_dois)} · in OpenAlex: ${n(c.in_openalex)}${c.duplicate_dois ? ` · duplicate DOI registrations of works already listed: ${n(c.duplicate_dois)}` : ''} · Crossref only: ${n(c.crossref_only)}${c.openalex_not_in_crossref ? ` · prefix DOIs in OpenAlex but not listed at Crossref: ${n(c.openalex_not_in_crossref)}` : ''} · `;
}
export function inclusionText(dataset, journal) {
    if (journal.inclusion === 'crossref') return `Known only from Crossref under DOI prefix ${(dataset.doi_prefixes || []).join(', ')}; not found in OpenAlex · `;
    if (journal.inclusion !== 'doi_prefix') return '';
    const prefixes = (dataset.doi_prefixes || []).join(', ') || 'the organisation\'s DOI prefix';
    const share = Number.isFinite(journal.prefix_share) ? ` (${Math.round(journal.prefix_share * 100)}% of its DOI works)` : '';
    return `Included via DOI prefix ${prefixes}${share}; OpenAlex lists it under another or no publisher · `;
}
export function renderJournalHeader(container, dataset, journal, onBack) {
    const header = el('section', { class: 'journal-page-head' }), back = el('button', { class: 'button secondary', type: 'button' }, `← All ${home()} journals`);
    back.onclick = onBack;
    header.append(back, el('h2', { id: 'journal-page-title' }, journal.name),
        el('p', { class: 'panel-note' }, `${journal.issn.length ? 'ISSN ' + issnText(journal) + ' · ' : ''}${inclusionText(dataset, journal)}${coverageText(journal)}Journal page: KPIs, metrics, charts and the article list hold only works published in this journal (every affiliation, full collected corpus). Data updated: ${updated(dataset.updated_at)}.`));
    container.append(header);
    return header;
}
// Public iframe address shown at the bottom of every journal profile. Keeping this pure makes the
// site path, journal ID and encoded accent independently testable before the browser renders it.
export function journalEmbedURL(siteURL, journalID, accent = '#0e6bbd') {
    if (!/^S\d{1,15}$/i.test(journalID || '') || !/^#[0-9a-f]{6}$/i.test(accent || '')) return '';
    try {
        const base = new URL(siteURL);
        if (!['http:', 'https:'].includes(base.protocol)) return '';
        if (!base.pathname.endsWith('/')) base.pathname += '/';
        const url = new URL('embed.html', base);
        url.searchParams.set('journal', journalID.toUpperCase());
        url.searchParams.set('accent', accent.toLowerCase());
        return url.href;
    } catch {
        return '';
    }
}
export function journalWidgetInstall(siteURL, journalID) {
    if (!/^S\d{1,15}$/i.test(journalID || '')) return null;
    try {
        const base = new URL(siteURL);
        if (!['http:', 'https:'].includes(base.protocol)) return null;
        if (!base.pathname.endsWith('/')) base.pathname += '/';
        const scriptURL = new URL('assets/widget.js', base).href, id = journalID.toUpperCase();
        return {
            script_url: scriptURL,
            script_tag: `<script src="${scriptURL}" defer></script>`,
            placeholder: `[journal-metrics ${id}]`,
            html_mount: `<div data-journal-metrics="${id}"></div>`,
        };
    } catch {
        return null;
    }
}
// Author profile header: identity, roles on the works in this dashboard, and OpenAlex career figures kept apart.
export function renderAuthorHeader(container, author, home, onBack) {
    // The page title already shows the author's name, so the header starts with identity links.
    const header = el('section', { class: 'journal-page-head author-page-head', 'data-author-page': author.id }), back = el('button', { class: 'button secondary', type: 'button' }, '← All authors');
    back.onclick = onBack;
    const facts = el('dl', { class: 'journal-counts author-facts' });
    const span = author.first_year === null ? 'Not available' : author.first_year === author.last_year ? String(author.first_year) : `${author.first_year}–${author.last_year}`;
    for (const [label, value] of [['Articles in this dashboard', count(author.works)], [`With ${home} affiliation`, count(author.home_works)], ['Publication years', span],
        ['First author', count(author.first_author)], ['Last author', count(author.last_author)], ['Corresponding author', count(author.corresponding)]])
        facts.append(el('dt', {}, label), el('dd', {}, value));
    const identity = el('p', { class: 'panel-note' }, `OpenAlex author ${author.id}`);
    if (author.orcid) identity.append(document.createTextNode(' · '), link('ORCID ↗', author.orcid));
    identity.append(document.createTextNode(' · '), link('OpenAlex profile ↗', 'https://openalex.org/' + author.id));
    const grid = el('div', { class: 'author-head-grid' }), left = el('div');
    left.append(el('h3', {}, 'In this dashboard'), facts);
    grid.append(left);
    const career = author.career, careerKnown = [career.works, career.citations, career.h_index, career.i10_index].some(n => n !== null && n !== undefined);
    if (careerKnown) {
        const right = el('div'), list = el('dl', { class: 'journal-counts author-facts' }), value = n => n === null || n === undefined ? 'Not available' : count(n);
        for (const [label, n] of [['Works', career.works], ['Citations', career.citations], ['h-index', career.h_index], ['i10-index', career.i10_index]])
            list.append(el('dt', {}, label), el('dd', {}, value(n)));
        right.append(el('h3', {}, 'OpenAlex career, all affiliations'), list);
        grid.append(right);
    }
    header.append(back, identity, grid,
        el('p', { class: 'panel-note' }, `KPIs, charts and the list below cover every article in this dashboard that lists this author; filters narrow them. Author identities come from OpenAlex disambiguation and can be imperfect; this is not an official performance assessment.${careerKnown ? ' Career figures come from the author\'s OpenAlex profile and include work outside this dashboard.' : ' OpenAlex career figures are not collected for this snapshot.'}`));
    container.append(header);
    return header;
}
export function renderJournalMetrics(container, dataset, journal, filter, { onYear, onDrill }) {
    const year = metricYear(dataset.years, dataset.defaults.year, filter);
    return renderImpactMetrics(container, journal.series, {
        title: 'Journal citation impact', fwciTitle: 'Journal FWCI', years: dataset.years, snapshotYear: dataset.snapshot_year, year, onYear, onDrill,
        populationLabel: 'works of this journal',
        populationText: 'Only works mapped to this journal through their primary source; every affiliation and the full collected corpus are included.',
        note: `Metrics of ${journal.name} for the selected year. Filters on the journal page do not change this panel. ${count(journal.excluded_publication_years)} documents without an eligible publication year are not used.`,
        footer: `${journal.name} · Every affiliation, full collected corpus · Snapshot ${dataset.updated_at}` });
}

// Citations per year for one journal, with three-year totals for the window ending at the selected metric year.
export function renderJournalCitations(container, dataset, journal, filter, onYear) {
    const history = journal.citations;
    if (!history) return;
    const year = metricYear(dataset.years, dataset.defaults.year, filter), window = history.three_year.find(r => r.year === year);
    const p = panel(container, 'Citations per year', `Citations received by all works of ${journal.name} in each citation year (OpenAlex counts_by_year, ${history.by_year[0].year}–${history.by_year.at(-1).year}). ${dataset.snapshot_year}* is not complete. Click a year to choose the three-year window ending in that year.`);
    p.node.dataset.journalCitations = '';
    p.node.classList.add('journal-citations');
    const selectable = new Set(dataset.years);
    bar(p, history.by_year.map(r => ({ id: String(r.year), name: `${r.year}${r.partial ? '*' : ''}`, count: r.citations, year: r.year })),
        { horizontal: false, limit: history.by_year.length, unit: 'citations', color: PALETTE[0], onClick: r => selectable.has(r.year) && onYear(r.year) });
    // Visible table of the plotted values, years across, under the chart.
    const tableWrap = el('div', { class: 'table-scroll citation-year-table' }), table = el('table', { 'aria-label': 'Citations per year' }), years = el('tr'), counts = el('tr');
    years.append(el('th', { scope: 'row' }, 'Year')); counts.append(el('th', { scope: 'row' }, 'Citations'));
    for (const r of history.by_year) { years.append(el('th', { scope: 'col', class: 'num' }, `${r.year}${r.partial ? '*' : ''}`)); counts.append(el('td', { class: 'num', 'data-citation-year': r.year }, count(r.citations))); }
    const tbody = el('tbody'); tbody.append(years, counts); table.append(tbody); tableWrap.append(table); p.node.append(tableWrap);
    if (!window) return;
    const span = `${window.from}–${window.to}`, totals = el('dl', { class: 'journal-counts journal-citation-totals' });
    totals.append(el('dt', {}, `Total citations ${span}`), el('dd', { 'data-citation-total': 'all' }, count(window.citations)),
        el('dt', {}, `Total citations ${span} to works published ${span}`), el('dd', { 'data-citation-total': 'recent' }, count(window.recent_citations)));
    p.node.append(totals, el('p', { class: 'panel-note' }, `The three-year window ends in metric year ${year}. The first number sums citations in ${span} to every work of the journal, whatever its publication year. The second counts only citations to the ${count(window.recent_documents)} works published in ${span}, all document types. Self-citations are included.${window.partial ? ` ${dataset.snapshot_year} is not complete; the totals can grow.` : ''}`));
}

// The single journals table: every journal mapped to the institution with filter-dependent output (works, external share)
// and metric-year values (both ratios, FWCI). `sources` maps journal ID to its row in the active filter.
export function renderJournalTable(section, dataset, year, sources, onOpen) {
    const titles = { ...METRIC_TITLES, fwci: 'Journal FWCI' }, metric = (j, kind) => j.series[kind].find(r => r.year === year) || null;
    const rows = dataset.journals.map(j => {
        const s = sources.get(j.id), works = s?.count || 0;
        return { journal: j, works, external: works ? (works - s.local) / works * 100 : null,
            four_year: metric(j, 'four_year'), two_year: metric(j, 'two_year'), fwci: metric(j, 'fwci') };
    });
    const columns = [['name', 'Journal', ''], ['works', 'Works in filter', 'num'], ['external', `% without ${home()} affiliation`, 'num'],
        ['four_year', `${titles.four_year} ${year}`, 'num'], ['two_year', `${titles.two_year} ${year}`, 'num'], ['fwci', `${titles.fwci} ${year}`, 'num']];
    const value = (row, key) => key === 'name' ? row.journal.name : ['four_year', 'two_year', 'fwci'].includes(key) ? row[key]?.value ?? null : row[key];
    let sortKey = 'works', direction = -1, query = '';
    const head = el('div', { class: 'panel-head' }), labels = el('div');
    labels.append(el('h2', {}, `${home()} journals`), el('p', {}, `${count(dataset.journals.length)} journals mapped to ${home()} as publisher. Works and % without ${home()} affiliation follow the Explore the data filters; % = works without a ${home()} authorship ÷ the journal's works in the filter × 100%. Metric columns use metric year ${year} with every affiliation and the full corpus. * = base of fewer than 30 documents. Click a column heading to sort; click a journal name to open its page. Not an official list of active journals.`));
    head.append(labels);
    const search = el('input', { class: 'search-input', type: 'search', placeholder: 'Search journal name', 'aria-label': 'Search journal name' });
    const toolbar = el('div', { class: 'table-toolbar' }), status = el('span', { class: 'journal-search-status', role: 'status', 'aria-live': 'polite' });
    toolbar.append(search, status);
    const wrap = el('div', { class: 'table-scroll' }), table = el('table', { 'aria-label': 'Journals and their metrics' }), thead = el('thead'), headRow = el('tr'), body = el('tbody');
    const mark = r => r ? `${ratio(r.value)}${r.small_base ? '*' : ''}` : 'Not available';
    const draw = () => {
        const term = query.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');
        const visible = rows.filter(r => r.journal.name.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').includes(term))
            .sort((a, b) => {
                const x = value(a, sortKey), y = value(b, sortKey);
                if (x === null || y === null) return x === y ? a.journal.name.localeCompare(b.journal.name, 'en') : x === null ? 1 : -1;
                return (typeof x === 'string' ? x.localeCompare(y, 'en') : x - y) * direction || a.journal.name.localeCompare(b.journal.name, 'en');
            });
        body.replaceChildren();
        for (const r of visible) {
            const tr = el('tr', { 'data-journal-row': r.journal.id }), name = el('td'), j = r.journal;
            const button = el('button', { class: 'work-title', type: 'button', 'data-journal-profile': j.id }, j.name);
            button.onclick = () => onOpen(j.id, year);
            const meta = [j.issn.length ? 'ISSN ' + j.issn.join(', ') : 'ISSN not available', `DOAJ ${j.doaj === null || j.doaj === undefined ? 'not available' : j.doaj ? 'yes' : 'no'}`,
                `APC ${j.apc_usd === null || j.apc_usd === undefined ? 'not available' : 'US$ ' + count(j.apc_usd)}`].join(' · ');
            name.append(button, el('span', { class: 'work-source' }, meta));
            tr.append(name, el('td', { class: 'num', 'data-col': 'works' }, count(r.works)), el('td', { class: 'num', 'data-col': 'external' }, pct(r.external)),
                el('td', { class: 'num', 'data-col': 'four_year' }, mark(r.four_year)), el('td', { class: 'num', 'data-col': 'two_year' }, mark(r.two_year)), el('td', { class: 'num', 'data-col': 'fwci' }, mark(r.fwci)));
            body.append(tr);
        }
        if (!visible.length) { const tr = el('tr'); tr.append(el('td', { colspan: columns.length }, 'No journals match.')); body.append(tr); }
        status.textContent = `${visible.length} journals shown`;
        for (const th of headRow.children) th.setAttribute('aria-sort', th.dataset.key === sortKey ? (direction > 0 ? 'ascending' : 'descending') : 'none');
    };
    for (const [key, label, cls] of columns) {
        const th = el('th', { scope: 'col', class: cls, 'data-key': key }), button = el('button', { class: 'sort-button', type: 'button' }, label);
        button.onclick = () => { direction = sortKey === key ? -direction : key === 'name' ? 1 : -1; sortKey = key; draw(); };
        th.append(button); headRow.append(th);
    }
    search.oninput = () => { query = search.value.trim(); draw(); };
    thead.append(headRow); table.append(thead, body); wrap.append(table);
    section.replaceChildren(head, toolbar, wrap);
    draw();
    section.setAttribute('aria-busy', 'false');
}
