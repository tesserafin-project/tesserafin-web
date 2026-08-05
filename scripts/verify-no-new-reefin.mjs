#!/usr/bin/env node
/*
 * Guard against NEWLY introduced Tesserafin-owned `reefin` IDENTIFIERS.
 *
 * The Reefin -> Tesserafin migration is complete for the code this repo owns.
 * This gate fails if a *migrated identifier form* reappears in the Tesserafin-owned
 * source surface, so the brand does not silently regress via copy/paste or a bad merge.
 *
 * It is a DENYLIST of concrete identifier shapes, NOT a blanket "no reefin" scan:
 * historical provenance in comments (`reefin` #46, all3f0r1/reefin#43, reefin@<sha>),
 * the functional sibling server-checkout path (`../reefin`) and inherited `@jellyfin/*`
 * / `jellyfin-apiclient` names are intentionally NOT matched — they are classified,
 * frozen residue.
 *
 * `Reefin Classic` / `Reefin Glass` USED to be on that exemption list, as deferred theme
 * branding. RFC-0007 closed the deferral: both official themes are now displayed as
 * `Tesserafin Classic` and `Tesserafin Glass` in every picker, manifest and comment, so
 * the two strings moved from "exempt" to DENY below. That is a strengthening of this
 * gate, not a relaxation — nothing that was matched before is unmatched now.
 *
 * SCOPE: src/, scripts/, tests/, root config. EXCLUDES node_modules, the generated
 * SDK tree and pinned spec (regenerated artifacts), docs/ and .github/workflows/.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SCAN_PREFIXES = ['src/', 'scripts/', 'tests/'];
const SCAN_ROOT_FILES = new Set([
    'package.json',
    'package-lock.json',
    'playwright.config.ts',
    'webpack.common.js'
]);
const EXCLUDE = [
    'node_modules/',
    'src/lib/tesserafin-sdk/generated/',
    'src/lib/tesserafin-sdk/spec/',
    'scripts/verify-no-new-reefin.mjs' // this guard names the forbidden forms
];

// Migrated identifier forms that MUST NOT reappear in Tesserafin-owned source.
const DENY = [
    /reefin-sdk/i,
    /reefin-design/i,
    /reefin-e2e-/i,
    /REEFIN_[A-Z]/,
    /x-reefin-version/i,
    /xReefinVersion/,
    /Reefin(Sdk|Api|ClientInfo|DeviceInfo)/,
    /createReefinApi/,
    /Reefin(Color|Typography|Shape|Spacing|Elevation|Motion|Density|Blur)Tokens?/,
    /ReefinColorGroup/,
    /ReefinTokens/,
    /_reefinSdk/,
    /reefinPlaybackCapabilities/,
    /Reefin Web E2E/,
    /generate[:-]reefin-sdk/i,
    /verify[:-]reefin-sdk-fresh/i,
    /docs\/reefin\b/,
    // Theme branding, un-deferred by RFC-0007. See the header note.
    /Reefin Classic/,
    /Reefin Glass/
];

const files = execSync('git ls-files', { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !EXCLUDE.some((e) => f === e || f.startsWith(e)))
    .filter(
        (f) =>
            SCAN_PREFIXES.some((p) => f.startsWith(p)) || SCAN_ROOT_FILES.has(f)
    );

const violations = [];
for (const file of files) {
    let text;
    try {
        text = readFileSync(file, 'utf-8');
    } catch {
        continue;
    }
    text.split('\n').forEach((line, i) => {
        for (const re of DENY) {
            if (re.test(line)) {
                violations.push(
                    `${file}:${i + 1}: [${re}] ${line.trim().slice(0, 120)}`
                );
                break;
            }
        }
    });
}

if (violations.length > 0) {
    console.error(
        `[verify:no-new-reefin] FAIL - ${violations.length} migrated \`reefin\` identifier form(s) reintroduced:`
    );
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
}
console.log(
    `[verify:no-new-reefin] OK - scanned ${files.length} Tesserafin-owned files, no reintroduced reefin identifiers.`
);
