/*! Copyright (c) 2026 Ikhwan Arief (ikhwan[at]eng.unand.ac.id). All rights reserved.
 * Licensed under the PolyForm Noncommercial License 1.0.0
 * (https://polyformproject.org/licenses/noncommercial/1.0.0). Commercial use requires prior
 * written permission from the copyright holder. See LICENSE and NOTICE. */
// Widget-only page: reads ?journal=S… (optionally ?accent=… and ?year=…), mounts the journal widget on a
// plain white page, and tells a parent iframe how tall the content is. No dashboard navigation or header.
(() => {
    const JOURNAL = /^S\d{1,15}$/i;
    const params = new URLSearchParams(location.search);
    const id = (params.get('journal') || params.get('id') || '').trim().toUpperCase();
    const mount = document.getElementById('journal'), message = document.getElementById('embed-message');
    let frame = 0;
    const post = () => {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            // Measure the content instead of the iframe viewport so the parent can both grow and shrink it.
            const contentBottom = Math.max(
                mount?.hidden ? 0 : mount?.getBoundingClientRect().bottom || 0,
                message?.hidden ? 0 : message?.getBoundingClientRect().bottom || 0,
            );
            const height = Math.max(120, Math.ceil(contentBottom + 16));
            try {
                if (window.parent !== window) window.parent.postMessage({ type: 'ror-journal-widget', journal: id, height }, '*');
            } catch (error) { /* sandboxed or detached frame */ }
        });
    };
    const fail = text => {
        if (mount) mount.hidden = true;
        if (message) { message.hidden = false; message.textContent = text; }
        post();
    };
    if (!JOURNAL.test(id)) {
        fail('Add ?journal=S… to the address, for example ?journal=S4306516684.');
        return;
    }
    mount.dataset.journalMetrics = id;
    const accent = (params.get('accent') || '').trim();
    if (/^#?[0-9a-f]{3,8}$/i.test(accent)) mount.dataset.accent = accent.startsWith('#') ? accent : '#' + accent;
    const year = (params.get('year') || '').trim();
    if (/^\d{4}$/.test(year)) mount.dataset.uamYear = year;
    if ('ResizeObserver' in window) new ResizeObserver(post).observe(document.body);
    addEventListener('load', post);
    addEventListener('resize', post);
    post();
})();
