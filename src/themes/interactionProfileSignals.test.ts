/**
 * Coverage for the profile signal layer (`./interactionProfileSignals.ts`).
 *
 * What is proved here is *subscription and teardown* — that each signal maps to the right profile,
 * that a change re-emits, and that nothing survives unsubscribe. What a profile then does to the
 * page is not asserted here (jsdom has no `backdrop-filter` and no custom-property substitution);
 * that is `tests/e2e/glass-interaction-profiles.spec.ts`, in a real browser.
 *
 * The media queries and the battery are faked, deliberately and only here: they are *inputs* to the
 * system, and there is no way to make a headless Node process genuinely run low on battery. The
 * CSSOM is never faked anywhere.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    subscribeToProfileSignals,
    TV_LAYOUT_CLASS
} from './interactionProfileSignals';

interface FakeQuery {
    matches: boolean;
    media: string;
    listeners: Set<() => void>;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
    fire: () => void;
}

const queries = new Map<string, FakeQuery>();

const fakeQuery = (media: string): FakeQuery => {
    const listeners = new Set<() => void>();
    const query: FakeQuery = {
        matches: false,
        media,
        listeners,
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener),
        fire: () => {
            for (const listener of [...listeners]) listener();
        }
    };
    return query;
};

const queryFor = (media: string): FakeQuery => {
    const existing = queries.get(media);
    if (!existing) throw new Error(`query not requested: ${media}`);
    return existing;
};

interface FakeBattery {
    charging: boolean;
    level: number;
    listeners: Map<string, Set<() => void>>;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
    fire: (type: string) => void;
}

const makeBattery = (charging: boolean, level: number): FakeBattery => {
    const listeners = new Map<string, Set<() => void>>();
    return {
        charging,
        level,
        listeners,
        addEventListener: (type, listener) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)?.add(listener);
        },
        removeEventListener: (type, listener) => {
            listeners.get(type)?.delete(listener);
        },
        fire: (type) => {
            for (const listener of [...(listeners.get(type) ?? [])]) listener();
        }
    };
};

const TRANSPARENCY = '(prefers-reduced-transparency: reduce)';
const MOTION = '(prefers-reduced-motion: reduce)';
const SLOW_UPDATE = '(update: slow)';

/** Total listeners still attached across every fake query. */
const attachedQueryListeners = (): number =>
    [...queries.values()].reduce(
        (total, query) => total + query.listeners.size,
        0
    );

beforeEach(() => {
    queries.clear();
    vi.stubGlobal(
        'matchMedia',
        vi.fn((media: string) => {
            if (!queries.has(media)) queries.set(media, fakeQuery(media));
            return queries.get(media);
        })
    );
    document.documentElement.classList.remove(TV_LAYOUT_CLASS);
});

/** `MutationObserver` callbacks are delivered as a microtask, so let the queue drain. */
const flushMutations = () => new Promise((done) => setTimeout(done, 0));

describe('subscribeToProfileSignals', () => {
    it('emits the full profile set immediately on subscription', () => {
        const onChange = vi.fn();

        const unsubscribe = subscribeToProfileSignals(onChange);

        expect(onChange).toHaveBeenCalledWith({
            remote: false,
            lowPower: false,
            reducedTransparency: false,
            reducedMotion: false
        });
        unsubscribe();
    });

    it.each([
        [TRANSPARENCY, 'reducedTransparency'],
        [MOTION, 'reducedMotion'],
        [SLOW_UPDATE, 'lowPower']
    ])('maps %s to the %s profile, reversibly', (media, profile) => {
        const onChange = vi.fn();
        const unsubscribe = subscribeToProfileSignals(onChange);

        queryFor(media).matches = true;
        queryFor(media).fire();
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ [profile]: true })
        );

        // Reversible at run time: the signal going away must put the profile back, with no
        // reload and no stored state to clear.
        queryFor(media).matches = false;
        queryFor(media).fire();
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ [profile]: false })
        );

        unsubscribe();
    });

    it('maps the TV layout class to the remote profile, and follows changes', async () => {
        const onChange = vi.fn();
        const unsubscribe = subscribeToProfileSignals(onChange);

        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ remote: false })
        );

        document.documentElement.classList.add(TV_LAYOUT_CLASS);
        await flushMutations();
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ remote: true })
        );

        document.documentElement.classList.remove(TV_LAYOUT_CLASS);
        await flushMutations();
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ remote: false })
        );

        unsubscribe();
    });

    it('reads a TV layout that was already applied before subscribing', async () => {
        // The class-based signal has no ordering requirement against layout boot, unlike an
        // event-based one which would miss a `modechange` fired before this subscription existed.
        document.documentElement.classList.add(TV_LAYOUT_CLASS);

        const onChange = vi.fn();
        const unsubscribe = subscribeToProfileSignals(onChange);

        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ remote: true })
        );
        unsubscribe();
    });

    it('combines signals cumulatively rather than last-writer-wins', async () => {
        const onChange = vi.fn();
        const unsubscribe = subscribeToProfileSignals(onChange);

        document.documentElement.classList.add(TV_LAYOUT_CLASS);
        await flushMutations();
        queryFor(SLOW_UPDATE).matches = true;
        queryFor(SLOW_UPDATE).fire();

        expect(onChange).toHaveBeenLastCalledWith({
            remote: true,
            lowPower: true,
            reducedTransparency: false,
            reducedMotion: false
        });

        unsubscribe();
    });

    it('removes every listener on unsubscribe', async () => {
        const onChange = vi.fn();

        const unsubscribe = subscribeToProfileSignals(onChange);
        expect(attachedQueryListeners()).toBe(3);

        unsubscribe();

        expect(attachedQueryListeners()).toBe(0);

        // And the layout observer is disconnected too: neither a class change nor a query change
        // after teardown may reach the consumer.
        onChange.mockClear();
        document.documentElement.classList.add(TV_LAYOUT_CLASS);
        await flushMutations();
        queryFor(TRANSPARENCY).matches = true;
        queryFor(TRANSPARENCY).fire();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('survives a missing matchMedia by leaving those profiles inactive', () => {
        vi.stubGlobal('matchMedia', undefined);

        const onChange = vi.fn();
        const unsubscribe = subscribeToProfileSignals(onChange);

        expect(onChange).toHaveBeenCalledWith({
            remote: false,
            lowPower: false,
            reducedTransparency: false,
            reducedMotion: false
        });
        expect(() => unsubscribe()).not.toThrow();
    });

    describe('battery', () => {
        it('reports lowPower while discharging at or below the threshold', async () => {
            const battery = makeBattery(false, 0.2);
            vi.stubGlobal('navigator', {
                ...navigator,
                getBattery: () => Promise.resolve(battery)
            });

            const onChange = vi.fn();
            const unsubscribe = subscribeToProfileSignals(onChange);
            await vi.waitFor(() =>
                expect(onChange).toHaveBeenLastCalledWith(
                    expect.objectContaining({ lowPower: true })
                )
            );

            // Plugging in reverses it, without any query changing.
            battery.charging = true;
            battery.fire('chargingchange');
            expect(onChange).toHaveBeenLastCalledWith(
                expect.objectContaining({ lowPower: false })
            );

            unsubscribe();
            expect(battery.listeners.get('levelchange')?.size ?? 0).toBe(0);
            expect(battery.listeners.get('chargingchange')?.size ?? 0).toBe(0);
        });

        it('does not report lowPower on a charging or well-charged battery', async () => {
            const battery = makeBattery(false, 0.8);
            vi.stubGlobal('navigator', {
                ...navigator,
                getBattery: () => Promise.resolve(battery)
            });

            const onChange = vi.fn();
            const unsubscribe = subscribeToProfileSignals(onChange);
            await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

            expect(onChange).toHaveBeenLastCalledWith(
                expect.objectContaining({ lowPower: false })
            );
            unsubscribe();
        });

        it('attaches nothing when the probe resolves after unsubscribe', async () => {
            // The probe is async, so it can settle after teardown. Attaching then would leak two
            // listeners the (already-run) unsubscribe can never remove, and would push profile
            // state onto an unmounted consumer.
            const battery = makeBattery(false, 0.05);
            let resolveProbe: (value: FakeBattery) => void = () => undefined;
            vi.stubGlobal('navigator', {
                ...navigator,
                getBattery: () =>
                    new Promise<FakeBattery>((resolve) => {
                        resolveProbe = resolve;
                    })
            });

            const onChange = vi.fn();
            const unsubscribe = subscribeToProfileSignals(onChange);
            unsubscribe();
            onChange.mockClear();

            resolveProbe(battery);
            await Promise.resolve();
            await Promise.resolve();

            expect(battery.listeners.size).toBe(0);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('treats a rejected probe as "signal unavailable", not "low power"', async () => {
            vi.stubGlobal('navigator', {
                ...navigator,
                getBattery: () => Promise.reject(new Error('not allowed'))
            });

            const onChange = vi.fn();
            const unsubscribe = subscribeToProfileSignals(onChange);
            await Promise.resolve();

            expect(onChange).toHaveBeenLastCalledWith(
                expect.objectContaining({ lowPower: false })
            );

            // `(update: slow)` still works on its own.
            queryFor(SLOW_UPDATE).matches = true;
            queryFor(SLOW_UPDATE).fire();
            expect(onChange).toHaveBeenLastCalledWith(
                expect.objectContaining({ lowPower: true })
            );

            unsubscribe();
        });
    });
});
