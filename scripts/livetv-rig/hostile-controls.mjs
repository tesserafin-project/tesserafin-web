#!/usr/bin/env node
/*
 * #153-WEB-R2 — the Live TV rig's permanent hostile controls.
 *
 * WHY THIS EXISTS
 *
 *   #153-WEB-R1 F4-1: the acceptance gate accepted ANY returned media-source id that merely
 *   differed from the channel item id. The repair adds a positive oracle — the tuner source id
 *   the fixture owns, derived from the playlist line `make-fixture.sh` wrote. These controls are
 *   what stop that oracle decaying back into decoration: each mutates ONE thing and requires the
 *   gate to fail ON THE NAMED PROPERTY, not merely to exit non-zero.
 *
 * ISOLATION
 *
 *   Every mutation is applied to a COPY of the rig under `scripts/livetv-rig/controls/<id>/`,
 *   which `.gitignore` excludes. The tracked rig files are never written, so there is no
 *   `git checkout --` restore that could destroy uncommitted work, and the pristine digests are
 *   re-verified after every control regardless.
 *
 *   The copy lives INSIDE the repository on purpose. Node resolves a bare `@playwright/test`
 *   import by walking up from the importing FILE, not from the working directory, so a copy in
 *   `os.tmpdir()` cannot import Playwright at all: measured, and all three controls came back as
 *   ERROR "the mutated line was never reached" while the mutation was plainly applied on disk.
 *
 * REACHED, NOT MERELY FAILED
 *
 *   A control is RED only when the failure text carries its own sentinel value AND the mutated
 *   run actually observed a channel PlaybackInfo request. A gate that timed out, failed to
 *   import, or died in setup never reached the mutated line and is graded ERROR/INERT — both
 *   block publication.
 *
 * USAGE (invoked by run-acceptance.sh under LTV_RIG_CONTROLS=1, inside a live rig session)
 *
 *   node scripts/livetv-rig/hostile-controls.mjs <movieId> <channelId> <expectedSourceId> <outDir>
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = dirname(fileURLToPath(import.meta.url));
const [MOVIE_ID, CHANNEL_ID, EXPECTED_SOURCE_ID, OUT_DIR] =
    process.argv.slice(2);

if (!MOVIE_ID || !CHANNEL_ID || !EXPECTED_SOURCE_ID || !OUT_DIR) {
    process.stderr.write(
        'usage: hostile-controls.mjs <movieId> <channelId> <expectedSourceId> <outDir>\n'
    );
    process.exit(2);
}

/** The single line that maps the response's media sources onto the graded value. */
const MAP_ANCHOR =
    '        returnedSourceIds: (payload?.MediaSources ?? []).map((s) => s.Id),';

const CONTROLS = [
    {
        id: 'r2-a',
        name: 'response-controlled unexpected source id',
        // The RESPONSE now carries an id that is neither the channel item id nor the tuner id.
        // Before the repair this passed: it differs from CHANNEL_ID, which was the whole test.
        find: MAP_ANCHOR,
        replace:
            "        returnedSourceIds: (payload?.MediaSources ?? []).map(\n            () => 'R2-CONTROL-UNEXPECTED-SOURCE-ID'\n        ),",
        expectedSourceId: EXPECTED_SOURCE_ID,
        marker: 'is not the tuner source id the fixture owns',
        sentinel: 'actual R2-CONTROL-UNEXPECTED-SOURCE-ID'
    },
    {
        id: 'r2-b',
        name: 'false independent expected tuner id',
        // Only the ORACLE moves. Record selection stays on CHANNEL_ID, so the PlaybackInfo
        // request still happens and the equality is what fails — not a selection timeout.
        find: null,
        replace: null,
        expectedSourceId: 'R2-CONTROL-FALSE-EXPECTED-ID',
        marker: 'is not the tuner source id the fixture owns',
        sentinel: 'expected R2-CONTROL-FALSE-EXPECTED-ID'
    },
    {
        id: 'r2-c',
        name: 'channel item id returned as the source id',
        // The pre-repair negative assertion AND the new positive one must both fire: this is the
        // original defect shape, and it must stay caught by more than one property.
        find: MAP_ANCHOR,
        replace:
            '        returnedSourceIds: (payload?.MediaSources ?? []).map(\n            () => CHANNEL_ID\n        ),',
        expectedSourceId: EXPECTED_SOURCE_ID,
        marker: 'is not the tuner source id the fixture owns',
        alsoMarker: 'the returned source id is the channel item id',
        sentinel: `actual ${CHANNEL_ID}`
    }
];

const RIG_FILES = readdirSync(RIG).filter((name) =>
    /\.(mjs|sh|py)$/.test(name)
);
const digests = () =>
    Object.fromEntries(
        RIG_FILES.map((name) => [
            name,
            createHash('sha256')
                .update(readFileSync(join(RIG, name)))
                .digest('hex')
        ])
    );
const PRISTINE = digests();

function stillPristine() {
    const now = digests();
    return RIG_FILES.every((name) => now[name] === PRISTINE[name]);
}

const results = [];
for (const control of CONTROLS) {
    const work = join(RIG, 'controls', control.id);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    for (const name of RIG_FILES)
        copyFileSync(join(RIG, name), join(work, name));

    let applied = 'no mutation (oracle-only control)';
    if (control.find) {
        const before = readFileSync(join(work, 'acceptance.mjs'), 'utf8');
        const count = before.split(control.find).length - 1;
        if (count !== 1) {
            results.push({
                ...control,
                verdict: 'ERROR',
                detail: `anchor resolved ${count} times, expected 1`
            });
            rmSync(work, { recursive: true, force: true });
            continue;
        }
        writeFileSync(
            join(work, 'acceptance.mjs'),
            before.replace(control.find, control.replace),
            'utf8'
        );
        applied = 'acceptance.mjs returnedSourceIds mapping';
    }

    const out = join(OUT_DIR, `ltv-control-${control.id}.json`);
    const run = spawnSync(
        'node',
        [join(work, 'acceptance.mjs'), MOVIE_ID, CHANNEL_ID, out, control.id],
        {
            cwd: resolve(RIG, '..', '..'),
            encoding: 'utf8',
            timeout: 15 * 60 * 1000,
            env: {
                ...process.env,
                LTV_RIG_ASSERT: '1',
                LTV_EXPECTED_SOURCE_ID: control.expectedSourceId
            }
        }
    );
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

    // Did the mutated run REACH the graded request at all? The ledger is written before the gate
    // runs, so its presence separates "the property failed" from "nothing ever happened".
    let reached = false;
    let ledgerSummary = null;
    try {
        const ledger = JSON.parse(readFileSync(out, 'utf8'));
        const channel = (ledger.playbackInfoRequests ?? []).filter(
            (request) => request.item === 'channel-item'
        );
        reached = channel.length > 0;
        ledgerSummary = {
            channelPlaybackInfoRequests: channel.length,
            returnedSourceIds: channel[0]?.returnedSourceIds ?? null
        };
    } catch {
        reached = false;
    }

    let verdict;
    let detail;
    if (run.error?.code === 'ETIMEDOUT') {
        verdict = 'ERROR';
        detail = 'the gate did not finish inside fifteen minutes';
    } else if (!reached) {
        verdict = 'ERROR';
        detail =
            'no channel PlaybackInfo request was observed — the mutated line was never reached';
    } else if (run.status === 0) {
        verdict = 'INERT';
        detail =
            'the mutation applied, the request happened, and the gate still passed';
    } else if (!output.includes(control.sentinel)) {
        verdict = 'ERROR';
        detail = `failed without the control's own value in the output (${control.sentinel})`;
    } else if (!output.includes(control.marker)) {
        verdict = 'ERROR';
        detail = `failed WITHOUT the named assertion (${control.marker})`;
    } else if (control.alsoMarker && !output.includes(control.alsoMarker)) {
        verdict = 'ERROR';
        detail = `the named assertion fired but its companion did not (${control.alsoMarker})`;
    } else {
        verdict = 'RED';
        detail = control.marker;
    }

    rmSync(work, { recursive: true, force: true });
    if (!stillPristine()) {
        verdict = 'ERROR';
        detail = 'the tracked rig did not stay byte-identical';
    }

    results.push({
        id: control.id,
        name: control.name,
        applied,
        expectedSourceId: control.expectedSourceId,
        exit: run.status,
        namedAssertion: control.marker,
        sentinel: control.sentinel,
        reached,
        ledgerSummary,
        verdict,
        detail,
        failureLines: output
            .split('\n')
            .filter((line) => /source-selection:/.test(line))
            .map((line) => line.trim()),
        // Kept only when the control did NOT grade RED: an ERROR is undiagnosable without it, and
        // a RED already names everything that matters.
        outputTail:
            verdict === 'RED' ? null : output.split('\n').slice(-25).join('\n')
    });
    process.stdout.write(
        `${verdict.padEnd(5)} ${control.id} ${control.name} — exit ${run.status} — ${detail}\n`
    );
}

writeFileSync(
    join(OUT_DIR, 'ltv-hostile-controls.json'),
    `${JSON.stringify(
        {
            generatedFor: '#153-WEB-R2 phase 3',
            expectedSourceId: EXPECTED_SOURCE_ID,
            pristineAfter: stillPristine(),
            controls: results
        },
        null,
        2
    )}\n`,
    'utf8'
);

const bad = results.filter((result) => result.verdict !== 'RED');
process.exit(bad.length === 0 ? 0 : 1);
