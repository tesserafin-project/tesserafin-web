#!/usr/bin/env node
/**
 * Defense-in-depth check for the "bundle principal" size budget (RFC-0002 §7 "Final
 * measurements", W13.1). The primary enforcement lives in webpack.prod.js's `performance` block
 * (`maxAssetSize` + `assetFilter`, reading the same threshold from webpack.performance-budget.json)
 * - that config fails `npm run build:production` outright the moment main.jellyfin.bundle.js
 * exceeds budget, and can't be skipped by forgetting to run a separate script.
 *
 * This script adds a second, independent way to ask the same question without necessarily forcing
 * a rebuild: if `dist/` already has a production build, it just measures the asset already there;
 * otherwise it builds first (which, per the paragraph above, will itself fail loudly if the budget
 * is blown, before this script gets a chance to report anything).
 *
 * Raw (uncompressed) bytes, not gzip: webpack's own performance hints measure the asset exactly as
 * written to disk, with no compression step. Gzip-over-the-wire size is the number that actually
 * matters for users, but computing it needs an extra step (a compression plugin, or shelling out
 * to `gzip -9`) that isn't part of this build pipeline today and would be a second measurement
 * method that could silently drift from the one webpack itself enforces. Using raw size keeps
 * exactly one number, checked the same way in both places - see webpack.performance-budget.json.
 */
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import budget from '../webpack.performance-budget.json' with { type: 'json' };

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DIST_DIR = join(REPO_ROOT, 'dist');
const ASSET_PATH = join(DIST_DIR, budget.mainBundleAsset);

function formatKiB(bytes) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
}

function main() {
    if (!existsSync(ASSET_PATH)) {
        console.log(
            `[verify:bundle-budget] No existing build found at ${ASSET_PATH.replace(REPO_ROOT + '/', '')} ` +
                '- running `npm run build:production` first...'
        );
        try {
            execFileSync('npm', ['run', 'build:production'], {
                cwd: REPO_ROOT,
                stdio: 'inherit'
            });
        } catch (err) {
            console.error(
                `[verify:bundle-budget] FAIL: build:production failed (possibly the webpack ` +
                    `\`performance\` budget guard itself - see webpack.prod.js): ${err.message}`
            );
            process.exitCode = 1;
            return;
        }
    }

    if (!existsSync(ASSET_PATH)) {
        console.error(
            `[verify:bundle-budget] FAIL: expected asset not found after build: ${ASSET_PATH}`
        );
        process.exitCode = 1;
        return;
    }

    const { size } = statSync(ASSET_PATH);
    const withinBudget = size <= budget.mainBundleBudgetBytes;

    console.log(
        `[verify:bundle-budget] ${budget.mainBundleAsset}: ${size} bytes (${formatKiB(size)}), ` +
            `budget ${budget.mainBundleBudgetBytes} bytes (${formatKiB(budget.mainBundleBudgetBytes)})`
    );

    if (!withinBudget) {
        console.error(
            `[verify:bundle-budget] FAIL: main bundle exceeds budget by ` +
                `${size - budget.mainBundleBudgetBytes} bytes.`
        );
        process.exitCode = 1;
        return;
    }

    console.log('[verify:bundle-budget] PASS.');
}

main();
