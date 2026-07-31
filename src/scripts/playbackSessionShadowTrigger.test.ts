import type { Api } from '@jellyfin/sdk';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type Mock
} from 'vitest';

import type { ShadowPlaybackSessionParams } from './playbackSessionShadow';
import { triggerShadowPlaybackSession } from './playbackSessionShadowTrigger';

/**
 * Tests the lazy-load gate in isolation, mirroring `playbackSessionShadow.test.ts`'s injectable-seam
 * pattern: `loadShadowModule` stands in for the real `import('./playbackSessionShadow')` (PR116e) so
 * these tests exercise the gate/wiring without depending on webpack's own code-splitting behavior.
 *
 * The property under test (PR116e's whole point): when the flag is off, `loadShadowModule` must
 * never be called at all - that's what keeps `playback-shadow.chunk.js` out of the network, not just
 * out of the main bundle.
 */
const baseParams: ShadowPlaybackSessionParams = {
    api: {} as Api,
    itemId: 'item-1',
    userId: 'user-1',
    mediaSourceId: 'media-source-1'
};

describe('triggerShadowPlaybackSession()', () => {
    let logger: { debug: Mock<(...args: unknown[]) => void> };

    beforeEach(() => {
        logger = { debug: vi.fn<(...args: unknown[]) => void>() };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('never loads the shadow module when the flag is off', () => {
        const loadShadowModule = vi.fn();

        triggerShadowPlaybackSession(baseParams, {
            isEnabled: () => false,
            loadShadowModule,
            logger
        });

        expect(loadShadowModule).not.toHaveBeenCalled();
        expect(logger.debug).not.toHaveBeenCalled();
    });

    it('loads the shadow module and delegates to sendShadowPlaybackSession() when the flag is on', async () => {
        const sendShadowPlaybackSession = vi.fn().mockResolvedValue(undefined);
        const loadShadowModule = vi
            .fn()
            .mockResolvedValue({ sendShadowPlaybackSession });
        const shadowDeps = { isEnabled: () => true };

        triggerShadowPlaybackSession(baseParams, {
            isEnabled: () => true,
            loadShadowModule,
            shadowDeps,
            logger
        });

        expect(loadShadowModule).toHaveBeenCalledOnce();
        // The dynamic import + delegation is fire-and-forget from the caller's perspective - flush
        // the microtask queue the same way the caller's un-awaited call site does.
        await vi.waitFor(() => {
            expect(sendShadowPlaybackSession).toHaveBeenCalledWith(
                baseParams,
                shadowDeps
            );
        });
    });

    it('does not throw and logs when the dynamic import() itself fails (e.g. offline/CDN hiccup)', async () => {
        const loadShadowModule = vi
            .fn()
            .mockRejectedValue(new Error('ChunkLoadError'));

        expect(() =>
            triggerShadowPlaybackSession(baseParams, {
                isEnabled: () => true,
                loadShadowModule,
                logger
            })
        ).not.toThrow();

        await vi.waitFor(() => {
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('failed to load the shadow module'),
                expect.any(Error)
            );
        });
    });

    it('defaults isEnabled to appSettings.enablePlaybackSessionShadow() (off by default)', () => {
        const loadShadowModule = vi.fn();

        // No `isEnabled` override: exercises the real default, which reads the real (unmocked)
        // appSettings flag - default off, per `settings/appSettings.js`.
        triggerShadowPlaybackSession(baseParams, { loadShadowModule, logger });

        expect(loadShadowModule).not.toHaveBeenCalled();
    });
});
