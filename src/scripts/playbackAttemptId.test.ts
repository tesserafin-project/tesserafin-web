import { describe, expect, it, vi } from 'vitest';

import {
    applyPlaybackAttemptId,
    beginPlaybackAttempt,
    generatePlaybackAttemptId,
    sanitizePlaybackAttemptId
} from './playbackAttemptId';

/**
 * Covers the properties `reefin` #43 actually depends on, phrased as the failure each one prevents:
 *  - a transcoding retry must NOT look like a new attempt (same id across a retry);
 *  - two user-initiated starts must NOT collapse into one attempt (different ids);
 *  - two OVERLAPPING starts must not fuse either (the concurrency test below);
 *  - a client that never started an attempt must still produce a VALID request (absent is fine);
 *  - no code path may ever put an empty/whitespace value on the wire (the server 400s on that,
 *    while it accepts an omitted field).
 *
 * The module holds NO state - an attempt id is a value minted by `beginPlaybackAttempt()` and
 * threaded explicitly by its caller - so there is nothing to reset between tests.
 */

describe('beginPlaybackAttempt()', () => {
    it('keeps the same id across every request within one attempt - the retry case', () => {
        // `changeStream()` re-enters `getPlaybackInfo()` without re-entering `playInternal()`, so a
        // retry is modelled here as further payloads stamped from the SAME minted value, with no
        // intervening mint.
        const minted = beginPlaybackAttempt();

        const initialPlaybackInfo: { PlaybackAttemptId?: string } = {};
        const v2CreateSession: { PlaybackAttemptId?: string } = {};
        const retriedPlaybackInfo: { PlaybackAttemptId?: string } = {};

        applyPlaybackAttemptId(initialPlaybackInfo, minted);
        applyPlaybackAttemptId(v2CreateSession, minted);
        applyPlaybackAttemptId(retriedPlaybackInfo, minted);

        expect(minted).toBeTruthy();
        expect(initialPlaybackInfo.PlaybackAttemptId).toBe(minted);
        expect(v2CreateSession.PlaybackAttemptId).toBe(minted);
        expect(retriedPlaybackInfo.PlaybackAttemptId).toBe(minted);
    });

    it('mints a different id for a new attempt', () => {
        const firstAttempt = beginPlaybackAttempt();
        const secondAttempt = beginPlaybackAttempt();

        expect(firstAttempt).toBeTruthy();
        expect(secondAttempt).toBeTruthy();
        expect(secondAttempt).not.toBe(firstAttempt);
    });

    it('never returns a blank generated value as a usable id', () => {
        // A degenerate injected generator must not be able to hand back a 400-inducing value.
        expect(beginPlaybackAttempt({ generate: () => '   ' })).toBeUndefined();
        expect(beginPlaybackAttempt({ generate: () => '' })).toBeUndefined();
    });

    it('trims the generated value before returning it', () => {
        expect(beginPlaybackAttempt({ generate: () => '  attempt-1  ' })).toBe(
            'attempt-1'
        );
    });
});

describe('overlapping playback attempts (reefin #43 concurrency invariant)', () => {
    it('gives two interleaved attempts two distinct ids, each stamped on its own payload', async () => {
        // THE regression this refactor exists to prevent. `playInternal()` is invoked
        // fire-and-forget from `nextTrack()`, `previousTrack()` and `setCurrentPlaylistItem()` -
        // no await, no lock - so a double-click on Play, or an autoplay landing mid-start, puts two
        // attempts in their starting phase at once.
        //
        // The interleaving is forced explicitly rather than left to scheduler luck: attempt A mints,
        // then BLOCKS until attempt B has minted, and only then stamps its payload. That is exactly
        // the ordering that breaks a shared module-global design - B's mint would have overwritten
        // the ambient "current attempt", so A's later stamp would read B's id and both payloads
        // would carry B's value, silently fusing two attempts in the server's diagnostics. This
        // test therefore FAILS BY CONSTRUCTION under a module-global implementation and can only
        // pass while the id is a value returned to, and threaded by, its own caller.
        let releaseAttemptA!: () => void;
        const attemptBHasMinted = new Promise<void>((resolve) => {
            releaseAttemptA = resolve;
        });

        const payloadA: { ItemId: string; PlaybackAttemptId?: string } = {
            ItemId: 'item-a'
        };
        const payloadB: { ItemId: string; PlaybackAttemptId?: string } = {
            ItemId: 'item-b'
        };

        // Attempt A: mints first, but stamps LAST - modelling a `playInternal()` still awaiting
        // `getPlaybackInfo()` when the next attempt starts.
        const attemptA = (async () => {
            const attemptId = beginPlaybackAttempt();

            await attemptBHasMinted;
            applyPlaybackAttemptId(payloadA, attemptId);

            return attemptId;
        })();

        // Attempt B: starts while A is still in flight and mints its own id.
        const attemptB = (async () => {
            const attemptId = beginPlaybackAttempt();

            releaseAttemptA();
            applyPlaybackAttemptId(payloadB, attemptId);

            return attemptId;
        })();

        const [idA, idB] = await Promise.all([attemptA, attemptB]);

        expect(idA).toBeTruthy();
        expect(idB).toBeTruthy();
        expect(idA).not.toBe(idB);

        // Each payload carries ITS OWN attempt's id - not the last one minted.
        expect(payloadA.PlaybackAttemptId).toBe(idA);
        expect(payloadB.PlaybackAttemptId).toBe(idB);
        expect(payloadA.PlaybackAttemptId).not.toBe(payloadB.PlaybackAttemptId);
    });
});

describe('generatePlaybackAttemptId()', () => {
    it('uses crypto.randomUUID() when available', () => {
        const randomUUID = vi
            .spyOn(crypto, 'randomUUID')
            .mockReturnValue('11111111-2222-3333-4444-555555555555');

        expect(generatePlaybackAttemptId()).toBe(
            '11111111-2222-3333-4444-555555555555'
        );
        expect(randomUUID).toHaveBeenCalled();

        randomUUID.mockRestore();
    });

    it('falls back to a non-blank printable id when randomUUID is unavailable', () => {
        // Non-secure contexts and older webviews - the documented fallback. Not cryptographically
        // strong on purpose; it only has to be unique-ish, printable and never blank.
        const randomUUID = crypto.randomUUID;
        // @ts-expect-error - deliberately simulating a platform without randomUUID.
        crypto.randomUUID = undefined;

        try {
            const fallback = generatePlaybackAttemptId();

            expect(fallback.trim()).toBe(fallback);
            expect(fallback.length).toBeGreaterThan(0);
            expect(generatePlaybackAttemptId()).not.toBe(fallback);
        } finally {
            crypto.randomUUID = randomUUID;
        }
    });
});

describe('sanitizePlaybackAttemptId()', () => {
    it('collapses every blank-ish value to undefined, never to an empty string', () => {
        for (const blank of ['', '   ', '\t', '\n', null, undefined]) {
            expect(sanitizePlaybackAttemptId(blank)).toBeUndefined();
        }
    });

    it('trims a usable value', () => {
        expect(sanitizePlaybackAttemptId('  attempt-1  ')).toBe('attempt-1');
    });
});

describe('applyPlaybackAttemptId()', () => {
    it("stamps the given attempt's id onto an outbound payload", () => {
        const attemptId = beginPlaybackAttempt();
        const query: { ItemId: string; PlaybackAttemptId?: string } = {
            ItemId: 'item-1'
        };

        expect(applyPlaybackAttemptId(query, attemptId)).toBe(query);
        expect(query.PlaybackAttemptId).toBe(attemptId);
    });

    it('trims the id it stamps', () => {
        const query: { PlaybackAttemptId?: string } = {};

        applyPlaybackAttemptId(query, '  attempt-1  ');

        expect(query.PlaybackAttemptId).toBe('attempt-1');
    });

    it('omits the key entirely when there is no attempt id - not an empty string', () => {
        const query: { ItemId: string; PlaybackAttemptId?: string } = {
            ItemId: 'item-1'
        };

        applyPlaybackAttemptId(query, undefined);

        // `in` rather than a value check: the field must be ABSENT from the serialized body, which
        // is what the server accepts. A present-but-empty field is the one thing it rejects.
        expect('PlaybackAttemptId' in query).toBe(false);
        expect(JSON.stringify(query)).toBe('{"ItemId":"item-1"}');
    });

    it('cannot emit an empty string even when the id passed in was blank', () => {
        for (const blank of ['', '   ', '\t \n', null, undefined]) {
            const query: { PlaybackAttemptId?: string } = {};

            applyPlaybackAttemptId(query, blank);

            expect('PlaybackAttemptId' in query).toBe(false);
        }
    });

    it('cannot emit an empty string even when the minted value was blank', () => {
        // End-to-end of the two guards: a degenerate generator yields no usable id, and the payload
        // stamped with it comes out with no key at all.
        const attemptId = beginPlaybackAttempt({ generate: () => '\t \n' });

        const query: { PlaybackAttemptId?: string } = {};
        applyPlaybackAttemptId(query, attemptId);

        expect(attemptId).toBeUndefined();
        expect('PlaybackAttemptId' in query).toBe(false);
    });

    it('leaves an already-set key untouched when no attempt id is supplied', () => {
        // Guards against a regression where the helper unconditionally assigns and blanks a value a
        // caller had set itself.
        const query: { PlaybackAttemptId?: string } = {
            PlaybackAttemptId: 'caller-supplied'
        };

        applyPlaybackAttemptId(query, undefined);

        expect(query.PlaybackAttemptId).toBe('caller-supplied');
    });
});
