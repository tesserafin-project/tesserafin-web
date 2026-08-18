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
    RENEWAL_SKEW_MARGIN_MS,
    RENEWAL_WINDOW_MS,
    type BrokerDependencies,
    type CapabilityDemand
} from './PlaybackCredentialBroker';
import { authorityKey, canonicalScopes } from './identity';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
/** When the renewal timer is expected to fire: inside the window, not at its edge. */
const TO_RENEWAL = FIFTEEN_MINUTES - RENEWAL_WINDOW_MS + RENEWAL_SKEW_MARGIN_MS;

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

describe('play session', () => {
    it('never sends an empty PlaySessionId — the server answers 400', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand({ playSessionId: '' }));
        const request = h.mint.mock.calls[0][0];
        expect(request.PlaySessionId).not.toBe('');
        expect(String(request.PlaySessionId).length).toBeGreaterThan(0);
    });

    it('uses ONE synthetic id per broker, so the cache still works', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand({ playSessionId: '' }));
        await h.broker.capability(mediaDemand({ playSessionId: '' }));
        expect(h.mint).toHaveBeenCalledTimes(1);
    });

    it('keeps a real play session distinct from the synthetic one', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand({ playSessionId: '' }));
        await h.broker.capability(mediaDemand({ playSessionId: 'ps-real' }));
        expect(h.mint).toHaveBeenCalledTimes(2);
        expect(h.mint.mock.calls[1][0].PlaySessionId).toBe('ps-real');
    });

    it('two brokers do not share a synthetic play session', async () => {
        const a = harness();
        const b = harness();
        await a.broker.capability(mediaDemand({ playSessionId: '' }));
        await b.broker.capability(mediaDemand({ playSessionId: '' }));
        expect(a.mint.mock.calls[0][0].PlaySessionId).not.toBe(
            b.mint.mock.calls[0][0].PlaySessionId
        );
    });
});

describe('family helpers', () => {
    it('each family mints its own minimum scope set, and no wider', async () => {
        const h = harness();
        await h.broker.mediaValue('item-1', 'ms-1', 'ps-1');
        await h.broker.rewriteSubtitle('/s?ApiKey=x', 'item-1', 'ms-1', 'ps-1');
        await h.broker.rewriteAttachment('/a', 'item-1', 'ms-1', 'ps-1');
        await h.broker.trickplayValue('item-1', 'ms-1', 'ps-1');
        await h.broker.fontsValue('ps-1');

        const scopesByCall = h.mint.mock.calls.map((c) => c[0].Scopes);
        expect(scopesByCall).toEqual([
            ['Media'],
            ['Subtitles'],
            ['Attachments'],
            ['Trickplay'],
            ['Fonts']
        ]);
        // Not one of them may name a second scope: a broadened set is a wider credential.
        for (const scopes of scopesByCall) expect(scopes).toHaveLength(1);
    });

    it('the font capability names no item and no media source', async () => {
        const h = harness();
        await h.broker.fontsValue('ps-1');
        const request = h.mint.mock.calls[0][0];
        expect('ItemId' in request).toBe(false);
        expect('MediaSourceId' in request).toBe(false);
    });

    it('a rewritten url carries the capability and neither durable key', async () => {
        const h = harness();
        const url = await h.broker.rewriteMedia(
            '/Videos/1/main.m3u8?api_key=DURABLE&ApiKey=DURABLE&MediaSourceId=ms-1',
            'item-1',
            'ms-1',
            'ps-1'
        );
        const parsed = new URL(url, 'http://example');
        expect(parsed.searchParams.get('playbackCapability')).toBe('value-1');
        expect(parsed.searchParams.has('api_key')).toBe(false);
        expect(parsed.searchParams.has('ApiKey')).toBe(false);
        // Everything the server put there that is NOT a credential survives — an HLS child url
        // inherits this query, so dropping a parameter here would drop it from every segment.
        expect(parsed.searchParams.get('MediaSourceId')).toBe('ms-1');
        expect(url).not.toContain('DURABLE');
    });
});

describe('renewal', () => {
    it('does not renew before the final window', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand());
        // One second before the window opens: nothing may have been attempted.
        await vi.advanceTimersByTimeAsync(
            FIFTEEN_MINUTES - RENEWAL_WINDOW_MS - 1000
        );
        expect(h.renew).not.toHaveBeenCalled();

        // And still nothing at the window's exact edge — the timer aims inside it.
        await vi.advanceTimersByTimeAsync(1000);
        expect(h.renew).not.toHaveBeenCalled();
    });

    it('renews once the final window is entered, without rotating the secret', async () => {
        const h = harness();
        const held = await h.broker.capability(mediaDemand());
        await vi.advanceTimersByTimeAsync(TO_RENEWAL);
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
        await vi.advanceTimersByTimeAsync(TO_RENEWAL);
        await vi.advanceTimersByTimeAsync(TO_RENEWAL);
        expect(h.renew).toHaveBeenCalledTimes(2);
    });

    it('fails closed when renewal is refused — no re-mint, no fallback', async () => {
        const h = harness();
        h.renew.mockRejectedValueOnce(new Error('PlaybackCapabilityRevoked'));
        await h.broker.capability(mediaDemand());
        await vi.advanceTimersByTimeAsync(TO_RENEWAL);

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

describe('clock skew', () => {
    it('anchors expiry on the server-measured lifetime, not on the absolute timestamp', async () => {
        const h = harness();
        // A server clock one hour AHEAD of ours. The absolute ExpiresAt is an hour in our future;
        // only the IssuedAt/ExpiresAt difference is skew-free.
        const skew = 60 * 60 * 1000;
        h.mint.mockImplementationOnce(async () => ({
            CapabilityId: 'cap-skewed',
            Value: 'value-skewed',
            IssuedAt: new Date(Date.now() + skew).toISOString(),
            ExpiresAt: new Date(
                Date.now() + skew + FIFTEEN_MINUTES
            ).toISOString(),
            Scopes: [],
            PlaySessionId: 'ps-1'
        }));
        const held = await h.broker.capability(mediaDemand());
        expect(held.expiresAt).toBe(Date.now() + FIFTEEN_MINUTES);

        // The renewal still lands inside the window rather than an hour late.
        await vi.advanceTimersByTimeAsync(TO_RENEWAL);
        expect(h.renew).toHaveBeenCalledTimes(1);
    });

    it('never schedules a renewal after expiry', async () => {
        const h = harness();
        h.mint.mockImplementationOnce(async () => ({
            CapabilityId: 'cap-short',
            Value: 'value-short',
            IssuedAt: new Date(Date.now()).toISOString(),
            // Shorter than the renewal window: the timer must fire before expiry, not after.
            ExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            Scopes: [],
            PlaySessionId: 'ps-1'
        }));
        await h.broker.capability(mediaDemand());
        await vi.advanceTimersByTimeAsync(60_000);
        expect(h.renew).toHaveBeenCalledTimes(1);
    });
});

describe('teardown', () => {
    it('releasing a play session cancels its renewals and keeps the others', async () => {
        const h = harness();
        await h.broker.capability(mediaDemand());
        await h.broker.capability(mediaDemand({ playSessionId: 'ps-2' }));
        h.broker.releasePlaySession('ps-1');
        expect(h.broker.heldCount).toBe(1);

        await vi.advanceTimersByTimeAsync(TO_RENEWAL);
        // Only the surviving play session renewed.
        expect(h.renew).toHaveBeenCalledTimes(1);
    });

    it('discards a mint that lands after the session changed', async () => {
        const h = harness();
        let release: ((value: unknown) => void) | undefined;
        h.mint.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                })
        );
        const pending = h.broker.capability(mediaDemand());

        // The session changes while the mint is still in flight.
        h.setToken('token-2');
        await h.broker.capability(mediaDemand({ playSessionId: 'ps-other' }));

        release?.({
            CapabilityId: 'cap-stale',
            Value: 'value-stale',
            IssuedAt: new Date(Date.now()).toISOString(),
            ExpiresAt: new Date(Date.now() + FIFTEEN_MINUTES).toISOString(),
            Scopes: [],
            PlaySessionId: 'ps-1'
        });

        await expect(pending).rejects.toBeInstanceOf(PlaybackCredentialError);
        // Only the post-change capability is held, and only it renews.
        expect(h.broker.heldCount).toBe(1);
        await vi.advanceTimersByTimeAsync(TO_RENEWAL);
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
