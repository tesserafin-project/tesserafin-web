#!/usr/bin/env node
/**
 * TEMPORARY measurement helper for issue #23 (LANE B item 1). Not for merge.
 * Extracts, from a webpack --json stats file, every module under src/lib/reefin-sdk
 * that lands in the main entry chunk, with its size and its issuer chain.
 */
import { readFileSync } from 'node:fs';

const stats = JSON.parse(readFileSync(process.argv[2] || 'stats.json', 'utf8'));

const MAIN = 'main.jellyfin';
const isSdk = (n) => n && n.includes('src/lib/reefin-sdk');
const clean = (n) =>
    (n || '')
        .replace(/^\.\//, '')
        .replace(/\?.*$/, '')
        .replace(/^.*!/, '');

// Flatten modules (concatenated modules hide children in `modules`)
const all = [];
const walk = (mods, parent) => {
    for (const m of mods || []) {
        all.push({ ...m, _parent: parent });
        if (m.modules) walk(m.modules, m);
    }
};
walk(stats.modules, null);

const chunkName = (id) => {
    const c = (stats.chunks || []).find((c) => c.id === id || (c.ids || []).includes(id));
    return c ? (c.names || []).join(',') || `chunk#${c.id}` : `chunk#${id}`;
};

const inMain = (m) => {
    const ids = m.chunks && m.chunks.length ? m.chunks : m._parent ? m._parent.chunks : [];
    return (ids || []).some((id) => chunkName(id).includes(MAIN));
};

const sdkMods = all.filter((m) => isSdk(m.name) && inMain(m));

// Build issuer map: sdk module -> set of non-sdk issuers (reasons)
const rows = [];
let total = 0;
for (const m of sdkMods) {
    const size = m.size || 0;
    total += size;
    const issuers = new Set();
    for (const r of m.reasons || []) {
        const rm = clean(r.moduleName || r.module || '');
        if (rm && !isSdk(rm)) issuers.add(`${rm} [${r.type || '?'}]`);
        else if (rm) issuers.add(`(sdk-internal) ${rm}`);
    }
    rows.push({
        module: clean(m.name),
        size,
        issuerChain: clean(m.issuerName || m.issuer || ''),
        issuers: [...issuers]
    });
}

rows.sort((a, b) => b.size - a.size);

console.log(`### reefin-sdk modules in ${MAIN} chunk: ${rows.length}`);
console.log(`### total stats-reported size: ${total} bytes (${(total / 1024).toFixed(1)} KiB) [PRE-MINIFICATION]`);
console.log('');
for (const r of rows) {
    console.log(`${String(r.size).padStart(8)}  ${r.module}`);
    console.log(`          issuer: ${r.issuerChain}`);
    for (const i of r.issuers.slice(0, 6)) console.log(`          <- ${i}`);
}

// Aggregate by top-level external issuer
const byIssuer = new Map();
for (const r of rows) {
    for (const i of r.issuers) {
        if (i.startsWith('(sdk-internal)')) continue;
        const key = i.replace(/ \[.*/, '');
        if (!byIssuer.has(key)) byIssuer.set(key, { bytes: 0, mods: [] });
        const e = byIssuer.get(key);
        e.bytes += r.size;
        e.mods.push(r.module);
    }
}
console.log('\n### EXTERNAL ISSUERS (non-additive: shared modules counted per issuer)');
for (const [k, v] of [...byIssuer.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`${String(v.bytes).padStart(8)}  ${k}  (${v.mods.length} sdk modules)`);
}

// Asset sizes
console.log('\n### ASSETS');
for (const a of (stats.assets || []).filter((a) => a.name.includes('main.jellyfin'))) {
    console.log(`${String(a.size).padStart(8)}  ${a.name}`);
}
