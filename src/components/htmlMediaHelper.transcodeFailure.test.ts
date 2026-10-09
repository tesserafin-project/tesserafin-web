import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaError } from 'types/mediaError';
import Events from 'utils/events';

import { bindEventsToHlsPlayer, getTranscodeRecovery } from './htmlMediaHelper';

/**
 * tesserafin#119 - what the player does with the server's "this transcode failed" answer.
 *
 * `bindEventsToHlsPlayer` reads `Hls` as a global, which the HTML video player provides at run
 * time. Only the two enums it reads are stood in for; the handlers under test are the real ones.
 */
const HlsStandIn = {
    Events: { MANIFEST_PARSED: 'manifestParsed', ERROR: 'error' },
    ErrorTypes: { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' }
};

function failedSegment(status: number, recovery?: string) {
    return {
        type: HlsStandIn.ErrorTypes.NETWORK_ERROR,
        details: 'fragLoadError',
        fatal: false,
        response: { code: status },
        networkDetails: {
            getResponseHeader: (name: string) =>
                name === 'X-Tesserafin-Playback-Recovery' ? recovery : null
        }
    };
}

function bind() {
    const handlers: Record<string, (event: string, data?: unknown) => void> =
        {};
    const hls = {
        on: (
            name: string,
            handler: (event: string, data?: unknown) => void
        ) => {
            handlers[name] = handler;
        },
        destroy: vi.fn(),
        startLoad: vi.fn()
    };
    const elem = {
        currentTime: 143.76,
        play: () => Promise.resolve(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    };
    const instance: Record<string, unknown> = {};
    const errors: unknown[] = [];
    Events.on(instance, 'error', (_e: unknown, error: unknown) => {
        errors.push(error);
    });
    const resolve = vi.fn();
    const reject = vi.fn();

    bindEventsToHlsPlayer(instance, hls, elem, vi.fn(), resolve, reject);

    return { handlers, hls, elem, instance, errors, resolve, reject };
}

describe('getTranscodeRecovery()', () => {
    it('reads the offer the server attached to a failed transcode', () => {
        expect(getTranscodeRecovery(failedSegment(410, 'software'))).toBe(
            'software'
        );
        expect(getTranscodeRecovery(failedSegment(410, 'none'))).toBe('none');
    });

    it('treats a 410 without a readable offer as a failure with none', () => {
        expect(getTranscodeRecovery(failedSegment(410))).toBe('none');
        expect(getTranscodeRecovery(failedSegment(410, 'anything-else'))).toBe(
            'none'
        );
        expect(getTranscodeRecovery({ response: { code: 410 } })).toBe('none');
    });

    it('is silent about every other failure', () => {
        expect(getTranscodeRecovery(failedSegment(500, 'software'))).toBeNull();
        expect(getTranscodeRecovery(failedSegment(404))).toBeNull();
        expect(getTranscodeRecovery({})).toBeNull();
    });
});

describe('bindEventsToHlsPlayer() - a transcode that fails', () => {
    beforeEach(() => {
        vi.stubGlobal('Hls', HlsStandIn);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('AFTER playback started: raises an error event instead of rejecting a settled promise', async () => {
        const { handlers, hls, instance, errors, resolve, reject } = bind();

        handlers.manifestParsed('manifestParsed');
        await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));

        handlers.error('error', failedSegment(410, 'software'));

        // The regression: `reject` used to stay armed after start, so this went nowhere.
        expect(reject).not.toHaveBeenCalled();
        expect(errors).toEqual([{ type: MediaError.SERVER_ERROR }]);
        expect(hls.destroy).toHaveBeenCalledTimes(1);
        expect(instance.lastPlaybackFailure).toEqual({
            positionMs: 143760,
            transcodeRecovery: 'software'
        });
    });

    it('BEFORE playback started: rejects, and still records what the server offered', () => {
        const { handlers, instance, errors, reject } = bind();

        handlers.error('error', failedSegment(410, 'none'));

        expect(reject).toHaveBeenCalledWith(MediaError.SERVER_ERROR);
        expect(errors).toEqual([]);
        expect(instance.lastPlaybackFailure).toEqual({
            positionMs: 143760,
            transcodeRecovery: 'none'
        });
    });

    it('records the position before the player is torn down', async () => {
        const { handlers, hls, elem, instance, resolve } = bind();
        // What destroying hls.js does to the element.
        hls.destroy.mockImplementation(() => {
            elem.currentTime = 0;
        });

        handlers.manifestParsed('manifestParsed');
        await vi.waitFor(() => expect(resolve).toHaveBeenCalled());
        handlers.error('error', failedSegment(410, 'software'));

        expect(
            (instance.lastPlaybackFailure as { positionMs: number }).positionMs
        ).toBe(143760);
    });

    it('an ordinary server error carries no recovery offer', async () => {
        const { handlers, instance, errors, resolve } = bind();

        handlers.manifestParsed('manifestParsed');
        await vi.waitFor(() => expect(resolve).toHaveBeenCalled());
        handlers.error('error', failedSegment(500));

        expect(errors).toEqual([{ type: MediaError.SERVER_ERROR }]);
        expect(
            (instance.lastPlaybackFailure as { transcodeRecovery: unknown })
                .transcodeRecovery
        ).toBeNull();
    });
});
