/*! Copyright (c) 2026 Ikhwan Arief (ikhwan[at]eng.unand.ac.id). All rights reserved.
 * Licensed under the PolyForm Noncommercial License 1.0.0
 * (https://polyformproject.org/licenses/noncommercial/1.0.0). Commercial use requires prior
 * written permission from the copyright holder. See LICENSE and NOTICE. */
/* Pure metric functions shared by the browser worker and snapshot builder. */
export const MODULES = [
    ['overview', 'Overview', '01'], ['publications', 'Publications', '02'],
    ['authors', 'Authors', '03'], ['citations', 'Citation impact', '04'],
    ['collaboration', 'Collaboration', '05'], ['topics', 'Fields & topics', '06'],
    ['sdgs', 'SDGs', '07'], ['oa', 'Open access', '08'],
    ['funding', 'Funding', '09'], ['journals', 'Journals', '10'],
    ['repositories', 'Repositories', '11'], ['audit', 'Audit & methodology', '12'],
];
// The configured institution (manifest.institution); build, worker and page call configureInstitution() first.
export const INSTITUTION = { id: '', ror: '', name: '', short_name: '', country_code: '', timezone: 'UTC', first_year: 1900, first_year_source: '' };
export function configureInstitution(institution = {}) {
    for (const key of Object.keys(INSTITUTION)) if (institution[key] !== undefined && institution[key] !== null) INSTITUTION[key] = institution[key];
    return INSTITUTION;
}
export const SDGS = ['No poverty', 'Zero hunger', 'Good health', 'Quality education',
    'Gender equality', 'Clean water & sanitation', 'Clean energy', 'Decent work & growth',
    'Industry & innovation', 'Reduced inequalities', 'Sustainable cities', 'Responsible consumption',
    'Climate action', 'Life below water', 'Life on land', 'Peace & institutions', 'Partnerships'];
// Official UN goal names (used in the work detail); SDGS above stays the short chart label.
export const SDG_NAMES = ['No poverty', 'Zero hunger', 'Good health and well-being', 'Quality education',
    'Gender equality', 'Clean water and sanitation', 'Affordable and clean energy', 'Decent work and economic growth',
    'Industry, innovation and infrastructure', 'Reduced inequalities', 'Sustainable cities and communities',
    'Responsible consumption and production', 'Climate action', 'Life below water', 'Life on land',
    'Peace, justice and strong institutions', 'Partnerships for the goals'];
// Goals of one work, highest classifier score first, goal number as tie-breaker; scores stay null when unknown.
export function workSdgs(work) {
    if (!Array.isArray(work.sdgs)) return null;
    return [...new Set(work.sdgs.map(String))].filter(id => /^(?:[1-9]|1[0-7])$/.test(id))
        .map(id => ({ id, number: Number(id), name: SDG_NAMES[Number(id) - 1], score: validNumber(work.sdg_scores?.[id]) ? work.sdg_scores[id] : null }))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.number - b.number);
}
export const BINS = [[0, 0, '0 citations'], [1, 5, '1–5'], [6, 10, '6–10'], [11, 50, '11–50'], [51, 100, '51–100'], [101, Infinity, '>100']];
// Citing works are stored in shards keyed by the cited work, so build and browser locate them the same way.
export const CITING_SHARDS = 256, CITING_OWN_FILE = 1000;
export const citingShard = id => Number(String(id).replace(/^W/, '')) % CITING_SHARDS;
// Compact citing-work rows: [id, doi, title, year, date, type, source, authors, author_count, oa, url].
export const CITING_FIELDS = ['id', 'doi', 'title', 'year', 'date', 'type', 'source', 'authors', 'author_count', 'oa', 'url'];
// 'all' is the union of the institution's scopes; audit candidates are never part of it.
export const INSTITUTION_SCOPES = ['affiliated', 'funded', 'published'];
export const validNumber = value => typeof value === 'number' && Number.isFinite(value);
export const JOURNAL_METRIC_POLICY = {
    version: 1, citation_history_years: 10, small_base: 30,
    four_year_types: ['article', 'review', 'conference-paper', 'proceedings-article', 'book-chapter', 'data-paper'],
    two_year_denominator_types: ['article', 'review'],
    corpus: 'all', scope: 'published', source_mapping: 'primary_location', includes_self_citations: true,
    fwci: { population: 'publication_year', aggregation: 'mean_of_valid_work_scores', include_zero: true, exclude_negative: true },
};
const knownWorkTypes = new Set(['article', 'review', 'conference-paper', 'proceedings-article', 'conference-abstract',
    'book', 'book-chapter', 'book-review', 'data-paper', 'dataset', 'dissertation', 'editorial', 'erratum', 'letter',
    'libguides', 'other', 'paratext', 'peer-review', 'preprint', 'reference-entry', 'report', 'retraction',
    'software', 'software-paper', 'standard', 'supplementary-materials']);
export function validateCitationYears(work) {
    if (!Array.isArray(work.citation_years)) throw new Error('Missing annual citation data; previous snapshot retained.');
    const seen = new Set();
    for (const pair of work.citation_years) {
        if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0]) || pair[0] < 1500 ||
            !Number.isSafeInteger(pair[1]) || pair[1] < 0 || seen.has(pair[0]))
            throw new Error('Invalid or duplicate annual citation data; previous snapshot retained.');
        seen.add(pair[0]);
    }
}
export function journalWindow(kind, year) {
    if (kind === 'fwci') return { publication_from: year, publication_to: year, citation_from: year, citation_to: year + 3 };
    return kind === 'four_year'
        ? { publication_from: year - 3, publication_to: year, citation_from: year - 3, citation_to: year }
        : { publication_from: year - 2, publication_to: year - 1, citation_from: year, citation_to: year };
}
export function journalContribution(work, kind, year) {
    if (kind === 'fwci') return work.fwci;
    const window = journalWindow(kind, year);
    return work.citation_years.reduce((sum, [y, count]) => y >= window.citation_from && y <= window.citation_to ? sum + count : sum, 0);
}
export const METRIC_KINDS = ['four_year', 'two_year', 'fwci'];
// Drill membership. With `journal`: one of the institution's journals, fixed full-corpus scope. Without: the active filter minus its period.
export function citationMetricMember(work, entities, filter, snapshotYear) {
    const year = Number(filter.metricYear), kind = filter.metricKind;
    if (!METRIC_KINDS.includes(kind) || !['numerator', 'denominator'].includes(filter.metricPart) ||
        !Number.isInteger(year) || year < snapshotYear - 6 || year > snapshotYear || !Number.isInteger(work.year)) return false;
    if (filter.journal && (entities.sources[filter.journal]?.type !== 'journal' || !entities.sources[filter.journal]?.home_publisher ||
        work.source !== filter.journal || !work.scopes.includes('published'))) return false;
    const window = journalWindow(kind, year);
    if (work.year < window.publication_from || work.year > window.publication_to) return false;
    if (kind === 'fwci') return validNumber(work.fwci) && work.fwci >= 0;
    if (kind === 'four_year') return JOURNAL_METRIC_POLICY.four_year_types.includes(work.type);
    return filter.metricPart === 'numerator' || JOURNAL_METRIC_POLICY.two_year_denominator_types.includes(work.type);
}
export function metricDrill(year, kind, part, journal = '') {
    return journal ? { journal, metricYear: year, metricKind: kind, metricPart: part } : { metricYear: year, metricKind: kind, metricPart: part };
}
export const snapshotYearOf = manifest => Number(new Intl.DateTimeFormat('en', { timeZone: INSTITUTION.timezone, year: 'numeric' }).format(new Date(manifest.updated_at)));
// Four-year (CiteScore-style), two-year (JIF-style) and FWCI-mean series for any set of works.
export function citationRatioSeries(works, years, snapshotYear, { breakdown = true, fwci = true } = {}) {
    const series = { four_year: [], two_year: [] };
    for (const kind of ['four_year', 'two_year']) for (const year of years) {
        const window = journalWindow(kind, year), groups = new Map();
        let numerator = 0, denominator = 0, targets = 0, retracted = 0, unknownTypes = 0;
        for (const work of works) {
            if (!Number.isInteger(work.year) || work.year < window.publication_from || work.year > window.publication_to) continue;
            const eligible = (kind === 'four_year' ? JOURNAL_METRIC_POLICY.four_year_types : JOURNAL_METRIC_POLICY.two_year_denominator_types).includes(work.type);
            const contribution = kind === 'four_year' && !eligible ? 0 : journalContribution(work, kind, year);
            const target = kind === 'two_year' || eligible;
            numerator += contribution;
            denominator += Number(eligible);
            targets += Number(target);
            retracted += Number(Boolean(work.retracted));
            unknownTypes += Number(!knownWorkTypes.has(work.type));
            if (!breakdown) continue;
            const key = `${work.year}|${work.type}`;
            const group = groups.get(key) || { year: work.year, type: work.type, works: 0, targets: 0, citations: 0, denominator: 0, retracted: 0 };
            group.works++; group.targets += Number(target); group.citations += contribution;
            group.denominator += Number(eligible); group.retracted += Number(Boolean(work.retracted));
            groups.set(key, group);
        }
        if (![numerator, denominator].every(Number.isSafeInteger)) throw new Error('Citation metric count exceeds safe integer range.');
        series[kind].push({ year, ...window, numerator, denominator, target_documents: targets,
            value: denominator ? numerator / denominator : null, status: denominator ? (year === snapshotYear ? 'provisional' : 'complete') : 'unavailable',
            small_base: denominator > 0 && denominator < JOURNAL_METRIC_POLICY.small_base,
            retracted, unknown_types: unknownTypes,
            ...(breakdown ? { breakdown: [...groups.values()].sort((a, b) => a.year - b.year || a.type.localeCompare(b.type)) } : {}) });
    }
    if (!fwci) return series;
    series.fwci = years.map(year => {
        const annual = works.filter(w => w.year === year);
        const eligible = annual.filter(w => validNumber(w.fwci) && w.fwci >= 0);
        const sum = eligible.reduce((n, w) => n + w.fwci, 0);
        if (!Number.isFinite(sum)) throw new Error('Invalid FWCI aggregate.');
        return { year, ...journalWindow('fwci', year), numerator: sum, denominator: eligible.length,
            total_documents: annual.length, coverage: annual.length ? eligible.length / annual.length * 100 : null,
            value: eligible.length ? sum / eligible.length : null, window_incomplete: year + 3 >= snapshotYear,
            small_base: eligible.length > 0 && eligible.length < JOURNAL_METRIC_POLICY.small_base,
            status: !eligible.length ? 'unavailable' : year + 3 >= snapshotYear ? 'provisional' : 'complete' };
    });
    return series;
}
// Citations a journal receives per citation year, plus three-year totals ending at each metric year:
// all citations in the window, and citations in the window to works published in the same window.
export function journalCitationHistory(works, snapshotYear, metricYears) {
    const from = snapshotYear - 9, byYear = new Map(Array.from({ length: 10 }, (_, i) => [from + i, 0]));
    for (const work of works) for (const [year, count] of work.citation_years)
        if (byYear.has(year)) byYear.set(year, byYear.get(year) + count);
    const by_year = [...byYear].map(([year, citations]) => ({ year, citations, partial: year === snapshotYear }));
    const three_year = metricYears.map(year => {
        const start = year - 2, inWindow = ([y]) => y >= start && y <= year;
        const recent = works.filter(w => Number.isInteger(w.year) && w.year >= start && w.year <= year);
        const sum = list => list.reduce((n, w) => n + w.citation_years.filter(inWindow).reduce((m, [, c]) => m + c, 0), 0);
        const total = sum(works), recentTotal = sum(recent);
        if (![total, recentTotal].every(Number.isSafeInteger)) throw new Error('Journal citation total exceeds safe integer range.');
        return { year, from: start, to: year, citations: total, recent_citations: recentTotal, recent_documents: recent.length, partial: year === snapshotYear };
    });
    return { by_year, three_year };
}
export function buildJournalMetrics(works, entities, manifest) {
    const snapshotYear = snapshotYearOf(manifest);
    const years = Array.from({ length: 7 }, (_, i) => snapshotYear - 6 + i);
    const journals = Object.entries(entities.sources).filter(([, s]) => s.home_publisher && s.type === 'journal')
        .map(([id, source]) => ({ id, name: source.name || id, issn: source.issn || [], doaj: typeof source.doaj === 'boolean' ? source.doaj : null,
            apc_usd: validNumber(source.apc_usd) ? source.apc_usd : null, works: [] }));
    const byID = new Map(journals.map(j => [j.id, j])), seen = new Set();
    for (const work of works) {
        if (!work.id || seen.has(work.id)) throw new Error('Invalid or duplicate work ID in journal metrics.');
        seen.add(work.id);
        validateCitationYears(work);
        if (work.scopes.includes('published')) byID.get(work.source)?.works.push(work);
    }
    for (const journal of journals) {
        journal.excluded_publication_years = journal.works.filter(w => !Number.isInteger(w.year) || w.year < 1500 || w.year > snapshotYear).length;
        journal.series = citationRatioSeries(journal.works, years, snapshotYear);
        journal.citations = journalCitationHistory(journal.works, snapshotYear, years);
        delete journal.works;
    }
    const defaultYear = snapshotYear - 1;
    journals.sort((a, b) => a.name.localeCompare(b.name, 'id') || a.id.localeCompare(b.id));
    return { schema_version: 1, updated_at: manifest.updated_at, snapshot_year: snapshotYear, years,
        citation_history_from: snapshotYear - 9, citation_history_to: snapshotYear, policy: JOURNAL_METRIC_POLICY,
        defaults: { source: journals[0]?.id || '', year: defaultYear }, journals };
}
// Compact, precomputed data for the embeddable journal widget (one small file per journal).
// `journal` is a finished entry of buildJournalMetrics(); `works` are that journal's published works.
const compact = (value, digits = 4) => validNumber(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
export function journalWidgetData(journal, works, entities, manifest, dataset) {
    const filter = { from: '', to: manifest.default_filter.to, scope: 'published', corpus: 'all', source: journal.id };
    const summary = summarize(works, entities, filter, manifest, [], null, { ratios: false }), k = summary.kpis;
    const currentYear = dataset.snapshot_year, dated = works.filter(w => !growthExclusion(w, currentYear));
    const years = [...new Set(dated.map(w => w.year))].sort((a, b) => a - b);
    const types = summary.top.types.slice(0, 5).map(t => t.id), statuses = summary.top.oa.map(r => r.id);
    // Year rows: [year, total, ...counts per named category]; dates failing the growth policy are left out.
    const perYear = (key, names) => years.map(year => {
        const annual = dated.filter(w => w.year === year);
        return [year, annual.length, ...names.map(name => annual.filter(w => key(w) === name).length)];
    });
    const own = summary.top.journals.find(r => r.id === journal.id) || { count: 0, local: 0 };
    const row = r => ({ year: r.year, value: compact(r.value), numerator: compact(r.numerator), denominator: r.denominator,
        status: r.status, small_base: r.small_base, ...(r.total_documents !== undefined ? { total_documents: r.total_documents, coverage: compact(r.coverage, 2), window_incomplete: r.window_incomplete } : {}),
        ...(r.publication_from !== undefined ? { publication_from: r.publication_from, publication_to: r.publication_to, citation_from: r.citation_from, citation_to: r.citation_to } : {}) });
    return { schema_version: 1, updated_at: manifest.updated_at, snapshot_year: currentYear, default_year: dataset.defaults.year, years: dataset.years,
        institution: { short_name: INSTITUTION.short_name, timezone: INSTITUTION.timezone },
        journal: { id: journal.id, name: journal.name, issn: journal.issn, doaj: journal.doaj ?? null, apc_usd: journal.apc_usd ?? null },
        kpis: { publications: k.publications, citations: k.citations, oa: compact(k.oa, 2), international: compact(k.international, 2),
            fwci: compact(k.fwci), fwci_n: k.fwci_n, fwci_coverage: compact(k.fwci_coverage, 2), top10: k.top10, eligible: k.eligible },
        series: { four_year: journal.series.four_year.map(row), two_year: journal.series.two_year.map(row), fwci: journal.series.fwci.map(row) },
        citations: journal.citations,
        types: { names: types, rows: perYear(w => w.type, types) },
        access: { names: statuses, rows: perYear(w => w.oa_status, statuses) },
        // [ISO code, name, works] for the widget's bubble map; the summary keeps the top 50 countries.
        countries: summary.top.countries.map(r => [r.id, r.name, r.count]),
        origin: { home: own.local, external: own.count - own.local },
        // SDG labels per article ([goal, score|null], highest score first) and unique works per goal for the journal.
        articles: summary.publications.slice(0, 20).map(w => ({ title: w.title, year: w.year, citations: w.citations, doi: w.doi || null, oa: w.oa_status,
            sdgs: (workSdgs(works.find(x => x.id === w.id) || {}) || []).map(g => [g.number, g.score]) })),
        sdgs: summary.top.sdgs.filter(r => /^(?:[1-9]|1[0-7])$/.test(r.id)).map(r => [Number(r.id), r.count]),
        sdg_policy: { classifier: manifest.sdg?.classifier || 'unknown', scores: Boolean(manifest.sdg?.scores) } };
}
// Language codes from OpenAlex (ISO 639-1, e.g. "id") shown as English names ("Indonesian"); the code stays the filter ID.
const LANGUAGES = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch { return null; } })();
export function languageName(code) {
    if (!code || code === 'unknown') return 'Unknown';
    if (!/^[a-z]{2,3}$/i.test(code)) return code;
    try { const name = LANGUAGES?.of(code); return name && name !== code ? name : code; } catch { return code; }
}
// One author's identity (OpenAlex profile, all affiliations) and roles on the given works.
// eligible: the author has an affiliated authorship anywhere in the snapshot (all works), whatever the active filter.
export function authorProfile(works, entities, id, everything = works) {
    const entity = entities.authors[id] || {}, own = works.map(w => w.authors.filter(a => a.id === id)).filter(list => list.length);
    const years = works.map(w => w.year).filter(Number.isInteger);
    return { id, name: entity.name || id, orcid: entity.orcid || null, works: own.length,
        // Any author with an OpenAlex ID who appears in the snapshot has a profile; affiliation is context, not a gate.
        eligible: everything.some(w => w.authors.some(a => a.id === id)),
        home_works: own.filter(list => list.some(a => a.home)).length,
        first_author: own.filter(list => list.some(a => a.position === 'first')).length,
        last_author: own.filter(list => list.some(a => a.position === 'last')).length,
        corresponding: own.filter(list => list.some(a => a.corresponding)).length,
        first_year: years.length ? Math.min(...years) : null, last_year: years.length ? Math.max(...years) : null,
        career: { works: entity.career_works ?? null, citations: entity.career_citations ?? null,
            h_index: entity.career_stats?.h_index ?? null, i10_index: entity.career_stats?.i10_index ?? null } };
}
// Recap across all mapped journals: an unweighted mean of journal values plus a pooled ratio of summed parts.
export function journalRecap(dataset, year) {
    const result = { year, journals: dataset.journals.length };
    for (const kind of ['four_year', 'two_year', 'fwci']) {
        const rows = dataset.journals.map(j => j.series[kind]?.find(r => r.year === year)).filter(Boolean);
        const values = rows.map(r => r.value).filter(validNumber).sort((a, b) => a - b);
        const numerator = rows.reduce((n, r) => n + r.numerator, 0), denominator = rows.reduce((n, r) => n + r.denominator, 0);
        const middle = Math.floor(values.length / 2);
        result[kind] = { mean: values.length ? values.reduce((n, v) => n + v, 0) / values.length : null,
            median: values.length ? values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2 : null,
            journals_with_value: values.length, numerator, denominator, pooled: denominator ? numerator / denominator : null,
            status: !values.length ? 'unavailable' : rows.some(r => r.status === 'provisional') ? 'provisional' : 'complete' };
        if (kind === 'fwci') {
            const total = rows.reduce((n, r) => n + r.total_documents, 0);
            Object.assign(result[kind], { total_documents: total, coverage: total ? denominator / total * 100 : null });
        }
    }
    return result;
}
export const percentage = (a, b) => b ? a / b * 100 : null;
export function csvCell(value) {
    let text = String(value ?? '');
    if (/^\s*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
}
export function historyWeek(value) {
    const date = new Date(value.slice(0, 10) + 'T00:00:00Z');
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const year = date.getUTCFullYear(), start = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil((((date - start) / 86400000) + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
}
export function median(values) {
    if (!values.length)
        return null;
    const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function hIndex(values) {
    const sorted = [...values].sort((a, b) => b - a);
    return sorted.reduce((h, value, index) => value >= index + 1 ? index + 1 : h, 0);
}
export const institutionIDs = work => [...new Set(work.authors.flatMap(a => a.institutions))];
export function auditFlags(work, year) {
    return {
        doi: !work.doi, abstract: !work.abstract, source: !work.source,
        field: !work.field, funder: !work.funders.length,
        affiliation: work.unmatched_affiliation || !work.authors.some(a => a.institutions.length) || work.scopes.includes('affiliated') && !work.authors.some(a=>a.home),
        author_id: work.authors.some(a=>!a.id),
        date: !validNumber(work.year) || work.year < 1900 || work.year > year,
        retracted: work.retracted,
    };
}
export function matches(work, filter, entities, year = new Date().getFullYear()) {
    if (filter.metricKind) {
        if (!citationMetricMember(work, entities, filter, year)) return false;
        // Journal drills have a fixed full-journal scope; other drills keep the active filter except its period.
        filter = filter.journal ? { scope: 'published', corpus: 'all', q: filter.q } : withoutPeriod(filter);
    }
    const scopes = work.scopes || [];
    const scope = filter.scope || 'affiliated';
    if (scope === 'all' ? !scopes.some(s => INSTITUTION_SCOPES.includes(s)) : !scopes.includes(scope))
        return false;
    if ((filter.corpus || 'core') === 'core' && work.xpac)
        return false;
    if (filter.dateQuality === 'valid' && growthExclusion(work, year))
        return false;
    if (filter.fwciQuality === 'valid' && (growthExclusion(work, year) || !validNumber(work.fwci) || work.fwci < 0))
        return false;
    if (filter.from && (!validNumber(work.year) || work.year < Number(filter.from)))
        return false;
    if (filter.to && (!validNumber(work.year) || work.year > Number(filter.to)))
        return false;
    if (filter.type && work.type !== filter.type)
        return false;
    if (filter.language && work.language !== filter.language)
        return false;
    if (filter.license && !work.locations.some(l => (l.license || 'unknown') === filter.license))
        return false;
    if ((filter.version || filter.locationType) && !work.locations.some(l => (!filter.version || (l.version || 'unknown') === filter.version) && (!filter.locationType || (entities.sources[l.source]?.type || 'unknown') === filter.locationType)))
        return false;
    if (filter.field && (work.field || 'unknown') !== filter.field)
        return false;
    if (filter.topic && !(work.topics?.length ? work.topics : [work.topic || 'unknown']).includes(filter.topic))
        return false;
    if (filter.oa && (filter.oa === 'open' ? !work.oa : filter.oa === 'closed' ? work.oa : work.oa_status !== filter.oa))
        return false;
    if (filter.author && !work.authors.some(a => a.id === filter.author && (filter.scope !== 'affiliated' || a.home)))
        return false;
    if (filter.partner && !institutionIDs(work).includes(filter.partner))
        return false;
    if (filter.country && !work.countries.includes(filter.country))
        return false;
    if (filter.funder && !work.funders.includes(filter.funder))
        return false;
    if (filter.award && !work.awards.includes(filter.award))
        return false;
    if (filter.local === 'yes' && !work.authors.some(a => a.home))
        return false;
    if (filter.local === 'no' && work.authors.some(a => a.home))
        return false;
    if (filter.source && (work.source || 'unknown') !== filter.source)
        return false;
    if (filter.sdg && !work.sdgs.includes(String(filter.sdg)))
        return false;
    if (filter.design && !work.designs.includes(filter.design))
        return false;
    if (filter.bin !== undefined && filter.bin !== '') {
        const bin = BINS[Number(filter.bin)];
        if (!bin || work.citations < bin[0] || work.citations > bin[1])
            return false;
    }
    if (filter.audit && !auditFlags(work, year)[filter.audit])
        return false;
    if (filter.metric === 'oa' && !work.oa)
        return false;
    if (filter.metric === 'international' && (work.country_count ?? work.countries.length) < 2)
        return false;
    if (filter.metric === 'fwci' && !validNumber(work.fwci))
        return false;
    if (['top10', 'top1'].includes(filter.metric) && (!validNumber(work.percentile?.value) || typeof work.percentile?.is_in_top_10_percent !== 'boolean' || work.percentile[filter.metric === 'top10' ? 'is_in_top_10_percent' : 'is_in_top_1_percent'] !== true))
        return false;
    if (filter.q) {
        const names = work.authors.map(a => entities.authors[a.id]?.name || a.name || a.id);
        const text = [work.title, work.doi, work.id, ...names].join(' ').toLocaleLowerCase('id');
        if (!text.includes(filter.q.toLocaleLowerCase('id')))
            return false;
    }
    return true;
}
export function withoutPeriod(filter) {
    const { from, to, metricKind, metricPart, metricYear, journal, ...rest } = filter;
    return rest;
}
export function filteredWorks(works, filter, entities, year) {
    return works.filter(work => matches(work, filter, entities, year));
}
export function annualFWCI(yearRows, from, to) {
    const byYear = new Map(yearRows.map(row => [Number(row.id), row]));
    const available = [...byYear.keys()].filter(Number.isInteger);
    const first = Number(from) || Math.min(...available), last = Number(to) || Math.max(...available);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1500 || last > 2100 || first > last) return [];
    return Array.from({ length: last - first + 1 }, (_, i) => {
        const year = first + i, row = byYear.get(year);
        const count = row?.count || 0, eligible = row?.fwci_n || 0;
        return { id: String(year), year, count, fwci_n: eligible,
            fwci: eligible ? row.fwci_sum / eligible : null, coverage: percentage(eligible, count) };
    });
}
export function publicationGrowth(yearRows, from, to, currentYear) {
    const rows = annualFWCI(yearRows, from, to);
    return rows.map((row, i) => {
        const previous = i ? rows[i - 1].count : null;
        const incomplete = row.year >= currentYear;
        return { id: row.id, year: row.year, count: row.count, previous,
            change: previous === null ? null : row.count - previous,
            growth: !incomplete && previous > 0 ? (row.count - previous) / previous * 100 : null,
            incomplete };
    });
}
// first_year and its source come from the configured institution (founding year; dates before it are anomalies).
export const GROWTH_POLICY = Object.freeze({ version: 1, get first_year() { return INSTITUTION.first_year; }, min_previous: 30,
    excluded_dates: Object.freeze(['1969-12-31', '1970-01-01']),
    get year_source() { return INSTITUTION.first_year_source; } });
export function growthExclusion(work, currentYear) {
    if (!Number.isInteger(work.year)) return 'invalid_year';
    if (work.year < GROWTH_POLICY.first_year) return 'before_institution';
    if (work.year > currentYear) return 'future_year';
    if (GROWTH_POLICY.excluded_dates.includes(work.date)) return 'epoch_date';
    return '';
}
export function normalizedPublicationGrowth(works, yearRows, filter, currentYear) {
    const excluded = { invalid_year: 0, before_institution: 0, future_year: 0, epoch_date: 0 }, counts = new Map();
    for (const work of works) {
        const reason = growthExclusion(work, currentYear);
        if (reason) { excluded[reason]++; continue; }
        counts.set(work.year, (counts.get(work.year) || 0) + 1);
    }
    const raw = publicationGrowth(yearRows, filter.from, filter.to, currentYear);
    const rawByYear = new Map(raw.map(row => [row.year, row]));
    const first = filter.from ? Math.max(GROWTH_POLICY.first_year, Number(filter.from)) : '';
    const last = filter.to ? Math.min(currentYear, Number(filter.to)) : '';
    const cleaned = [...counts].map(([year, count]) => ({ id: String(year), count }));
    const rows = publicationGrowth(cleaned, first, last, currentYear).map(row => {
        const status = row.incomplete ? 'incomplete' : row.previous === null ? 'no_comparison'
            : row.previous === 0 ? 'zero_base' : row.previous < GROWTH_POLICY.min_previous ? 'small_base' : 'valid';
        return { ...row, growth: status === 'valid' ? row.growth : null, status,
            raw_count: rawByYear.get(row.year)?.count || 0, raw_growth: rawByYear.get(row.year)?.growth ?? null };
    });
    const excludedCount = Object.values(excluded).reduce((sum, count) => sum + count, 0);
    return { rows, normalization: { policy: GROWTH_POLICY, excluded, excluded_count: excludedCount,
        input_count: works.length, retained_count: works.length - excludedCount,
        small_base_years: rows.filter(row => row.status === 'small_base').length, raw_rows: raw } };
}
export const FWCI_POLICY = Object.freeze({ version: 1, min_works: 30, date_policy_version: GROWTH_POLICY.version,
    benchmark: 1, source: 'https://help.openalex.org/data/works/citations/' });
export function normalizedAnnualFWCI(works, yearRows, filter, currentYear) {
    const excluded = { invalid_year: 0, before_institution: 0, future_year: 0, epoch_date: 0 }, byYear = new Map();
    let missing = 0, invalid = 0;
    for (const work of works) {
        const reason = growthExclusion(work, currentYear);
        if (reason) { excluded[reason]++; continue; }
        if (!byYear.has(work.year)) byYear.set(work.year, { id: String(work.year), count: 0, fwci_n: 0, fwci_sum: 0 });
        const row = byYear.get(work.year);
        row.count++;
        if (validNumber(work.fwci) && work.fwci >= 0) { row.fwci_n++; row.fwci_sum += work.fwci; }
        else if (work.fwci === null || work.fwci === undefined) missing++;
        else invalid++;
    }
    const first = filter.from ? Math.max(GROWTH_POLICY.first_year, Number(filter.from)) : '';
    const last = filter.to ? Math.min(currentYear, Number(filter.to)) : '';
    const rows = annualFWCI([...byYear.values()], first, last).map(row => ({ ...row,
        observed_fwci: row.fwci, fwci: row.fwci_n >= FWCI_POLICY.min_works ? row.fwci : null,
        status: !row.fwci_n ? 'no_metric' : row.fwci_n < FWCI_POLICY.min_works ? 'small_sample' : 'valid' }));
    const excludedCount = Object.values(excluded).reduce((sum, count) => sum + count, 0);
    return { rows, normalization: { policy: FWCI_POLICY, date_policy: GROWTH_POLICY, excluded, excluded_count: excludedCount,
        input_count: works.length, retained_count: works.length - excludedCount, missing_fwci_count: missing, invalid_fwci_count: invalid,
        small_sample_years: rows.filter(row => row.status === 'small_sample').length,
        raw_rows: annualFWCI(yearRows, filter.from, filter.to) } };
}
export function entityPage(works, entities, filter, manifest, options = {}) {
    if (!['authors', 'partners', 'funders', 'sources'].includes(options.kind))
        throw new Error('Unknown table type.');
    return summarize(works, entities, filter, manifest, [], options);
}
// Institution-level citation indicators for the active filter; the metric year, not the period, sets each window.
export function institutionCitationMetrics(works, entities, filter, currentYear) {
    const base = filteredWorks(works, withoutPeriod(filter), entities, currentYear);
    const years = Array.from({ length: 7 }, (_, i) => currentYear - 6 + i);
    const series = citationRatioSeries(base, years, currentYear, { breakdown: false, fwci: false });
    // FWCI follows the same date checks and minimum base as the FWCI timeline, so both show one number per year.
    const fwciRows = normalizedAnnualFWCI(base, [], {}, currentYear).rows;
    series.fwci = years.map(year => {
        const row = fwciRows.find(r => r.year === year);
        return { year, value: row?.fwci ?? null, observed: row?.observed_fwci ?? null, denominator: row?.fwci_n || 0,
            total_documents: row?.count || 0, coverage: row?.coverage ?? null, status: row?.status || 'no_metric',
            window_incomplete: year + 3 >= currentYear };
    });
    return { years, snapshot_year: currentYear, default_year: currentYear - 1, ...series };
}
export function summarize(works, entities, filter, manifest, history = [], tableOptions = null, { ratios = true } = {}) {
    const currentYear = snapshotYearOf(manifest);
    const selected = filteredWorks(works, filter, entities, currentYear);
    const fields = new Map();
    for (const t of Object.values(entities.topics))
        if (t.field)
            fields.set(t.field, t.field_name || t.field);
    const name = (type, id) => {
        if (type === 'field')
            return fields.get(id) || id || 'Unknown';
        if (type === 'country')
            return entities.countries[id] || id;
        if (type === 'sdg')
            return `SDG ${id} · ${SDGS[Number(id) - 1] || id}`;
        return entities[type]?.[id]?.name || id || 'Unknown';
    };
    const maps = Object.fromEntries(['years', 'types', 'languages', 'fields', 'topics', 'countries', 'partners',
        'sources', 'sdgs', 'funders', 'designs', 'oa', 'authors', 'sectors', 'licenses', 'versions', 'awards'].map(k => [k, new Map()]));
    function add(kind, id, label, work) {
        id = String(id || 'unknown');
        let row = maps[kind].get(id);
        if (!row) {
            row = { id, name: String(label || id), count: 0, citations: 0, oa: 0, years: {}, fwci_sum: 0, fwci_n: 0 };
            maps[kind].set(id, row);
        }
        row.count++;
        row.citations += work.citations;
        row.oa += work.oa ? 1 : 0;
        if (validNumber(work.year))
            row.years[work.year] = (row.years[work.year] || 0) + 1;
        if (validNumber(work.fwci)) {
            row.fwci_sum += work.fwci;
            row.fwci_n++;
        }
        return row;
    }
    const quality = Object.fromEntries(['doi', 'abstract', 'source', 'field', 'funder', 'affiliation', 'author_id', 'date', 'retracted'].map(k => [k, 0]));
    const qualityYears = Object.fromEntries(Object.keys(quality).map(k => [k, {}]));
    const versionLocations = new Map();
    const coverage = { abstract: 0, pdf: 0, xml: 0, repo: 0, any_repo: 0, license: 0, orcid_authors: 0 };
    const citationYears = new Map(), oaYears = new Map(), sdgFields = new Map(), oaFields = new Map();
    let citations = 0, oa = 0, international = 0, fwciSum = 0, fwciN = 0, eligible = 0, top10 = 0, top1 = 0, cited = 0;
    let apcSum = 0, apcN = 0, paidVerified = 0, paidFallback = 0;
    const localRepo = new Set(manifest.institution.repositories || []);
    const localCountries = new Set();
    // Compact author aggregation: [articles, citations, first, last, corresponding, home, orcid]. Rows are only
    // materialized for the 500 ranked authors, so a large portfolio does not pay for a full object per author.
    const authorStats = new Map();
    for (const work of selected) {
        citations += work.citations;
        oa += work.oa ? 1 : 0;
        cited += work.citations > 0 ? 1 : 0;
        const intl = (work.country_count ?? work.countries.length) > 1;
        international += intl ? 1 : 0;
        if (validNumber(work.fwci)) {
            fwciSum += work.fwci;
            fwciN++;
        }
        if (validNumber(work.percentile?.value) && typeof work.percentile?.is_in_top_10_percent === 'boolean') {
            eligible++;
            top10 += work.percentile.is_in_top_10_percent ? 1 : 0;
            top1 += work.percentile.is_in_top_1_percent ? 1 : 0;
        }
        const flags = auditFlags(work, currentYear);
        for (const [key, val] of Object.entries(flags))
            if (val) {
                quality[key]++;
                qualityYears[key][work.year] = (qualityYears[key][work.year] || 0) + 1;
            }
        coverage.abstract += work.abstract ? 1 : 0;
        coverage.pdf += work.content.pdf === true ? 1 : 0;
        coverage.xml += work.content.grobid_xml === true ? 1 : 0;
        coverage.repo += work.locations.some(l => localRepo.has(l.source)) ? 1 : 0;
        coverage.any_repo += work.repository_copy ? 1 : 0;
        coverage.license += work.locations.some(l => !!l.license) ? 1 : 0;
        // Authors are the people who published in the filter, whatever their affiliation. One work counts once per
        // author, and duplicate authorship elements of the same author are merged; a missing OpenAlex ID keeps its
        // role on the work but cannot form a profile.
        const byline = new Map();
        for (const a of work.authors) {
            if (!a.id)
                continue;
            const role = byline.get(a.id);
            if (role) {
                role.first ||= a.position === 'first';
                role.last ||= a.position === 'last';
                role.corresponding ||= a.corresponding === true;
                role.home ||= a.home === true;
            }
            else byline.set(a.id, { first: a.position === 'first', last: a.position === 'last', corresponding: a.corresponding === true, home: a.home === true });
        }
        for (const [id, role] of byline) {
            const row = authorStats.get(id);
            if (row) {
                row[0]++;
                row[1] += work.citations;
                row[2] += role.first ? 1 : 0;
                row[3] += role.last ? 1 : 0;
                row[4] += role.corresponding ? 1 : 0;
                row[5] += role.home ? 1 : 0;
            }
            else authorStats.set(id, [1, work.citations, role.first ? 1 : 0, role.last ? 1 : 0, role.corresponding ? 1 : 0, role.home ? 1 : 0,
                entities.authors[id]?.orcid ? 1 : 0]);
        }
        add('years', work.year || 'unknown', work.year || 'Unknown', work);
        add('types', work.type, work.type, work);
        add('languages', work.language, languageName(work.language), work);
        add('fields', work.field, name('field', work.field), work);
        for (const topic of new Set(work.topics?.length ? work.topics : [work.topic || 'unknown'])) add('topics', topic, name('topics',topic),work);
        add('oa', work.oa_status, work.oa_status, work);
        const sourceRow = add('sources', work.source, name('sources', work.source), work);
        sourceRow.local = (sourceRow.local || 0) + (work.authors.some(a => a.home) ? 1 : 0);
        sourceRow.metadata = entities.sources[work.source] || null;
        for (const id of new Set(work.countries)) {
            localCountries.add(id);
            add('countries', id, name('country', id), work);
        }
        const sectors = new Set();
        for (const id of institutionIDs(work)) {
            if (entities.institutions[id]?.home)
                continue;
            add('partners', id, name('institutions', id), work).metadata = entities.institutions[id] || null;
            sectors.add(entities.institutions[id]?.type || 'unknown');
        }
        for (const sector of sectors)
            add('sectors', sector, sector, work);
        for (const id of new Set(work.sdgs)) {
            add('sdgs', id, name('sdg', id), work);
            const key = `${id}|${work.field || 'unknown'}`;
            sdgFields.set(key, (sdgFields.get(key) || 0) + 1);
        }
        for (const id of new Set(work.funders))
            add('funders', id, name('funders', id), work);
        for (const id of new Set(work.awards))
            add('awards', id, name('awards', id), work);
        for (const id of new Set(work.designs))
            add('designs', id, id.replaceAll('-', ' '), work);
        for (const license of new Set(work.locations.map(l => l.license || 'unknown')))
            add('licenses', license, license, work);
        for (const version of new Set(work.locations.map(l => l.version || 'unknown')))
            add('versions', version, version, work);
        for (const pair of new Set(work.locations.map(l => `${l.version || 'unknown'}|${entities.sources[l.source]?.type || 'unknown'}`)))
            versionLocations.set(pair, (versionLocations.get(pair) || 0) + 1);
        const year = work.year || 'unknown';
        if (!oaYears.has(year))
            oaYears.set(year, { year, total: 0, international: 0, oa: {} });
        const oy = oaYears.get(year);
        oy.total++;
        oy.international += intl ? 1 : 0;
        oy.oa[work.oa_status] = (oy.oa[work.oa_status] || 0) + 1;
        for (const [year, value] of work.citation_years)
            citationYears.set(year, (citationYears.get(year) || 0) + value);
        const of = `${work.field || 'unknown'}|${work.oa_status}`;
        oaFields.set(of, (oaFields.get(of) || 0) + 1);
        if (validNumber(work.apc_list?.value_usd)) {
            apcSum += work.apc_list.value_usd;
            apcN++;
        }
        if (work.apc_paid)
            work.apc_paid.provenance === 'openapc' ? paidVerified++ : paidFallback++;
    }
    // Author totals stay compact; only the ranked 500 become table rows, and years are added for the top 10 below.
    const authorTotal = authorStats.size;
    let firstAuthorCount = 0, correspondingAuthorCount = 0, orcidAuthors = 0;
    for (const row of authorStats.values()) {
        if (row[2]) firstAuthorCount++;
        if (row[4]) correspondingAuthorCount++;
        if (row[6]) orcidAuthors++;
    }
    coverage.orcid_authors = orcidAuthors;
    // Rank the compact entries first; only the 500 published rows become objects. Ties fall back to the ID so the
    // 500-row boundary is deterministic without materializing every author.
    const authorRows = [...authorStats].sort((a, b) => b[1][0] - a[1][0] || a[0].localeCompare(b[0])).slice(0, 500)
        .map(([id, row]) => ({ id, name: name('authors', id), count: row[0], citations: row[1],
            first: row[2], last: row[3], corresponding: row[4], home_works: row[5], orcid: Boolean(row[6]),
            career_works: entities.authors[id]?.career_works ?? null, career_citations: entities.authors[id]?.career_citations ?? null, years: {} }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    for (const row of authorRows) maps.authors.set(row.id, row);
    const sorted = kind => [...maps[kind].values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    if (tableOptions) {
        const all = sorted(tableOptions.kind), limit = tableOptions.kind === 'authors' ? 500 : null;
        const ranked = (limit ? all.slice(0, limit) : all).map((row, i) => ({ ...row, rank: i + 1 }));
        const search = String(tableOptions.search || '').trim().toLocaleLowerCase('id-ID');
        const rows = search ? ranked.filter(row => `${row.name} ${row.id}`.toLocaleLowerCase('id-ID').includes(search)) : ranked;
        const pageSize = tableOptions.pageSize === 'all' ? Math.max(rows.length, 1) : 50, page = Math.max(0, Math.min(Math.floor(Number(tableOptions.page) || 0), Math.max(0, Math.ceil(rows.length / pageSize) - 1)));
        return { rows: rows.slice(page * pageSize, (page + 1) * pageSize), total: rows.length,
            eligible: tableOptions.kind === 'authors' ? authorTotal : all.length, limit, page, page_size: pageSize };
    }
    const top = Object.fromEntries(Object.keys(maps).map(k => [k, sorted(k).slice(0, k === 'sdgs' ? 17 : 50)]));
    top.journals = sorted('sources').filter(row => row.metadata?.type === 'journal').slice(0, 10);
    top.years = [...maps.years.values()].sort((a, b) => Number(a.id) - Number(b.id));
    // Per-year lines are drawn for the top 10 authors only, so their years are counted in a second pass.
    const topAuthorIds = new Set(top.authors.slice(0, 10).map(row => row.id));
    if (topAuthorIds.size) {
        const yearsById = new Map();
        for (const work of selected) {
            if (!validNumber(work.year))
                continue;
            const seen = new Set();
            for (const a of work.authors) {
                if (!a.id || !topAuthorIds.has(a.id) || seen.has(a.id))
                    continue;
                seen.add(a.id);
                if (!yearsById.has(a.id))
                    yearsById.set(a.id, {});
                const row = yearsById.get(a.id);
                row[work.year] = (row[work.year] || 0) + 1;
            }
        }
        for (const row of top.authors.slice(0, 10)) row.years = yearsById.get(row.id) || {};
    }
    const completeYear = Math.min(Number(filter.to) || currentYear - 1, currentYear - 1);
    const last = maps.years.get(String(completeYear))?.count || 0, prior = maps.years.get(String(completeYear - 1))?.count || 0;
    const publicationRows = [...selected].sort((a, b) => b.citations - a.citations || String(b.date).localeCompare(String(a.date))).slice(0, 50).map(w => ({
        id: w.id, title: w.title, doi: w.doi, year: w.year, citations: w.citations, oa_status: w.oa_status,
        source_name: name('sources', w.source), scope: w.scopes, retracted: w.retracted,
        journal_citations: filter.metricKind ? journalContribution(w, filter.metricKind, Number(filter.metricYear)) : undefined,
    }));
    const histogram = BINS.map(([min, max, label], index) => ({ id: String(index), name: label, count: selected.filter(w => w.citations >= min && w.citations <= max).length }));
    const networks = makeNetworks(selected, entities, top.partners, top.funders);
    const fieldNames = Object.fromEntries(fields);
    const topicCandidates = filter.topic ? filteredWorks(works, { ...filter, topic: '' }, entities, currentYear) : selected;
    const allTopics = [...new Map(topicCandidates.flatMap(w=>(w.topics?.length?w.topics:[w.topic]).filter(Boolean).map(id=>[id,{id,name:name('topics',id),field:entities.topics[id]?.field,subfield:entities.topics[id]?.subfield}]))).values()];
    const growth = normalizedPublicationGrowth(selected, top.years, filter, currentYear);
    const fwci = normalizedAnnualFWCI(selected, top.years, filter, currentYear);
    return { filter, total: selected.length, kpis: { publications: selected.length, citations, oa: percentage(oa, selected.length),
            international: percentage(international, selected.length), fwci: fwciN ? fwciSum / fwciN : null,
            fwci_n: fwciN, fwci_coverage: percentage(fwciN, selected.length), top10, top1, eligible,
            top10_share: percentage(top10, eligible), percentile_coverage: percentage(eligible, selected.length),
            cited_share: percentage(cited, selected.length), median_citations: median(selected.map(w => w.citations)),
            h_index: hIndex(selected.map(w => w.citations)), authors: authorTotal,
            partners: maps.partners.size, countries: localCountries.size, growth: prior ? (last - prior) / prior * 100 : null,
            field_concentration: selected.length ? [...maps.fields.values()].reduce((n, r) => n + (r.count / selected.length) ** 2, 0) : null,
            top3_fields_share: percentage(sorted('fields').slice(0, 3).reduce((n, r) => n + r.count, 0), selected.length),
            growth_year: completeYear, first: firstAuthorCount, corresponding: correspondingAuthorCount, apc_mean: apcN ? apcSum / apcN : null, apc_n: apcN, paid_verified: paidVerified, paid_fallback: paidFallback },
        top, annual_fwci: annualFWCI(top.years, filter.from, filter.to),
        publication_growth: growth.rows, growth_normalization: growth.normalization, histogram, quality, quality_years: qualityYears, coverage,
        fwci_timeline: fwci.rows, fwci_normalization: fwci.normalization,
        country_map: sorted('countries').map(({ id, name, count, citations }) => ({ id, name, count, citations })),
        version_locations: [...versionLocations].map(([key, count]) => { const [version, type] = key.split('|'); return { version, type, count }; }),
        citation_years: [...citationYears].sort((a, b) => a[0] - b[0]),
        oa_years: [...oaYears.values()].sort((a, b) => a.year - b.year),
        sdg_fields: [...sdgFields].map(([key, count]) => { const [sdg, field] = key.split('|'); return { sdg, field, name: fieldNames[field] || field, count }; }),
        oa_fields: [...oaFields].map(([key, count]) => { const [field, oa] = key.split('|'); return { field, oa, name: fieldNames[field] || field, count }; }),
        scatter: [...selected].sort((a, b) => b.citations - a.citations).slice(0, 250).map(w => ({ id: w.id, title: w.title, age: currentYear - (w.year || currentYear), citations: w.citations, fwci: w.fwci })),
        publications: publicationRows, networks,
        facets: { fields: [...fields].map(([id, name]) => ({ id, name })), topics: allTopics,
            types: sorted('types').map(({ id, name }) => ({ id, name })) },
        history: history.slice(-12), current_year: currentYear,
        // Author profile page: identity and the author's own authorship roles within the selected works.
        ...(filter.author ? { author_profile: authorProfile(selected, entities, filter.author, works) } : {}),
        citation_ratios: ratios ? institutionCitationMetrics(works, entities, filter, currentYear) : null,
        // A citation-ratio drill reports the numerator/denominator of the same filter it lists.
        metric_row: filter.metricKind && !filter.journal && filter.metricKind !== 'fwci'
            ? citationRatioSeries(filteredWorks(works, withoutPeriod(filter), entities, currentYear), [Number(filter.metricYear)], currentYear, { breakdown: false, fwci: false })[filter.metricKind][0] : null,
        audit_candidates: works.filter(w => w.scopes.includes('audit') && !w.scopes.includes('affiliated') &&
            (!filter.from || w.year >= Number(filter.from)) && (!filter.to || w.year <= Number(filter.to)) &&
            (filter.corpus !== 'core' || !w.xpac)).slice(0, 50).map(w => ({ id: w.id, title: w.title, year: w.year, doi: w.doi })),
    };
}
function makeNetworks(works, entities, partnerRows, funderRows) {
    const partnerIDs = new Set(partnerRows.slice(0, 25).map(r => r.id)), partnerEdges = new Map();
    const funderIDs = new Set(funderRows.slice(0, 15).map(r => r.id)), fundingEdges = new Map(), centerCounts = new Map();
    const addEdge = (map, a, b) => { const key = [a, b].sort().join('|'); map.set(key, (map.get(key) || 0) + 1); };
    for (const w of works) {
        const ids = institutionIDs(w).filter(id => partnerIDs.has(id));
        if (w.authors.some(a => a.home))
            for (const id of ids)
                centerCounts.set(id, (centerCounts.get(id) || 0) + 1);
        for (let i = 0; i < ids.length; i++)
            for (let j = i + 1; j < ids.length; j++)
                addEdge(partnerEdges, ids[i], ids[j]);
        for (const f of new Set(w.funders.filter(id => funderIDs.has(id))))
            if (w.topic)
                addEdge(fundingEdges, f, w.topic);
    }
    const nodes = partnerRows.slice(0, 25).map(r => ({ id: r.id, name: r.name, count: r.count }));
    const edgeList = map => [...map].sort((a, b) => b[1] - a[1]).slice(0, 150).map(([key, count]) => { const [source, target] = key.split('|'); return { source, target, count }; });
    // The institution is the centre; every partner edge is an observed shared-work relation.
    const centerWorks = works.filter(w => w.authors.some(a => a.home)).length;
    const partners = { nodes: [...(centerWorks ? [{ id: INSTITUTION.id, name: INSTITUTION.name, count: centerWorks }] : []), ...nodes],
        edges: [...[...centerCounts].map(([id, count]) => ({ source: INSTITUTION.id, target: id, count })), ...edgeList(partnerEdges)].slice(0, 150) };
    const topWorks = [...works].sort((a, b) => b.citations - a.citations).slice(0, 40), ids = new Set(topWorks.map(w => w.id));
    const citationEdges = [], coupling = new Map(), coCitation = new Map();
    const nodesWorks = topWorks.map(w => ({ id: w.id, name: w.title, count: w.citations }));
    for (const w of works)
        for (const ref of new Set(w.references))
            if (ids.has(w.id) && ids.has(ref) && ref !== w.id)
                citationEdges.push({ source: w.id, target: ref, count: 1 });
    const refs = topWorks.map(w => new Set(w.references));
    for (let i = 0; i < topWorks.length; i++)
        for (let j = i + 1; j < topWorks.length; j++) {
            const shared = [...refs[i]].filter(id => refs[j].has(id)).length;
            if (shared)
                coupling.set(`${topWorks[i].id}|${topWorks[j].id}`, shared);
        }
    for (const w of works) {
        const refs = [...new Set(w.references.filter(id => ids.has(id)))];
        for (let i = 0; i < refs.length; i++)
            for (let j = i + 1; j < refs.length; j++)
                addEdge(coCitation, refs[i], refs[j]);
    }
    const fEdges = edgeList(fundingEdges), fIds = [...new Set(fEdges.flatMap(e => [e.source, e.target]))].slice(0, 40);
    const funding = { nodes: fIds.map(id => ({ id, name: entities.funders[id]?.name || entities.topics[id]?.name || id, count: funderRows.find(r => r.id === id)?.count || 1 })), edges: fEdges.filter(e => fIds.includes(e.source) && fIds.includes(e.target)) };
    return { partners, funding, citations: { nodes: nodesWorks, edges: citationEdges.slice(0, 150) },
        coupling: { nodes: nodesWorks, edges: edgeList(coupling) }, cocitation: { nodes: nodesWorks, edges: edgeList(coCitation) } };
}
export function publicationPage(works, entities, filter, options = {}) {
    const selected = filteredWorks(works, filter, entities, options.snapshotYear);
    const sort = options.sort || 'citations';
    selected.sort((a, b) => sort === 'year' ? (b.year || 0) - (a.year || 0) : sort === 'title' ? a.title.localeCompare(b.title) : b.citations - a.citations);
    const start = Math.max(0, Number(options.page || 0)) * 50;
    return { total: selected.length, rows: selected.slice(start, start + 50).map(w => ({ ...w, source_name: entities.sources[w.source]?.name || 'Unknown',
        journal_citations: filter.metricKind ? journalContribution(w, filter.metricKind, Number(filter.metricYear)) : undefined })) };
}
