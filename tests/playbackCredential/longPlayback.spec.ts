/**
 * #153-A1 — the long-playback acceptance proof. A0 explicitly reserved this evidence for A1.
 *
 * The claim: a real media read stays usable BEYOND the capability's original fifteen-minute expiry,
 * because renewal happened inside the final five minutes and extended the SAME secret in place.
 *
 * This is a wall-clock proof, not a clock-moved unit test. The server's `CapabilityLifetime` is 15
 * minutes and its `CapabilityRenewalWindow` is 5, both read from
 * `PlaybackCredentialService`; nothing here shortens them. It therefore runs ~18 minutes and is
 * NOT part of `validate` — it has its own config and npm script, and is preserved as a reproducible
 * acceptance harness.
 *
 * OUTPUT SAFETY. The capability value is never recorded. Its identity across time is proven with a
 * SHA-256 digest computed in the browser: equal digests prove the same secret, and a digest
 * discloses nothing. Urls are redacted to path plus sorted query KEY names.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

import { MOVIE_TITLE, signIn } from '../e2e/support/b2';
import {
    expectPlaybackAdvances,
    openDetailByName,
    playControl,
    sessionToken
} from './support/rig';

/** Server constants, mirrored from `PlaybackCredentialService`. Not shortened, not overridden. */
const CAPABILITY_LIFETIME_MS = 15 * 60 * 1000;
const RENEWAL_WINDOW_MS = 5 * 60 * 1000;

/** How far past the ORIGINAL expiry the proof keeps reading. */
const OVERRUN_MS = 90 * 1000;
/** How often a real media read is issued. */
const PROBE_INTERVAL_MS = 60 * 1000;

const digest = (value: string) =>
    createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

function capabilityDigest(url: string): string | null {
    try {
        const value = new URL(url).searchParams.get('playbackCapability');
        return value ? digest(value) : null;
    } catch {
        return null;
    }
}

function redact(url: string): string {
    try {
        const parsed = new URL(url);
        const keys = [...parsed.searchParams.keys()].sort();
        return `${parsed.pathname}${keys.length ? `?{${keys.join(',')}}` : ''}`;
    } catch {
        return '<unparseable>';
    }
}

test.describe('#153-A1 long playback', () => {
    test('a media read outlives the original expiry because renewal extended the same secret', async ({
        page
    }) => {
        test.setTimeout(CAPABILITY_LIFETIME_MS + OVERRUN_MS + 5 * 60 * 1000);

        interface MintRecord {
            kind: 'mint' | 'renew';
            atMs: number;
            status: number;
            expiresAtMs: number | null;
        }
        const mints: MintRecord[] = [];
        const start = Date.now();
        let token = '';
        const durableHits: string[] = [];

        page.on('response', async (response) => {
            const url = response.url();
            if (/\/Playback\/Capabilities/i.test(url)) {
                const renew = /\/Renew$/i.test(new URL(url).pathname);
                let expiresAtMs: number | null = null;
                try {
                    const body = await response.json();
                    expiresAtMs = body?.ExpiresAt
                        ? Date.parse(body.ExpiresAt)
                        : null;
                } catch {
                    expiresAtMs = null;
                }
                mints.push({
                    kind: renew ? 'renew' : 'mint',
                    atMs: Date.now(),
                    status: response.status(),
                    expiresAtMs
                });
            }
            if (token && url.includes(token)) durableHits.push(redact(url));
        });

        await signIn(page);
        token = await sessionToken(page);

        await openDetailByName(page, MOVIE_TITLE);
        await playControl(page).click();
        await expectPlaybackAdvances(page, 0.2);

        // The url the media element was actually given. Every later read uses THIS url, so a
        // rotated secret would show up as a changed digest rather than as a silent re-mint.
        const mediaUrl = await page.evaluate(
            () => document.querySelector('video')?.currentSrc ?? ''
        );
        expect(mediaUrl, 'the player must have a media url').toContain(
            'playbackCapability'
        );
        const originalDigest = capabilityDigest(mediaUrl);
        expect(
            originalDigest,
            'the media url must carry a capability'
        ).toBeTruthy();
        expect(mediaUrl).not.toMatch(/ApiKey=|api_key=/i);

        const firstMint = mints.find(
            (m) => m.kind === 'mint' && m.status < 400
        );
        expect(
            firstMint?.expiresAtMs,
            'the mint must report an expiry'
        ).toBeTruthy();
        const originalExpiryMs = firstMint!.expiresAtMs!;

        /** One real, ranged media read of the same url, issued from the page's own origin. */
        const probe = async () =>
            page.evaluate(async (url) => {
                const response = await fetch(url, {
                    headers: { Range: 'bytes=0-2047' },
                    cache: 'no-store'
                });
                return {
                    status: response.status,
                    bytes: (await response.arrayBuffer()).byteLength
                };
            }, mediaUrl);

        interface ProbeRecord {
            atMs: number;
            sinceStartMs: number;
            pastOriginalExpiry: boolean;
            status: number;
            bytes: number;
        }
        const probes: ProbeRecord[] = [];

        const record = async () => {
            const result = await probe();
            probes.push({
                atMs: Date.now(),
                sinceStartMs: Date.now() - start,
                pastOriginalExpiry: Date.now() > originalExpiryMs,
                status: result.status,
                bytes: result.bytes
            });
        };

        await record();

        // Read every minute until well past the ORIGINAL expiry.
        const deadline = originalExpiryMs + OVERRUN_MS;
        while (Date.now() < deadline) {
            await page.waitForTimeout(
                Math.min(
                    PROBE_INTERVAL_MS,
                    Math.max(1_000, deadline - Date.now())
                )
            );
            await record();
        }

        const finalDigest = capabilityDigest(mediaUrl);
        const renewals = mints.filter((m) => m.kind === 'renew');
        const report = {
            generatedFor: '#153-A1 long playback acceptance',
            note: 'digests, timings, statuses and byte counts only; no credential value is recorded',
            capabilityLifetimeMs: CAPABILITY_LIFETIME_MS,
            renewalWindowMs: RENEWAL_WINDOW_MS,
            originalExpiryMsSinceStart: originalExpiryMs - start,
            capabilityDigestAtStart: originalDigest,
            capabilityDigestAtEnd: finalDigest,
            renewals: renewals.map((r) => ({
                status: r.status,
                msSinceStart: r.atMs - start,
                msBeforeOriginalExpiry: originalExpiryMs - r.atMs,
                insideWindow:
                    originalExpiryMs - r.atMs <= RENEWAL_WINDOW_MS &&
                    originalExpiryMs - r.atMs > 0,
                newExpiryMsSinceStart: r.expiresAtMs
                    ? r.expiresAtMs - start
                    : null
            })),
            probes,
            durableTokenHits: durableHits
        };
        const out = join(
            process.cwd(),
            'test-results',
            'a1-long-playback.json'
        );
        if (!existsSync(dirname(out)))
            mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(report, null, 2));

        // 1. renewal happened, and ONLY inside the final five minutes.
        expect(
            renewals.length,
            'the capability must have been renewed'
        ).toBeGreaterThan(0);
        for (const renewal of renewals) {
            expect(
                renewal.status,
                'every renewal must succeed — a refusal fails closed by design'
            ).toBeLessThan(400);
        }
        const first = renewals[0];
        expect(
            originalExpiryMs - first.atMs,
            'renewal must not be attempted before the window opens'
        ).toBeLessThanOrEqual(RENEWAL_WINDOW_MS);
        expect(
            originalExpiryMs - first.atMs,
            'renewal must not be attempted after expiry'
        ).toBeGreaterThan(0);

        // 2. the secret did NOT rotate: same url, same capability, extended in place.
        expect(finalDigest, 'the capability secret must not have rotated').toBe(
            originalDigest
        );

        // 3. real bytes still arrived AFTER the original expiry.
        const afterExpiry = probes.filter((p) => p.pastOriginalExpiry);
        expect(
            afterExpiry.length,
            'the proof must have read past the original expiry'
        ).toBeGreaterThan(0);
        for (const p of afterExpiry) {
            expect(
                p.status,
                `a read ${Math.round(p.sinceStartMs / 1000)}s in must still succeed`
            ).toBeLessThan(400);
            expect(p.bytes, 'real bytes must arrive').toBeGreaterThan(0);
        }

        // 4. nothing fell back to the durable token at any point.
        expect(durableHits, 'no request may carry the durable token').toEqual(
            []
        );
        expect(mediaUrl).not.toMatch(/ApiKey=|api_key=/i);
    });
});
