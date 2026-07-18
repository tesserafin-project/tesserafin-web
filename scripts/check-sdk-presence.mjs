#!/usr/bin/env node
/**
 * TEMPORARY measurement helper for issue #23 (LANE B item 1). Not for merge.
 *
 * Class names are mangled by terser, so their absence from the minified bundle proves nothing.
 * URL path string literals are NOT mangled. This probes, per generated API class, whether any of
 * its endpoint path literals survive into main.jellyfin.bundle.js.
 *
 * Self-validating: SystemApi / LibraryApi / ShowApi / UserViewApi are known-used by eager issuers
 * and MUST show PRESENT. If they don't, the probe method itself is broken.
 */
import { readFileSync, readdirSync } from 'node:fs';

const bundle = readFileSync('dist/main.jellyfin.bundle.js', 'utf8');
const dir = 'src/lib/reefin-sdk/generated/api';
const res = [];

for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(`${dir}/${f}`, 'utf8');
    const lits = [...src.matchAll(/localVarPath = `([^`]+)`/g)].map((m) => m[1]);
    const probes = [
        ...new Set(
            lits
                .map((l) => {
                    const i = l.search(/[${]/);
                    return (i === -1 ? l : l.slice(0, i)).replace(/\/$/, '');
                })
                .filter((p) => p.length >= 8)
        )
    ];
    const hits = probes.filter((p) => bundle.includes(p));
    res.push({ api: f, probes: probes.length, hits: hits.length, sample: hits.slice(0, 3) });
}

res.sort((a, b) => b.hits - a.hits || a.api.localeCompare(b.api));
for (const r of res) {
    console.log(
        `${r.hits > 0 ? 'PRESENT' : 'absent '}  ${r.api.padEnd(28)} probes=${String(r.probes).padStart(3)} hits=${String(r.hits).padStart(3)}  ${r.sample.join('  ')}`
    );
}
const present = res.filter((r) => r.hits > 0);
console.log(`\n${present.length} / ${res.length} generated API classes have endpoint literals in the main bundle.`);
