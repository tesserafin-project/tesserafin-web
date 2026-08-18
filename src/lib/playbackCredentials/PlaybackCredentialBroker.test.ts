/**
 * #153-A1 — the credential broker's permanent unit coverage.
 *
 * Fake timers throughout. Not one test sleeps: a scheduling test that waits on wall-clock time is
 * either slow or flaky, and usually both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    PlaybackCredentialBroker,
    PlaybackCredentialError,
    RENEWAL_WINDOW_MS,
    type BrokerDependencies,
    type CapabilityDemand
} from './PlaybackCredentialBroker';
import { authorityKey, canonicalScopes } from './identity';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

interface Harness {
    broker: PlaybackCredentialBroker;
    mint: ReturnType<typeof vi.fn>;
    renew: ReturnType<typeof vi.fn>;
    ticket: ReturnType<typeof vi.fn>;
    setToken: (token: string) => void;
    setUser: (userId: string) => void;
    setDevice: (deviceId: string) => void;
    setServer: (serverId: string) => void;
}

let issued = 0;

function harness(overrides: Partial<BrokerDependencies> = {}): Harness {
    let token = 'token-1';
    let userId = 'user-1';
    let deviceId = 'device-1';
    let serverId = 'server-1';

    const mint = vi.fn(async () => {
        issued += 1;
        return {
            CapabilityId: `cap-${issued}`,
            Value: `value-${issued}`,
            IssuedAt: new Date(Date.now()).toISOString(),
            ExpiresAt: new Date(Date.now() + FIFTEEN_MINUTES).toISOString(),
            Scopes: [],
            PlaySessionId: 'ps'
        };
    });
    const renew = vi.fn(async (capabilityId: string) => ({
        CapabilityId: capabilityId,
        IssuedAt: new Date(Date.now()).toISOString(),
        ExpiresAt: new Date(Date.now() + FIFTEEN_MINUTES).toISOString()
    }));
    const ticket = vi.fn(async () => {
        issued += 1;
        return {
            TicketId: `ticket-${issued}`,
            Value: `ticket-value-${issued}`,
            IssuedAt: new Date(Date.now()).toISOString(),
            ExpiresAt: new Date(Date.now() + 60_000).toISOString()
        };
    });

    const broker = new PlaybackCredentialBroker({
        serverId: () => serverId,
        userId: () => userId,
        deviceId: () => deviceId,
        accessToken: () => token,
        mintCapability: mint as never,
        renewCapability: renew as never,
        mintWebSocketTicket: ticket as never,
        now: () => Date.now(),
        ...overrides
    });

    return {
        broker,
        mint,
        renew,
        ticket,
        setToken: (next) => {
            token = next;
        },
        setUser: (next) => {
            userId = next;
        },
        setDevice: (next) => {
            deviceId = next;
        },
        setServer: (next) => {
            serverId = next;
        }
    };
}

const mediaDemand = (
    overrides: Partial<CapabilityDemand> = {}
): CapabilityDemand => ({
    scopes: ['Media'],
    itemId: 'item-1',
    mediaSourceId: 'ms-1',
    playSessionId: 'ps-1',
    ...overrides
});

beforeEach(() => {
    issued = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'));
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('cache identity', () => {
    it('every authority dimension is part of the key', () => {
        const base = {
            serverId: 's',
            userId: 'u',
            sessionEpoch: 0,
            deviceId: 'd',
            playSessionId: 'p',
            itemId: 'i',
            mediaSourceId: 'm',
            scopes: ['Media'] as const
        };
        const baseline = authorityKey(base);
        const mutations = [
            { ...base, serverId: 's2' },
            { ...base, userId: 'u2' },
            { ...base, sessionEpoch: 1 },
            { ...base, deviceId: 'd2' },
            { ...base, playSessionId: 'p2' },
            { ...base, itemId: 'i2' },
            { ...base, mediaSourceId: 'm2' },
            { ...base, scopes: ['Subtitles'] as const }
        ];
        for (const mutated of mutations) {
            expect(authorityKey(mutated)).not.toBe(baseline);
        }
        // Every dimension mutated on its own produced a DISTINCT key, so no two dimensions are
        // collapsed into one.
        expect(new Set(mutations.map(authorityKey)).size).toBe(
            mutations.length
        );
    });

    it('null is a value, not a wildcard', () => {
        const base = {
            serverId: 's',
            userId: 'u',
            sessionEpoch: 0,
            deviceId: 'd',
            playSessionId: 'p',
            itemId: null,
            mediaSourceId: null,
            scopes: ['Media'] as const
        };
        expect(authorityKey({ ...base, itemId: 'null' })).not.toBe(
            authorityKey(base)
        );
        expect(authorityKey({ ...base, mediaSourceId: '' })).not.toBe(
            authorityKey(base)
        );
    });

    it('separator injection cannot forge a different authority', () => {
        const a = authorityKey({
            serverId: 's|u',
            userId: 'x',
            sessionEpoch: 0,
            deviceId: 'd',
            playSessionId: 'p',
            itemId: 'i',
            mediaSourceId: 'm',
            scopes: ['Media']
        });
        const b = authorityKey({
            serverId: 's',
            userId: 'u|x',
            sessionEpoch: 0,
            deviceId: 'd',
            playSessionId: 'p',
            itemId: 'i',
            mediaSourceId: 'm',
            scopes: ['Media']
        });
        expect(a).not.toBe(b);
    });

    it('scopes are canonicalised', () => {
        expect(canonicalScopes(['Media', 'Media'])).toEqual(['Media']);
        expect(canonicalScopes(['Subtitles', 'Media'])).toEqual([
            'Media',
            'Subtitles'
        ]);
    });
});

describe('minting', () => {
    it('resolves a capability before any url is built', async () => {
        const h = harness();
        const held = await h.broker.capability(mediaDemand());
        expect(held.value).toBe('value-1');
        expect(held.expiresAt).toBe(Date.now() + FIFTEEN_MINUTES);
        expect(h.mint).toHaveBeenCalledTimes(1);
    });

    it('mints the minimum scope set and omits an absent binding', async () => {
        const h = harness();
        await h.broker.capability({
            scopes: ['Fonts'],
            itemId: null,
            mediaSourceId: null,
            playSessionId: 'ps-1'
        });
        const request = h.mint.mock.calls[0][0];
        expect(request.Scopes).toEqual(['Fonts']);
        // Omitted, not null: an item-less family must not name an item at all.
        expect('ItemId' in request).toBe(false);
        expect('MediaSourceId' in request).toBe(false);
    });

    it('a null media source is a separate capability, not a widened one', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand());
        await h.broker.capability(mediaDemand({ mediaSourceId: null }));
        expect(h.mint).toHaveBeenCalledTimes(2);
        expect(h.broker.heldCount).toBe(2);
    });

    it('reuses a live capability for an identical authority', async () => {
        const h = harness();
        const first = await h.broker.capability(mediaDemand());
        const second = await h.broker.capability(mediaDemand());
        expect(second.value).toBe(first.value);
        expect(h.mint).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent mints only for an identical authority', async () => {
        const h = harness();
        const [a, b, c] = await Promise.all([
            h.broker.capability(mediaDemand()),
            h.broker.capability(mediaDemand()),
            h.broker.capability(mediaDemand({ itemId: 'item-2' }))
        ]);
        expect(a.value).toBe(b.value);
        expect(c.value).not.toBe(a.value);
        expect(h.mint).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['user', (h: Harness) => h.setUser('user-2')],
        ['device', (h: Harness) => h.setDevice('device-2')],
        ['server', (h: Harness) => h.setServer('server-2')],
        ['session', (h: Harness) => h.setToken('token-2')]
    ])('separates capabilities across %s', async (_name, change) => {
        const h = harness();
        const first = await h.broker.capability(mediaDemand());
        change(h);
        const second = await h.broker.capability(mediaDemand());
        expect(second.value).not.toBe(first.value);
        expect(h.mint).toHaveBeenCalledTimes(2);
    });

    it('separates capabilities across play sessions', async () => {
        const h = harness();
        const first = await h.broker.capability(mediaDemand());
        const second = await h.broker.capability(
            mediaDemand({ playSessionId: 'ps-2' })
        );
        expect(second.value).not.toBe(first.value);
        expect(h.broker.heldCount).toBe(2);
    });

    it('a token change discards every previously held capability', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand());
        expect(h.broker.heldCount).toBe(1);
        h.setToken('token-2');
        await h.broker.capability(mediaDemand());
        // The old entry is gone, not merely unreachable.
        expect(h.broker.heldCount).toBe(1);
    });
});

describe('renewal', () => {
    it('does not renew before the final window', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand());
        await vi.advanceTimersByTimeAsync(
            FIFTEEN_MINUTES - RENEWAL_WINDOW_MS - 1000
        );
        expect(h.renew).not.toHaveBeenCalled();
    });

    it('renews once the final window is entered, without rotating the secret', async () => {
        const h = harness();
        const held = await h.broker.capability(mediaDemand());
        await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES - RENEWAL_WINDOW_MS);
        expect(h.renew).toHaveBeenCalledTimes(1);
        expect(h.renew).toHaveBeenCalledWith(held.capabilityId);

        const after = await h.broker.capability(mediaDemand());
        // Same secret, later expiry: nothing is rebuilt and no url changes.
        expect(after.value).toBe(held.value);
        expect(after.expiresAt).toBeGreaterThan(held.expiresAt);
        expect(h.mint).toHaveBeenCalledTimes(1);
    });

    it('renews again when the next window is entered', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand());
        await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES - RENEWAL_WINDOW_MS);
        await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES - RENEWAL_WINDOW_MS);
        expect(h.renew).toHaveBeenCalledTimes(2);
    });

    it('fails closed when renewal is refused — no re-mint, no fallback', async () => {
        const h = harness();
        h.renew.mockRejectedValueOnce(new Error('PlaybackCapabilityRevoked'));
        await h.broker.capability(mediaDemand());
        await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES - RENEWAL_WINDOW_MS);

        await expect(h.broker.capability(mediaDemand())).rejects.toBeInstanceOf(
            PlaybackCredentialError
        );
        expect(h.mint).toHaveBeenCalledTimes(1);
    });

    it('fails closed on expiry rather than silently re-minting', async () => {
        const h = harness();
        h.renew.mockRejectedValue(new Error('refused'));
        await h.broker.capability(mediaDemand());
        await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES + 1000);
        await expect(h.broker.capability(mediaDemand())).rejects.toBeInstanceOf(
            PlaybackCredentialError
        );
        expect(h.mint).toHaveBeenCalledTimes(1);
    });
});

describe('teardown', () => {
    it('releasing a play session cancels its renewals and keeps the others', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand());
        await h.broker.capability(mediaDemand({ playSessionId: 'ps-2' }));
        h.broker.releasePlaySession('ps-1');
        expect(h.broker.heldCount).toBe(1);

        await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES - RENEWAL_WINDOW_MS);
        // Only the surviving play session renewed.
        expect(h.renew).toHaveBeenCalledTimes(1);
    });

    it('dispose cancels every renewal and refuses further work', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand());
        h.broker.dispose();
        await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES);
        expect(h.renew).not.toHaveBeenCalled();
        await expect(h.broker.capability(mediaDemand())).rejects.toBeInstanceOf(
            PlaybackCredentialError
        );
        await expect(h.broker.webSocketTicket()).rejects.toBeInstanceOf(
            PlaybackCredentialError
        );
    });

    it('discardAll drops everything without disposing the broker', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand());
        h.broker.discardAll();
        expect(h.broker.heldCount).toBe(0);
        await expect(h.broker.capability(mediaDemand())).resolves.toBeTruthy();
    });
});

describe('websocket tickets', () => {
    it('mints a distinct ticket for every attempt', async () => {
        const h = harness();
        const first = await h.broker.webSocketTicket();
        const second = await h.broker.webSocketTicket();
        expect(second).not.toBe(first);
        expect(h.ticket).toHaveBeenCalledTimes(2);
    });

    it('does not share a ticket between concurrent attempts', async () => {
        const h = harness();
        const [a, b] = await Promise.all([
            h.broker.webSocketTicket(),
            h.broker.webSocketTicket()
        ]);
        expect(a).not.toBe(b);
        expect(h.ticket).toHaveBeenCalledTimes(2);
    });

    it('mints nothing for a credential-less attempt', async () => {
        const h = harness();
        h.setToken('');
        await expect(h.broker.webSocketTicket()).rejects.toBeInstanceOf(
            PlaybackCredentialError
        );
        expect(h.ticket).not.toHaveBeenCalled();
    });
});
