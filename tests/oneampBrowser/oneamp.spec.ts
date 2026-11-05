import { expect, type Page, test } from '@playwright/test';

/**
 * OneAmp demonstrator, browser proof (contract §9.3 step 5, §9.5). The real player plays WAV
 * fixtures; an analyser tap after the gain node measures what reaches the destination.
 */

const FLAG = 'tesserafin.experimental.oneamp';

type Harness = {
    settings: { normalisation: string };
    play(url: string, o?: Record<string, unknown>): Promise<void>;
    element(): HTMLAudioElement;
    state(): Record<string, unknown> | null;
    graphInfo(): { captured: boolean; route: string; gain: number } | null;
    host(): {
        setBypass(on: boolean): void;
        setParams(p: Record<string, unknown>): void;
    } | null;
    recordPosts(): boolean;
    posted(): string[];
    rms(ms?: number): Promise<{ left: number; right: number } | null>;
    binDb(hz: number, ms?: number): Promise<number | null>;
};

async function open(page: Page, flag: boolean) {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    await page.addInitScript(
        ([key, on]) => {
            if (on) localStorage.setItem(key as string, '1');
            else localStorage.removeItem(key as string);
        },
        [FLAG, flag]
    );
    await page.goto('/index.html');
    await page.waitForFunction(() => 'oneampHarness' in window);
    return requests;
}

const h = <T>(page: Page, fn: (h: Harness) => T | Promise<T>) =>
    page.evaluate(`(${fn.toString()})(window.oneampHarness)`) as Promise<T>;

async function play(page: Page, file: string, o: Record<string, unknown> = {}) {
    await page.evaluate(
        ([f, opts]) =>
            (
                window as unknown as { oneampHarness: Harness }
            ).oneampHarness.play(f as string, opts as Record<string, unknown>),
        [file, o]
    );
}

async function waitState(page: Page, state: string) {
    await expect
        .poll(() => h(page, (x) => x.state()?.state ?? null), {
            timeout: 10_000
        })
        .toBe(state);
}

/** Past the start of playback, so a baseline is not taken over the first, quiet frames. */
async function waitPlaying(page: Page, seconds = 1) {
    await expect
        .poll(() => h(page, (x) => x.element().currentTime), {
            timeout: 10_000
        })
        .toBeGreaterThan(seconds);
}

/**
 * Measurements need a rendering context. Without an audio output device (a CI runner)
 * Firefox never renders, and every RMS reads 0: fail on that cause, not on a level.
 */
async function expectRendering(page: Page) {
    // `resume()` runs on the element's play event (contract L6) and settles
    // asynchronously; a context still suspended after 5 s is a failure.
    await expect
        .poll(
            () =>
                page.evaluate(() =>
                    (
                        window as unknown as {
                            oneampHarness: { contextState(): string | null };
                        }
                    ).oneampHarness.contextState()
                ),
            {
                timeout: 5000,
                message:
                    'AudioContext must be running (is there an audio output device?)'
            }
        )
        .toBe('running');
    const t0 = await h(page, (x) => x.element().currentTime);
    await page.waitForTimeout(300);
    const t1 = await h(page, (x) => x.element().currentTime);
    expect(t1, 'media must be playing').toBeGreaterThan(t0);
}

async function rms(page: Page, ms = 600) {
    await expectRendering(page);
    // Let ramps (parameter smoothing) settle before measuring.
    await page.waitForTimeout(300);
    const r = await page.evaluate(
        (d) =>
            (window as unknown as { oneampHarness: Harness }).oneampHarness.rms(
                d
            ),
        ms
    );
    if (!r) throw new Error('no analyser tap');
    return r;
}

const oneampAssets = (paths: string[]) =>
    paths.filter((p) => /oneamp_wasm|oneampWorklet/.test(p));

test.describe('flag off: unchanged', () => {
    test('no OneAmp request and no graph', async ({ page }) => {
        const requests = await open(page, false);
        await play(page, 'stereo.wav');
        await page.waitForTimeout(1000);
        expect(oneampAssets(requests)).toEqual([]);
        expect(await h(page, (x) => x.graphInfo())).toBeNull();
        expect(await h(page, (x) => x.element().paused)).toBe(false);
    });

    test('flag on, transcode item: no OneAmp request and no graph', async ({
        page
    }) => {
        const requests = await open(page, true);
        await play(page, 'stereo.wav', { playMethod: 'Transcode' });
        await page.waitForTimeout(1000);
        expect(oneampAssets(requests)).toEqual([]);
        expect(await h(page, (x) => x.graphInfo())).toBeNull();
    });
});

test.describe('flag on, Direct Play', () => {
    test('routes through OneAmp; bypass vs -6.02 dB preamp halves the RMS', async ({
        page
    }) => {
        const requests = await open(page, true);
        await play(page, 'stereo.wav');
        await waitState(page, 'active');
        // The wasm fetch is a page request. Chromium does not report the
        // worklet's addModule fetch to page.on('request'), Firefox does.
        expect(requests.some((p) => /oneamp_wasm/.test(p))).toBe(true);
        expect(await h(page, (x) => x.graphInfo()?.route)).toBe('oneamp');

        // The transparent chain (default parameters) is a pure delay: same level.
        const active = await rms(page);
        expect(active.left).toBeCloseTo(0.354, 2);
        expect(active.right).toBeCloseTo(0.354, 2);

        await h(page, (x) => x.host()?.setBypass(true));
        await waitState(page, 'bypassed');
        expect(await h(page, (x) => x.graphInfo()?.route)).toBe('bypass');
        const bypass = await rms(page);

        await h(page, (x) => x.host()?.setBypass(false));
        await waitState(page, 'active');
        await h(page, (x) => x.host()?.setParams({ preamp: -6.0206 }));
        const preamp = await rms(page);

        // A 1 kHz sine at amplitude 0.5: RMS ~0.354 unprocessed.
        expect(bypass.left).toBeCloseTo(0.354, 2);
        expect(bypass.left / preamp.left).toBeGreaterThan(1.9);
        expect(bypass.left / preamp.left).toBeLessThan(2.1);
        expect(bypass.right / preamp.right).toBeGreaterThan(1.9);
        expect(bypass.right / preamp.right).toBeLessThan(2.1);
    });

    test('in-chain volume 0.5 halves the RMS', async ({ page }) => {
        await open(page, true);
        await play(page, 'stereo.wav');
        await waitState(page, 'active');
        await waitPlaying(page);
        const unity = await rms(page);
        await h(page, (x) => x.host()?.setParams({ volume: 0.5 }));
        const half = await rms(page);
        expect(unity.left / half.left).toBeGreaterThan(1.9);
        expect(unity.left / half.left).toBeLessThan(2.1);
    });

    test('EQ +12 dB on the 1 kHz band raises the 1 kHz bin', async ({
        page
    }) => {
        await open(page, true);
        await play(page, 'stereo.wav');
        await waitState(page, 'active');
        await page.waitForTimeout(300);
        const flat = await h(page, (x) => x.binDb(1000));
        await h(page, (x) => {
            const bands = [0, 0, 0, 0, 0, 12, 0, 0, 0, 0];
            x.host()?.setParams({ eqEnabled: true, eqBands: bands });
        });
        await page.waitForTimeout(500);
        const boosted = await h(page, (x) => x.binDb(1000));
        expect((boosted as number) - (flat as number)).toBeGreaterThan(6);
    });

    test('a mono source reaches both channels with equal energy', async ({
        page
    }) => {
        await open(page, true);
        await play(page, 'mono.wav');
        await waitState(page, 'active');
        const r = await rms(page);
        expect(r.left).toBeGreaterThan(0.2);
        expect(Math.abs(r.left - r.right) / r.left).toBeLessThan(0.02);
    });

    test('a 5.1 source with signal only on the centre reaches both channels', async ({
        page
    }) => {
        await open(page, true);
        await play(page, 'centre51.wav');
        await waitState(page, 'active');
        const r = await rms(page);
        // Centre folded at -3 dB: 0.354 x 0.707 ~ 0.25 in each channel.
        expect(r.left).toBeGreaterThan(0.15);
        expect(Math.abs(r.left - r.right) / r.left).toBeLessThan(0.02);
    });

    test('seeking posts reset', async ({ page }) => {
        await open(page, true);
        await play(page, 'stereo.wav');
        await waitState(page, 'active');
        expect(await h(page, (x) => x.recordPosts())).toBe(true);
        await h(page, (x) => {
            x.element().currentTime = 10;
        });
        await expect
            .poll(() => h(page, (x) => x.posted()), { timeout: 5000 })
            .toContain('reset');
        expect(await h(page, (x) => x.element().paused)).toBe(false);
    });
});

test.describe('fallback', () => {
    test('a wasm that fails to load leaves audio audible at the expected gain', async ({
        page
    }) => {
        await page.route(/oneamp_wasm.*\.wasm$/, (route) =>
            route.fulfill({ status: 404, body: 'gone' })
        );
        await open(page, true);
        await h(page, (x) => {
            x.settings.normalisation = 'TrackGain';
        });
        await play(page, 'stereo.wav', { normalizationGain: -6.0206 });
        await waitState(page, 'failed');
        expect(await h(page, (x) => x.state()?.reason)).toBe('compile');
        const g = await h(page, (x) => x.graphInfo());
        expect(g?.route).toBe('bypass');
        expect(g?.gain).toBeCloseTo(0.5, 2);
        const r = await rms(page);
        // Audible, at the normalised level (0.354 x 0.5).
        expect(r.left).toBeGreaterThan(0.15);
        expect(r.left).toBeLessThan(0.2);
    });
});
