#!/usr/bin/env node
/*
 * Guard against NEWLY introduced references to the former GitHub organisation.
 *
 * The canonical namespace is `tesserafin` (github.com/tesserafin/…,
 * ghcr.io/tesserafin/…). It used to be `tesserafin-project`. Every ACTIVE
 * operational reference — the web-assets registry default, the bake target, the
 * OCI source labels, the revision manifest, CODEOWNERS, the `origin` remote
 * assertion in verify-no-runtime-jellyfin.mjs and the contributor docs — was
 * migrated by the namespace cutover (tesserafin/tesserafin#147).
 *
 * This gate fails when `tesserafin-project` reappears in a tracked file that is
 * not on the historical allowlist, so the old namespace cannot silently return
 * through a copy/paste, a stale branch or a bad merge.
 *
 * It is NOT a blanket scan. The allowlist names records that must keep stating
 * where an artifact was originally published — renaming the organisation does
 * not retroactively change the registry path a past release was pushed to. Each
 * allowlisted file carries a "Namespace note" blockquote saying exactly that.
 *
 * An allowlist entry that no longer contains the old namespace is treated as a
 * failure too: a stale exemption is an exemption nobody is checking.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const FORBIDDEN = 'tesserafin-project';

const ALLOWLIST = new Set([
    // This gate names the forbidden string.
    'scripts/verify-no-old-namespace.mjs',
    // Dated archive of the July 2026 hosted-runner outage, including the
    // Actions run URL that proved allocation was restored.
    'docs/local-ci.md',
    // Recorded maintainer error-pass evidence: image digests and the exact
    // references they were pulled from.
    'docs/tesserafin/b1-maintainer-error-pass.md',
    // Dated CI-restoration stamps (2026-07-27) and the verbatim
    // `fatal: repository ... not found` transcript from run 30230684855 that
    // justified `contents: read`. Both name the organisation as it was; the
    // workflows themselves target no organisation by name.
    '.github/workflows/pull_request.yml',
    '.github/workflows/push.yml',
    // TRANSITIONAL — remove this entry and the branch it covers once the
    // organisation rename has landed. CHECK 5 of the boundary gate reports a
    // pre-cutover `origin` URL as PENDING instead of failing, because this
    // branch is prepared before the rename.
    'scripts/verify-no-runtime-jellyfin.mjs'
]);

const EXCLUDE_PREFIXES = [
    'node_modules/',
    'src/lib/tesserafin-sdk/generated/',
    'src/lib/tesserafin-sdk/spec/'
];

const files = execSync('git ls-files', { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !EXCLUDE_PREFIXES.some((p) => f.startsWith(p)));

const violations = [];
for (const file of files) {
    if (ALLOWLIST.has(file)) continue;
    let text;
    try {
        text = readFileSync(file, 'utf-8');
    } catch {
        continue;
    }
    if (!text.includes(FORBIDDEN)) continue;
    text.split('\n').forEach((line, i) => {
        if (line.includes(FORBIDDEN)) {
            violations.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
    });
}

const stale = [];
for (const allowed of ALLOWLIST) {
    if (allowed === 'scripts/verify-no-old-namespace.mjs') continue;
    if (!existsSync(allowed)) {
        stale.push(`${allowed} (missing)`);
    } else if (!readFileSync(allowed, 'utf-8').includes(FORBIDDEN)) {
        stale.push(`${allowed} (no longer contains the old namespace)`);
    }
}

let failed = false;
if (violations.length > 0) {
    console.error(
        `[verify:no-old-namespace] FAIL - ${violations.length} active reference(s) to \`${FORBIDDEN}\`:`
    );
    for (const v of violations) console.error(`  ${v}`);
    console.error(
        '\nThe canonical namespace is `tesserafin`. If an occurrence is genuinely a'
    );
    console.error(
        'historical record, add its path to ALLOWLIST in this script WITH a reason.'
    );
    failed = true;
}
if (stale.length > 0) {
    console.error(
        `[verify:no-old-namespace] FAIL - ${stale.length} stale allowlist entr(y|ies):`
    );
    for (const s of stale) console.error(`  ${s}`);
    failed = true;
}
if (failed) process.exit(1);

console.log(
    `[verify:no-old-namespace] OK - scanned ${files.length} tracked files, no active \`${FORBIDDEN}\` reference (${ALLOWLIST.size} historical records allowlisted).`
);
