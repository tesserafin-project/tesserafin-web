import { describe, expect, it } from 'vitest';

import {
    buildLegacyExecutionDecision,
    buildRetryMetadata
} from './playbackExecutionDecision';

/**
 * These cover the retry inputs `onPlaybackError` used to recover by string-matching the stream URL
 * (reefin issue #41). Each case names the URL substring the old heuristic looked for, so the
 * equivalence being asserted stays legible.
 */
describe('buildRetryMetadata()', () => {
    it('treats a transcode as already fallbacking (legacy: url contains "transcodereasons")', () => {
        // The server stamps TranscodeReasons into every TranscodingUrl it builds, and that URL is
        // used precisely on the branch that sets playMethod = 'Transcode'.
        expect(buildRetryMetadata('Transcode', null).isAlreadyFallbacking).toBe(
            true
        );
    });

    it.each(['DirectPlay', 'DirectStream'])(
        'does not treat %s as already fallbacking',
        (playMethod) => {
            expect(
                buildRetryMetadata(playMethod, null).isAlreadyFallbacking
            ).toBe(false);
        }
    );

    it('reads the stream-copy flags from the request options (legacy: url contains "allow*streamcopy=false")', () => {
        expect(
            buildRetryMetadata('Transcode', {
                allowVideoStreamCopy: false,
                allowAudioStreamCopy: false
            })
        ).toEqual({
            isAlreadyFallbacking: true,
            preventsVideoStreamCopy: true,
            preventsAudioStreamCopy: true
        });
    });

    it('distinguishes "not constrained" (null/undefined) from an explicit false', () => {
        // The query builder only serializes these when != null, so null must not read as "prevents".
        const notConstrained = buildRetryMetadata('DirectPlay', {
            allowVideoStreamCopy: null,
            allowAudioStreamCopy: undefined
        });

        expect(notConstrained.preventsVideoStreamCopy).toBe(false);
        expect(notConstrained.preventsAudioStreamCopy).toBe(false);
    });

    it('treats an explicit true as not preventing stream copy', () => {
        const allowed = buildRetryMetadata('DirectStream', {
            allowVideoStreamCopy: true,
            allowAudioStreamCopy: true
        });

        expect(allowed.preventsVideoStreamCopy).toBe(false);
        expect(allowed.preventsAudioStreamCopy).toBe(false);
    });

    it('defaults to no prevention when options are absent entirely', () => {
        expect(buildRetryMetadata('DirectPlay', undefined)).toEqual({
            isAlreadyFallbacking: false,
            preventsVideoStreamCopy: false,
            preventsAudioStreamCopy: false
        });
    });
});

describe('buildLegacyExecutionDecision()', () => {
    it('snapshots the legacy streamInfo field-for-field', () => {
        const decision = buildLegacyExecutionDecision(
            {
                url: 'https://example.com/videos/1/stream.mkv',
                mimeType: 'video/x-matroska',
                playMethod: 'Transcode',
                transcodingOffsetTicks: 30000000,
                playSessionId: 'legacy-session'
            },
            { allowVideoStreamCopy: false, allowAudioStreamCopy: null }
        );

        expect(decision).toEqual({
            source: 'legacy',
            url: 'https://example.com/videos/1/stream.mkv',
            mimeType: 'video/x-matroska',
            playMethod: 'Transcode',
            transcodingOffsetTicks: 30000000,
            playSessionId: 'legacy-session',
            retry: {
                isAlreadyFallbacking: true,
                preventsVideoStreamCopy: true,
                preventsAudioStreamCopy: false
            }
        });
    });

    it('carries no playbackSessionId - the legacy path has no server session resource', () => {
        const decision = buildLegacyExecutionDecision({
            url: 'https://example.com/stream',
            playMethod: 'DirectPlay'
        });

        expect(decision.playbackSessionId).toBeUndefined();
        expect(decision.protocol).toBeUndefined();
    });

    it('defaults a missing transcoding offset to 0 rather than undefined', () => {
        const decision = buildLegacyExecutionDecision({
            url: 'https://example.com/stream',
            playMethod: 'DirectPlay'
        });

        expect(decision.transcodingOffsetTicks).toBe(0);
    });
});
