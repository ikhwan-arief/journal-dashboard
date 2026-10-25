/*! Copyright (c) 2026 Ikhwan Arief (ikhwan[at]eng.unand.ac.id). All rights reserved.
 * Licensed under the PolyForm Noncommercial License 1.0.0
 * (https://polyformproject.org/licenses/noncommercial/1.0.0). Commercial use requires prior
 * written permission from the copyright holder. See LICENSE and NOTICE. */
import { summarize, publicationPage, entityPage, filteredWorks, journalWindow, snapshotYearOf, configureInstitution } from './metrics.js';
let works = [], entities = {}, manifest, history = [], loadedKey = '';
async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error('The snapshot could not be read. Please try again.');
    return response.json();
}
async function handle({ data }) {
    const { id, action, filter, options } = data;
    try {
        if (!manifest) {
            manifest = data.manifest;
            configureInstitution(manifest.institution);
            history = data.history || [];
            entities = await getJSON(new URL('../data/entities.json', import.meta.url));
        }
        // Read years that are actually needed. Additional scopes share deduplicated records.
        const snapshotYear = snapshotYearOf(manifest);
        const metricWindow = filter.metricKind ? journalWindow(filter.metricKind, Number(filter.metricYear)) : null;
        // Citation ratios ignore the period, so their ten-year citation history is loaded alongside it.
        const ratios = !filter.metricKind && (Boolean(options?.ratios) || !filter.from && !filter.to);
        const inPeriod = f => !filter.from && !filter.to || Number(f.year) >= Number(filter.from || 0) && Number(f.year) <= Number(filter.to || 9999);
        const files = manifest.files.works.filter(f => metricWindow
            ? Number(f.year) >= metricWindow.publication_from && Number(f.year) <= metricWindow.publication_to
            : inPeriod(f) || ratios && Number(f.year) >= snapshotYear - 9 && Number(f.year) <= snapshotYear);
        const key = files.map(f => f.path).join('|');
        if (key !== loadedKey) {
            const rows = [];
            for (let i = 0; i < files.length; i += 3) {
                const batch = await Promise.all(files.slice(i, i + 3).map(f => getJSON(new URL('../' + f.path, import.meta.url))));
                rows.push(...batch.flat());
            }
            works = rows;
            loadedKey = key;
        }
        let result;
        if (action === 'summary')
            result = summarize(works, entities, filter, manifest, history, null, { ratios });
        else if (action === 'page')
            result = publicationPage(works, entities, filter, { ...options, snapshotYear });
        else if (action === 'entities')
            result = entityPage(works, entities, filter, manifest, options);
        else if (action === 'detail') {
            const w = works.find(w => w.id === options.id);
            result = w ? { ...w, author_names: w.authors.map(a => ({ ...a, ...entities.authors[a.id], institution_names: a.institutions.map(id => entities.institutions[id]?.name || id) })),
                source_name: entities.sources[w.source]?.name, source_details: entities.sources[w.source], topic_name: entities.topics[w.topic]?.name,
                funding: w.funders.map(id => entities.funders[id]), award_details: w.awards.map(id => entities.awards[id]) } : null;
        }
        else if (action === 'export')
            result = filteredWorks(works, filter, entities, snapshotYear).map(w => options.format==='json'?{
                ...w,author_details:w.authors.map(a=>({...a,...entities.authors[a.id]})),
                source_details:entities.sources[w.source],funder_details:w.funders.map(id=>entities.funders[id]),
                topic_details:w.topics.map(id=>entities.topics[id]),
                institution_details:Object.fromEntries([...new Set(w.authors.flatMap(a=>a.institutions))].map(id=>[id,entities.institutions[id]])),
                retrieved_at:manifest.updated_at,
            }:({
                id: w.id, doi: w.doi, title: w.title, year: w.year, type: w.type, language: w.language,
                citations: w.citations, fwci: w.fwci, oa: w.oa, oa_status: w.oa_status,
                authors: w.authors.map(a => entities.authors[a.id]?.name || a.name || 'Unidentified author').join('; '),
                source: entities.sources[w.source]?.name, sdgs: w.sdgs.join('; '),
                funders: w.funders.map(id => entities.funders[id]?.name || id).join('; '),
                scopes: w.scopes.join('; '), retrieved_at: manifest.updated_at,
                corpus: filter.corpus, ror: manifest.institution.ror, filter: JSON.stringify(filter),
            }));
        self.postMessage({ id, result });
    }
    catch (error) {
        self.postMessage({ id, error: error.message });
    }
}
let queue = Promise.resolve();
self.onmessage = event => { queue = queue.then(() => handle(event)); };
