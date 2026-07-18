import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    applyPlaybackAttemptId,
    beginPlaybackAttempt,
    generatePlaybackAttemptId,
    getCurrentPlaybackAttemptId,
    resetPlaybackAttemptIdForTests,
    sanitizePlaybackAttemptId
} from './playbackAttemptId';

/**
 * Covers the four properties `reefin` #43 actually depends on, phrased as the failure each one
 * prevents:
 *  - a transcoding retry must NOT look like a new attempt (same id across a retry);
 *  - two user-initiated starts must NOT collapse into one attempt (different ids);
 *  - a client that never started an attempt must still produce a VALID request (absent is fine);
 *  - no code path may ever put an empty/whitespace value on the wire (the server 400s on that,
 *    while it accepts an omitted field).
 *
 * The module owns process-wide state by design (one attempt in its starting phase at a time), so
 * every test resets it first.
 */
beforeEach(() => {
    resetPlaybackAttemptIdForTests();
});

describe('beginPlaybackAttempt()', () => {
    it('keeps the same id across every read within one attempt - the retry case', () => {
        // `changeStream()` re-enters `getPlaybackInfo()` without re-entering `playInternal()`, so a
        // retry is modelled here as further reads with NO intervening mint.
        const minted = beginPlaybackAttempt();

        const initialPlaybackInfo = getCurrentPlaybackAttemptId();
        const v2CreateSession = getCurrentPlaybackAttemptId();
        const retriedPlaybackInfo = getCurrentPlaybackAttemptId();

        expect(minted).toBeTruthy();
        expect(initialPlaybackInfo).toBe(minted);
        expect(v2CreateSession).toBe(minted);
        expect(retriedPlaybackInfo).toBe(minted);
    });

    it('mints a different id for a new attempt', () => {
        const firstAttempt = beginPlaybackAttempt();
        const secondAttempt = beginPlaybackAttempt();

        expect(firstAttempt).toBeTruthy();
        expect(secondAttempt).toBeTruthy();
        expect(secondAttempt).not.toBe(firstAttempt);
        // The second attempt is the current one - the first is not resurrectable.
        expect(getCurrentPlaybackAttemptId()).toBe(secondAttempt);
    });

    it('never makes a blank generated value current', () => {
        // A degenerate injected generator must not be able to arm a 400-inducing value.
        expect(beginPlaybackAttempt({ generate: () => '   ' })).toBeUndefined();
        expect(getCurrentPlaybackAttemptId()).toBeUndefined();
    });
});

describe('getCurrentPlaybackAttemptId()', () => {
    it('is undefined before any attempt - absent is a valid request', () => {
        expect(getCurrentPlaybackAttemptId()).toBeUndefined();
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
    it('stamps the current attempt id onto an outbound payload', () => {
        const attemptId = beginPlaybackAttempt();
        const query: { ItemId: string; PlaybackAttemptId?: string } = {
            ItemId: 'item-1'
        };

        expect(applyPlaybackAttemptId(query)).toBe(query);
        expect(query.PlaybackAttemptId).toBe(attemptId);
    });

    it('omits the key entirely when there is no attempt - not an empty string', () => {
        const query: { ItemId: string; PlaybackAttemptId?: string } = {
            ItemId: 'item-1'
        };

        applyPlaybackAttemptId(query);

        // `in` rather than a value check: the field must be ABSENT from the serialized body, which
        // is what the server accepts. A present-but-empty field is the one thing it rejects.
        expect('PlaybackAttemptId' in query).toBe(false);
        expect(JSON.stringify(query)).toBe('{"ItemId":"item-1"}');
    });

    it('cannot emit an empty string even when the minted value was blank', () => {
        beginPlaybackAttempt({ generate: () => '\t \n' });

        const query: { PlaybackAttemptId?: string } = {};
        applyPlaybackAttemptId(query);

        expect('PlaybackAttemptId' in query).toBe(false);
    });

    it('leaves an already-set key untouched when there is no current attempt', () => {
        // Guards against a regression where the helper unconditionally assigns and blanks a value a
        // caller had set itself.
        const query: { PlaybackAttemptId?: string } = {
            PlaybackAttemptId: 'caller-supplied'
        };

        applyPlaybackAttemptId(query);

        expect(query.PlaybackAttemptId).toBe('caller-supplied');
    });
});
