import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const castWindow = window as Window & {
    appMode?: string;
    chrome?: { cast?: { isAvailable: boolean } };
};
const scripts = () => [
    ...document.querySelectorAll<HTMLScriptElement>(
        'script[src*="gstatic.com"]'
    )
];

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    delete castWindow.chrome;
    delete castWindow.appMode;
});
afterEach(() => {
    scripts().forEach((s) => {
        s.remove();
    });
    vi.useRealTimers();
});

describe('on-demand Cast SDK loader', () => {
    it('does nothing on module import or construction', async () => {
        const { default: Sender } = await import(
            '../../src/plugins/chromecastPlayer/castSenderApi'
        );
        new Sender();
        expect(scripts()).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('shares one request across instances and waits beyond script onload for SDK readiness', async () => {
        const { default: Sender } = await import(
            '../../src/plugins/chromecastPlayer/castSenderApi'
        );
        const first = new Sender().load();
        const second = new Sender().load();
        expect(second).toBe(first);
        expect(scripts()).toHaveLength(1);
        let ready = false;
        first.then(() => {
            ready = true;
        });
        scripts()[0].dispatchEvent(new Event('load'));
        await vi.advanceTimersByTimeAsync(100);
        expect(ready).toBe(false);
        castWindow.chrome = { cast: { isAvailable: true } };
        await vi.advanceTimersByTimeAsync(25);
        await expect(first).resolves.toBeUndefined();
        await new Sender().load();
        expect(scripts()).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('rejects blocked scripts, cleans up and retries only on another explicit call', async () => {
        const { default: Sender } = await import(
            '../../src/plugins/chromecastPlayer/castSenderApi'
        );
        const failure = expect(new Sender().load()).rejects.toThrow(
            'unavailable'
        );
        scripts()[0].dispatchEvent(new Event('error'));
        await failure;
        expect(scripts()).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(scripts()).toHaveLength(0);
        const retry = new Sender().load();
        expect(scripts()).toHaveLength(1);
        castWindow.chrome = { cast: { isAvailable: true } };
        await vi.advanceTimersByTimeAsync(25);
        await retry;
    });
    it('bounds both a stalled download and a loaded script without an SDK', async () => {
        const { default: Sender } = await import(
            '../../src/plugins/chromecastPlayer/castSenderApi'
        );
        for (const loaded of [false, true]) {
            const failure = expect(new Sender().load()).rejects.toThrow(
                'timed out'
            );
            if (loaded) scripts()[0].dispatchEvent(new Event('load'));
            await vi.advanceTimersByTimeAsync(5000);
            await failure;
            expect(scripts()).toHaveLength(0);
            expect(vi.getTimerCount()).toBe(0);
        }
    });
    it.each(['cordova', 'android'])(
        'preserves the %s bridge without a Google request',
        async (mode) => {
            castWindow.appMode = mode;
            const { default: Sender } = await import(
                '../../src/plugins/chromecastPlayer/castSenderApi'
            );
            await new Sender().load();
            expect(scripts()).toHaveLength(0);
        }
    );
});

describe('bounded receiver initialization', () => {
    it.each([true, false])(
        'waits for initialization and first availability, in either order (%s)',
        async (availabilityFirst) => {
            const { waitForCastPlayer } = await import(
                '../../src/plugins/chromecastPlayer/castSenderApi'
            );
            const player = {
                isInitialized: false,
                receiverAvailabilityKnown: false
            };
            let ready = false;
            const pending = waitForCastPlayer(player).then(() => {
                ready = true;
            });
            if (availabilityFirst) player.receiverAvailabilityKnown = true;
            else player.isInitialized = true;
            await vi.advanceTimersByTimeAsync(50);
            expect(ready).toBe(false);
            player.receiverAvailabilityKnown = player.isInitialized = true;
            await vi.advanceTimersByTimeAsync(25);
            await pending;
            expect(vi.getTimerCount()).toBe(0);
        }
    );
    it('cancels disposed/failed players and bounds missing callbacks', async () => {
        const { waitForCastPlayer } = await import(
            '../../src/plugins/chromecastPlayer/castSenderApi'
        );
        for (const player of [
            { _disposed: true },
            { initializationFailed: true },
            {}
        ]) {
            const failure = expect(waitForCastPlayer(player)).rejects.toThrow(
                /unavailable|timed out/
            );
            await vi.advanceTimersByTimeAsync(5000);
            await failure;
            expect(vi.getTimerCount()).toBe(0);
        }
    });
});
