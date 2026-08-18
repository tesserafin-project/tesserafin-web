/**
 * #153-A1 — the ticketed socket's permanent unit coverage.
 *
 * A fake `WebSocket` is injected, so nothing here opens a real connection. Fake timers throughout;
 * the reconnect backoff is exercised by advancing them, never by waiting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    socketBaseUrl,
    TICKET_QUERY_KEY,
    TicketedWebSocketService
} from './TicketedWebSocketService';

class FakeSocket {
    static instances: FakeSocket[] = [];
    readonly url: string;
    readyState = 0;
    sent: string[] = [];
    private listeners = new Map<string, Array<(event: unknown) => void>>();

    constructor(url: string) {
        this.url = url;
        FakeSocket.instances.push(this);
    }

    addEventListener(type: string, listener: (event: unknown) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.readyState = 3;
        this.emit('close', {});
    }

    open(): void {
        this.readyState = 1;
        this.emit('open', {});
    }

    message(payload: unknown): void {
        this.emit('message', { data: JSON.stringify(payload) });
    }

    private emit(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
}

/** Every ticket this file hands out is distinct, so a shared one is visible as a shared url. */
let mintedTickets = 0;

function service(
    mintTicket = vi.fn(async () => {
        mintedTickets += 1;
        return `ticket-${mintedTickets}`;
    })
) {
    const svc = new TicketedWebSocketService({
        basePath: () => 'http://server.example:8096',
        mintTicket,
        createSocket: (url) => new FakeSocket(url) as unknown as WebSocket
    });
    return { svc, mintTicket };
}

beforeEach(() => {
    FakeSocket.instances = [];
    mintedTickets = 0;
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSED: 3 });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('url construction', () => {
    it('converts the scheme and never adds a durable credential', () => {
        expect(socketBaseUrl('http://a:8096')).toBe('ws://a:8096/socket');
        expect(socketBaseUrl('https://a/')).toBe('wss://a/socket');
    });

    it('carries only the ticket parameter', async () => {
        const { svc } = service();
        svc.subscribe(['Sessions'], () => undefined);
        await vi.advanceTimersByTimeAsync(0);

        const url = new URL(FakeSocket.instances[0].url.replace(/^ws/, 'http'));
        expect([...url.searchParams.keys()]).toEqual([TICKET_QUERY_KEY]);
        expect(url.search.toLowerCase()).not.toContain('apikey');
        expect(url.search).not.toContain('api_key');
    });
});

describe('one ticket per physical attempt', () => {
    it('mints once for the first connect', async () => {
        const { svc, mintTicket } = service();
        svc.subscribe(['Sessions'], () => undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(mintTicket).toHaveBeenCalledTimes(1);
        expect(svc.upgradeAttempts).toBe(1);
    });

    it('mints AGAIN on reconnect and never replays the first ticket', async () => {
        const { svc, mintTicket } = service();
        svc.subscribe(['Sessions'], () => undefined);
        await vi.advanceTimersByTimeAsync(0);
        FakeSocket.instances[0].open();
        FakeSocket.instances[0].close();

        await vi.advanceTimersByTimeAsync(5_000);
        expect(mintTicket).toHaveBeenCalledTimes(2);
        expect(FakeSocket.instances).toHaveLength(2);
        expect(FakeSocket.instances[1].url).not.toBe(
            FakeSocket.instances[0].url
        );
    });

    it('keeps minting across successive reconnects with a growing backoff', async () => {
        const { svc, mintTicket } = service();
        svc.subscribe(['Sessions'], () => undefined);
        await vi.advanceTimersByTimeAsync(0);
        for (let i = 0; i < 3; i++) {
            FakeSocket.instances.at(-1)?.close();
            await vi.advanceTimersByTimeAsync(RECONNECT_CEILING);
        }
        expect(mintTicket).toHaveBeenCalledTimes(4);
        const urls = new Set(FakeSocket.instances.map((s) => s.url));
        expect(urls.size).toBe(FakeSocket.instances.length);
    });

    it('does not share a ticket between two services', async () => {
        const a = service();
        const b = service();
        a.svc.subscribe(['Sessions'], () => undefined);
        b.svc.subscribe(['Sessions'], () => undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(FakeSocket.instances).toHaveLength(2);
        expect(FakeSocket.instances[0].url).not.toBe(
            FakeSocket.instances[1].url
        );
    });
});

const RECONNECT_CEILING = 10_000;

describe('failure and cancellation', () => {
    it('builds no socket when the mint is refused, and does not fall back', async () => {
        const mint = vi.fn(async () => {
            throw new Error('WebSocketTicketUnknown');
        });
        const { svc } = service(mint as never);
        svc.subscribe(['Sessions'], () => undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(FakeSocket.instances).toHaveLength(0);
        expect(svc.socketStatus).toBe('disconnected');
    });

    it('discards the ticket when cancelled before the upgrade', async () => {
        let release: ((value: string) => void) | undefined;
        const mint = vi.fn(
            () =>
                new Promise<string>((resolve) => {
                    release = resolve;
                })
        );
        const { svc } = service(mint as never);
        svc.subscribe(['Sessions'], () => undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(mint).toHaveBeenCalledTimes(1);

        svc.disconnect();
        release?.('ticket-cancelled');
        await vi.advanceTimersByTimeAsync(0);

        // The mint resolved AFTER the cancellation: no socket was ever built from it.
        expect(FakeSocket.instances).toHaveLength(0);
    });

    it('stops reconnecting once disconnected', async () => {
        const { svc, mintTicket } = service();
        svc.subscribe(['Sessions'], () => undefined);
        await vi.advanceTimersByTimeAsync(0);
        svc.disconnect();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(mintTicket).toHaveBeenCalledTimes(1);
    });

    it('unsubscribing the last listener closes the socket', async () => {
        const { svc } = service();
        const unsubscribe = svc.subscribe(['Sessions'], () => undefined);
        await vi.advanceTimersByTimeAsync(0);
        FakeSocket.instances[0].open();
        unsubscribe();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(FakeSocket.instances).toHaveLength(1);
        expect(svc.socketStatus).toBe('disconnected');
    });
});

describe('updateUrl', () => {
    it('ignores the url it is handed and mints its own ticket', async () => {
        const { svc, mintTicket } = service();
        svc.subscribe(['Sessions'], () => undefined);
        await vi.advanceTimersByTimeAsync(0);

        svc.updateUrl('http://server.example:8096/socket?ApiKey=DURABLE');
        await vi.advanceTimersByTimeAsync(0);

        expect(mintTicket).toHaveBeenCalledTimes(2);
        for (const socket of FakeSocket.instances) {
            expect(socket.url).not.toContain('ApiKey');
            expect(socket.url).not.toContain('DURABLE');
        }
    });
});

describe('subscriptions', () => {
    it('sends the start message once the socket opens', async () => {
        const { svc } = service();
        svc.subscribe(['Sessions'], () => undefined);
        await vi.advanceTimersByTimeAsync(0);
        FakeSocket.instances[0].open();
        expect(FakeSocket.instances[0].sent).toContainEqual(
            JSON.stringify({ MessageType: 'SessionsStart', Data: '0,1000' })
        );
    });

    it('routes messages to the handler for their type', async () => {
        const { svc } = service();
        const seen: unknown[] = [];
        svc.subscribe(['Sessions'], (message) => seen.push(message));
        await vi.advanceTimersByTimeAsync(0);
        FakeSocket.instances[0].open();
        FakeSocket.instances[0].message({ MessageType: 'Sessions', Data: [] });
        expect(seen).toHaveLength(1);
    });
});
