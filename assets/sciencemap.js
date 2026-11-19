/*! Copyright (c) 2026 Ikhwan Arief (ikhwan[at]eng.unand.ac.id). All rights reserved.
 * Licensed under the PolyForm Noncommercial License 1.0.0
 * (https://polyformproject.org/licenses/noncommercial/1.0.0). Commercial use requires prior
 * written permission from the copyright holder. See LICENSE and NOTICE. */
// Citation maps in the manner of VOSviewer: association-strength normalisation, modularity clustering and the VOS layout.
// Everything is deterministic, so the same snapshot and settings always give the same map.
export const MAP_LIMITS = { nodes: 300, edges: 3000, commonReference: 500, cocitationPairs: 20000, minClusterSize: 3 };
export const MAP_KINDS = ['coupling', 'direct', 'cocitation'];
const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
const add = (map, a, b, n = 1) => { if (a !== b) { const key = pairKey(a, b); map.set(key, (map.get(key) || 0) + n); } };

// Raw link counts between works. coupling: shared references; direct: one cites the other; cocitation: cited together.
// External co-citation pairs ([a, b, count], from all citing works) replace the in-snapshot count when available.
export function rawLinks(kind, works, ids, cocitationPairs = null) {
    const links = new Map();
    if (kind === 'coupling') {
        const citers = new Map();
        for (const w of works) if (ids.has(w.id))
            for (const ref of new Set(w.references || [])) { if (!citers.has(ref)) citers.set(ref, []); citers.get(ref).push(w.id); }
        // A reference shared by hundreds of works (a handbook, a standard) carries little structure and costs quadratic time.
        for (const list of citers.values()) if (list.length > 1 && list.length <= MAP_LIMITS.commonReference)
            for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(links, list[i], list[j]);
    } else if (kind === 'direct') {
        for (const w of works) if (ids.has(w.id))
            for (const ref of new Set(w.references || [])) if (ids.has(ref)) add(links, w.id, ref);
    } else if (kind === 'cocitation') {
        if (cocitationPairs) { for (const [a, b, n] of cocitationPairs) if (ids.has(a) && ids.has(b)) add(links, a, b, n); }
        else for (const w of works) {
            const refs = [...new Set((w.references || []).filter(id => ids.has(id)))];
            for (let i = 0; i < refs.length; i++) for (let j = i + 1; j < refs.length; j++) add(links, refs[i], refs[j]);
        }
    } else throw new Error(`Unknown map type "${kind}".`);
    return links;
}

// Association strength s_ij = 2m·a_ij / (k_i·k_j), with k the total link strength and m the total of all links.
export function associationStrength(links) {
    const total = new Map(); let m = 0;
    for (const [key, n] of links) { const [a, b] = key.split('|'); total.set(a, (total.get(a) || 0) + n); total.set(b, (total.get(b) || 0) + n); m += n; }
    const out = new Map();
    for (const [key, n] of links) { const [a, b] = key.split('|'); out.set(key, 2 * m * n / (total.get(a) * total.get(b))); }
    return { strength: out, total };
}

// Louvain modularity clustering on a weighted graph given as n nodes and [i, j, w] edges; returns a cluster index per node.
export function louvain(n, edges, resolution = 1) {
    let community = Array.from({ length: n }, (_, i) => i), nodes = n, graph = edges.map(e => [...e]);
    const assignment = Array.from({ length: n }, (_, i) => i);
    for (let level = 0; level < 20; level++) {
        const adj = Array.from({ length: nodes }, () => new Map()), degree = new Float64Array(nodes); let m2 = 0;
        for (const [i, j, w] of graph) {
            adj[i].set(j, (adj[i].get(j) || 0) + w); if (i !== j) adj[j].set(i, (adj[j].get(i) || 0) + w);
            degree[i] += w; degree[j] += w; m2 += 2 * w;
        }
        if (!m2) break;
        community = Array.from({ length: nodes }, (_, i) => i);
        const tot = Float64Array.from(degree);
        let moved = true, any = false, rounds = 0;
        while (moved && rounds++ < 50) {
            moved = false;
            for (let i = 0; i < nodes; i++) {
                const own = community[i], weights = new Map();
                for (const [j, w] of adj[i]) if (j !== i) weights.set(community[j], (weights.get(community[j]) || 0) + w);
                tot[own] -= degree[i];
                let best = own, gain = (weights.get(own) || 0) - resolution * tot[own] * degree[i] / m2;
                for (const [c, w] of [...weights].sort((a, b) => a[0] - b[0])) {
                    const g = w - resolution * tot[c] * degree[i] / m2;
                    if (g > gain + 1e-12) { gain = g; best = c; }
                }
                tot[best] += degree[i];
                if (best !== own) { community[i] = best; moved = true; any = true; }
            }
        }
        const renumber = new Map(); community = community.map(c => { if (!renumber.has(c)) renumber.set(c, renumber.size); return renumber.get(c); });
        for (let v = 0; v < n; v++) assignment[v] = community[assignment[v]];
        if (!any || renumber.size === nodes) break;
        const merged = new Map();
        for (const [i, j, w] of graph) { const a = community[i], b = community[j], key = a <= b ? `${a}|${b}` : `${b}|${a}`; merged.set(key, (merged.get(key) || 0) + w); }
        graph = [...merged].map(([key, w]) => { const [a, b] = key.split('|').map(Number); return [a, b, w]; });
        nodes = renumber.size;
    }
    return assignment;
}

// Small deterministic generator for the starting layout.
function random(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// VOS layout: minimise Σ s_ij·d_ij² − Σ d_ij over all pairs (attraction by similarity, uniform repulsion), then centre and scale to mean distance 1.
export function vosLayout(n, edges, { iterations = 600, seed = 1 } = {}) {
    const rnd = random(seed), x = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = rnd() * 2 - 1; y[i] = rnd() * 2 - 1; }
    if (n < 2) return Array.from({ length: n }, () => [0, 0]);
    let step = 1;
    for (let it = 0; it < iterations; it++) {
        const gx = new Float64Array(n), gy = new Float64Array(n);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            const dx = x[i] - x[j], dy = y[i] - y[j], d = Math.hypot(dx, dy) || 1e-9;
            gx[i] -= dx / d; gy[i] -= dy / d; gx[j] += dx / d; gy[j] += dy / d;
        }
        for (const [i, j, s] of edges) { const dx = x[i] - x[j], dy = y[i] - y[j]; gx[i] += 2 * s * dx; gy[i] += 2 * s * dy; gx[j] -= 2 * s * dx; gy[j] -= 2 * s * dy; }
        let norm = 0; for (let i = 0; i < n; i++) norm = Math.max(norm, Math.hypot(gx[i], gy[i]));
        if (!norm) break;
        for (let i = 0; i < n; i++) { x[i] -= step * gx[i] / norm; y[i] -= step * gy[i] / norm; }
        step *= 0.985;
    }
    const cx = x.reduce((a, b) => a + b, 0) / n, cy = y.reduce((a, b) => a + b, 0) / n;
    let mean = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) mean += Math.hypot(x[i] - x[j], y[i] - y[j]);
    mean /= n * (n - 1) / 2 || 1;
    return Array.from({ length: n }, (_, i) => [(x[i] - cx) / mean, (y[i] - cy) / mean]);
}

// Shared core: keep the chosen nodes, map only the largest connected set (VOSviewer's default), normalise, cluster and lay out.
function mapCore(chosen, links) {
    const keep = new Set(chosen), kept = new Map([...links].filter(([key]) => { const [a, b] = key.split('|'); return keep.has(a) && keep.has(b); }));
    const adjacency = new Map();
    for (const key of kept.keys()) { const [a, b] = key.split('|'); for (const [u, v] of [[a, b], [b, a]]) { if (!adjacency.has(u)) adjacency.set(u, []); adjacency.get(u).push(v); } }
    let largest = new Set();
    const seen = new Set();
    for (const start of chosen) if (adjacency.has(start) && !seen.has(start)) {
        const component = new Set([start]), queue = [start]; seen.add(start);
        while (queue.length) for (const v of adjacency.get(queue.pop())) if (!seen.has(v)) { seen.add(v); component.add(v); queue.push(v); }
        if (component.size > largest.size) largest = component;
    }
    for (const key of [...kept.keys()]) if (!largest.has(key.split('|')[0])) kept.delete(key);
    const ids = chosen.filter(id => largest.has(id)), index = new Map(ids.map((id, i) => [id, i]));
    const counts = { selected: adjacency.size, outside_largest_set: adjacency.size - ids.length };
    if (ids.length < 2) return { ids: [], counts };
    const { strength } = associationStrength(kept);
    const edges = [...kept].map(([key, n]) => { const [a, b] = key.split('|'); return [index.get(a), index.get(b), strength.get(key), n]; });
    const raw = louvain(ids.length, edges.map(([i, j, s]) => [i, j, s]));
    // Clusters are numbered by size as in VOSviewer; clusters smaller than the minimum share cluster 0 ("other").
    const sizes = new Map(); for (const c of raw) sizes.set(c, (sizes.get(c) || 0) + 1);
    const order = [...sizes].filter(([, s]) => s >= MAP_LIMITS.minClusterSize).sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c]) => c);
    const clusterOf = raw.map(c => order.indexOf(c) + 1);
    const xy = vosLayout(ids.length, edges.map(([i, j, s]) => [i, j, s]));
    const degree = new Map(), strengthOf = new Map();
    for (const [i, j, , n] of edges) for (const v of [i, j]) { degree.set(v, (degree.get(v) || 0) + 1); strengthOf.set(v, (strengthOf.get(v) || 0) + n); }
    const shown = [...edges].sort((a, b) => b[2] - a[2] || b[3] - a[3]).slice(0, MAP_LIMITS.edges).map(([i, j, s, n]) => ({ source: ids[i], target: ids[j], strength: n, association: s }));
    const place = (id, i) => ({ id, x: Math.round(xy[i][0] * 1e4) / 1e4, y: Math.round(xy[i][1] * 1e4) / 1e4, cluster: clusterOf[i], links: degree.get(i) || 0, strength: strengthOf.get(i) || 0 });
    return { ids, place, shown, total_links: edges.length, counts };
}
// Most frequent value of a node property inside a cluster (ties: smallest value), used to name clusters.
function clusterSummary(nodes, key) {
    return [...new Set(nodes.map(n => n.cluster))].sort((a, b) => a - b).map(c => {
        const members = nodes.filter(n => n.cluster === c), counts = new Map();
        for (const n of members) if (n[key]) counts.set(n[key], (counts.get(n[key]) || 0) + 1);
        const top = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] || null;
        const lead = [...members].sort((a, b) => (b.weight || 0) - (a.weight || 0) || (a.id < b.id ? -1 : 1))[0];
        return { id: c, size: members.length, [key]: top, lead: lead?.label || null, citations: members.reduce((s, n) => s + (n.citations || 0), 0), weight: members.reduce((s, n) => s + (n.weight || 0), 0) };
    });
}

// Citation map of works: pick the most strongly linked works, normalise, cluster and lay out. label(work) comes from the caller.
export function buildScienceMap(works, kind, { pool = works, minCitations = 0, maxNodes = MAP_LIMITS.nodes, cocitationPairs = null, label = w => w.id } = {}) {
    maxNodes = Math.max(10, Math.min(MAP_LIMITS.nodes, Number(maxNodes) || MAP_LIMITS.nodes));
    const candidates = pool.filter(w => (w.citations || 0) >= Number(minCitations || 0)), byId = new Map(candidates.map(w => [w.id, w]));
    const links = rawLinks(kind, works, new Set(byId.keys()), kind === 'cocitation' ? cocitationPairs : null);
    const tls = new Map();
    for (const [key, n] of links) for (const id of key.split('|')) tls.set(id, (tls.get(id) || 0) + n);
    const chosen = [...tls.keys()].sort((a, b) => tls.get(b) - tls.get(a) || (byId.get(b).citations || 0) - (byId.get(a).citations || 0) || (a < b ? -1 : 1)).slice(0, maxNodes);
    const core = mapCore(chosen, links), stats = { kind, candidates: candidates.length, linked_works: tls.size, links: links.size, ...core.counts };
    if (!core.ids.length) return { kind, nodes: [], edges: [], clusters: [], stats };
    const nodes = core.ids.map((id, i) => { const w = byId.get(id); return { ...core.place(id, i), label: label(w), title: w.title, doi: w.doi || null, year: w.year || null, citations: w.citations || 0, weight: w.citations || 0, topic: w.topic || null }; });
    return { kind, nodes, edges: core.shown, clusters: clusterSummary(nodes, 'topic'), stats: { ...stats, nodes: nodes.length, shown_links: core.shown.length, total_links: core.total_links } };
}

// Co-authorship map of institutions (VOSviewer "co-authorship, organizations"): a link counts works shared by two institutions.
// The home institution is on every work of an affiliated set, so it is left out unless includeHome is set.
export function buildCollaborationMap(works, { institutionsOf, homeId = null, includeHome = false, minWorks = 1, maxNodes = MAP_LIMITS.nodes, nameOf = id => id, countryOf = () => null } = {}) {
    maxNodes = Math.max(10, Math.min(MAP_LIMITS.nodes, Number(maxNodes) || MAP_LIMITS.nodes));
    const count = new Map(), years = new Map(), cites = new Map(), lists = [];
    for (const w of works) {
        const ids = [...new Set(institutionsOf(w))].filter(id => includeHome || id !== homeId).sort();
        for (const id of ids) { count.set(id, (count.get(id) || 0) + 1); cites.set(id, (cites.get(id) || 0) + (w.citations || 0)); if (w.year) { const y = years.get(id) || [0, 0]; years.set(id, [y[0] + w.year, y[1] + 1]); } }
        lists.push(ids);
    }
    const eligible = new Set([...count].filter(([, n]) => n >= Number(minWorks || 1)).map(([id]) => id)), links = new Map();
    // Works with very many institutions (large consortia) would add hundreds of weak pairs; VOSviewer offers the same cap.
    for (const ids of lists) { const list = ids.filter(id => eligible.has(id)); if (list.length > 25) continue; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(links, list[i], list[j]); }
    const tls = new Map();
    for (const [key, n] of links) for (const id of key.split('|')) tls.set(id, (tls.get(id) || 0) + n);
    const chosen = [...tls.keys()].sort((a, b) => tls.get(b) - tls.get(a) || count.get(b) - count.get(a) || (a < b ? -1 : 1)).slice(0, maxNodes);
    const core = mapCore(chosen, links), stats = { kind: 'coauthorship', candidates: eligible.size, linked_works: tls.size, links: links.size, ...core.counts };
    if (!core.ids.length) return { kind: 'coauthorship', nodes: [], edges: [], clusters: [], stats };
    const nodes = core.ids.map((id, i) => { const y = years.get(id); return { ...core.place(id, i), label: nameOf(id), title: nameOf(id), year: y ? Math.round(y[0] / y[1] * 10) / 10 : null,
        weight: count.get(id), works: count.get(id), citations: cites.get(id) || 0, country: countryOf(id), home: id === homeId }; });
    return { kind: 'coauthorship', nodes, edges: core.shown, clusters: clusterSummary(nodes, 'country'), stats: { ...stats, nodes: nodes.length, shown_links: core.shown.length, total_links: core.total_links } };
}

// VOSviewer map and network files (tab-separated, numeric ids), readable by VOSviewer's "Create map based on network data".
export function vosviewerFiles(map) {
    const num = new Map(map.nodes.map((n, i) => [n.id, i + 1])), clean = s => String(s ?? '').replace(/[\t\r\n"]+/g, ' ').trim();
    const works = map.kind === 'coauthorship', header = `id\tlabel\tdescription\turl\tx\ty\tcluster\tweight<Links>\tweight<Total link strength>\tweight<${works ? 'Documents' : 'Citations'}>\tscore<${works ? 'Avg. pub. year' : 'Pub. year'}>`;
    const rows = map.nodes.map(n => [num.get(n.id), clean(n.label), clean(n.title), n.doi || '', n.x, n.y, n.cluster || '', n.links, n.strength, works ? n.works : n.citations, n.year ?? ''].join('\t'));
    return { map: [header, ...rows].join('\n') + '\n', network: map.edges.map(e => `${num.get(e.source)}\t${num.get(e.target)}\t${e.strength}`).join('\n') + '\n' };
}

// Funding flows: works per (funder → field or topic). A work with several funders counts once for each of them;
// funders after the top ones are grouped as "Other funders", targets after the top ones as "Other".
export const FLOW_LIMITS = { funders: 10, fields: 12, topics: 12 };
export function buildFundingFlow(works, { by = 'field', topFunders = FLOW_LIMITS.funders, topTargets, funderName = id => id, targetName = id => id } = {}) {
    topTargets ??= by === 'topic' ? FLOW_LIMITS.topics : FLOW_LIMITS.fields;
    const funded = works.filter(w => w.funders?.length), target = w => (by === 'topic' ? w.topic : w.field) || 'unknown';
    const funderCount = new Map(), targetCount = new Map();
    for (const w of funded) { for (const f of new Set(w.funders)) funderCount.set(f, (funderCount.get(f) || 0) + 1); targetCount.set(target(w), (targetCount.get(target(w)) || 0) + 1); }
    const rank = map => [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
    const keepF = new Set(rank(funderCount).slice(0, topFunders)), keepT = new Set(rank(targetCount).slice(0, topTargets));
    const left = id => keepF.has(id) ? id : 'other', right = id => keepT.has(id) ? id : 'other';
    const links = new Map(), lCount = new Map(), rCount = new Map();
    for (const w of funded) {
        const t = right(target(w));
        rCount.set(t, (rCount.get(t) || 0) + 1);
        for (const f of new Set([...new Set(w.funders)].map(left))) {
            lCount.set(f, (lCount.get(f) || 0) + 1);
            const key = `${f}|${t}`; links.set(key, (links.get(key) || 0) + 1);
        }
    }
    const order = (counts, keep) => [...rank(counts).filter(id => id !== 'other' && keep.has(id)), ...(counts.has('other') ? ['other'] : [])];
    const sources = order(lCount, keepF).map(id => ({ id, name: id === 'other' ? 'Other funders' : funderName(id), count: lCount.get(id) }));
    const targets = order(rCount, keepT).map(id => ({ id, name: id === 'other' ? 'Other' : id === 'unknown' ? 'Not classified' : targetName(id), count: rCount.get(id) }));
    return { by, sources, targets, links: [...links].map(([key, count]) => { const [source, target] = key.split('|'); return { source, target, count }; }).sort((a, b) => b.count - a.count),
        funded: funded.length, total: works.length, funders: funderCount.size };
}
