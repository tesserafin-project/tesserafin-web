/**
 * The first-party WebSocket service (#153-A1).
 *
 * WHY THIS EXISTS RATHER THAN A PATCH TO `@jellyfin/sdk`'s `WebSocketService`.
 *
 *   A WebSocket ticket is single-use and consumed by the server BEFORE the socket is accepted. The
 *   sdk's service reconnects by re-entering `initSocket()` against the STORED `this.url` after an
 *   exponential backoff, so a ticket placed in that url is replayed on every retry and refused on
 *   every retry — and, because the refusal happens at the handshake, it looks exactly like a
 *   flapping connection. Owning the connect routine is what makes "one ticket per physical upgrade
 *   attempt" true by construction instead of true-on-the-first-attempt.
 *
 * HOW IT IS INSTALLED. `Api.subscribe()` reads `if (!this.webSocket) { this.webSocket = new
 * WebSocketService(...) }`, so assigning `api.webSocket` before the first subscribe diverts every
 * caller — both `apiClient.subscribe(...)`, which `ServerConnections` binds to `_sdk.subscribe`, and
 * the direct `api.subscribe(...)` sites in hooks. No call site changes.
 *
 * WHAT IS REUSED. `SUBSCRIPTION_REGISTRY`, `PeriodicListenerInterval` and the backoff constants come
 * from the sdk unchanged: they are pure message shapes and numbers, and re-declaring them would let
 * the two drift apart silently. Only the url construction and the connect/reconnect lifecycle are
 * ours, because only those touch a credential.
 *
 * OUTPUT SAFETY. No branch logs a url, a ticket or a token.
 */
import {
    RECONNECT_DELAY_FACTOR,
    RECONNECT_INITIAL_DELAY,
    RECONNECT_MAX_DELAY,
    SUBSCRIPTION_REGISTRY
} from '@jellyfin/sdk/lib/websocket/constants';
import { PeriodicListenerInterval } from '@jellyfin/sdk/lib/websocket/models';

/** The query key the server reads the ticket from (`WebSocketManager.TicketQueryKey`). */
export const TICKET_QUERY_KEY = 'webSocketTicket';

type Handler = (message: unknown) => void;

export type SocketStatus = 'disconnected' | 'connecting' | 'connected';

export interface TicketedWebSocketDependencies {
    /** The server's http(s) base path. Converted to ws(s) here; no credential is ever added. */
    basePath: () => string;
    /** One fresh, single-use ticket. Called once per PHYSICAL upgrade attempt, never cached. */
    mintTicket: () => Promise<string>;
    /** Injected for the unit tests; defaults to the platform constructor. */
    createSocket?: (url: string) => WebSocket;
}

/**
 * The `ws(s)` origin for an `http(s)` base path, with the socket path appended and no query.
 *
 * The ticket is appended by the caller, at the last possible moment, so no code path can hold a
 * credential-bearing url across an await.
 */
export function socketBaseUrl(basePath: string): string {
    const trimmed = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    return `${trimmed.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:')}/socket`;
}

export class TicketedWebSocketService {
    private readonly deps: TicketedWebSocketDependencies;
    private readonly createSocket: (url: string) => WebSocket;
    private readonly subscriptions = new Map<string, Handler[]>();
    private subscriptionIntervals: Record<string, PeriodicListenerInterval> =
        {};
    private readonly statusListeners: Array<(status: SocketStatus) => void> =
        [];

    private socket: WebSocket | null = null;
    private status: SocketStatus = 'disconnected';
    private reconnectionAttempts = 0;
    private reconnectionTimeout: ReturnType<typeof setTimeout> | null = null;
    private keepAlive: ReturnType<typeof setTimeout> | null = null;
    private autoReconnectDisabled = false;
    /**
     * Bumped on every connect and every teardown. An in-flight mint whose generation no longer
     * matches has been cancelled: its ticket is discarded and no socket is built from it.
     */
    private generation = 0;
    /** Counts PHYSICAL upgrade attempts. Test seam; never exposes a ticket. */
    private attempts = 0;

    constructor(deps: TicketedWebSocketDependencies) {
        this.deps = deps;
        this.createSocket =
            deps.createSocket ?? ((url: string) => new WebSocket(url));
    }

    get socketStatus(): SocketStatus {
        return this.status;
    }

    /** How many physical upgrade attempts have been made. One ticket was minted for each. */
    get upgradeAttempts(): number {
        return this.attempts;
    }

    private setStatus(next: SocketStatus): void {
        if (this.status === next) return;
        this.status = next;
        for (const listener of this.statusListeners) listener(next);
    }

    onStatusChange(listener: (status: SocketStatus) => void): () => void {
        this.statusListeners.push(listener);
        return () => {
            const index = this.statusListeners.indexOf(listener);
            if (index !== -1) this.statusListeners.splice(index, 1);
        };
    }

    /**
     * One physical upgrade attempt: mint, then connect.
     *
     * The mint is awaited BEFORE the socket exists, so the ticket is used exactly once and a
     * cancellation during the await throws the ticket away instead of connecting with it.
     */
    private async connect(): Promise<void> {
        if (this.socket || this.autoReconnectDisabled) return;
        const generation = ++this.generation;
        this.setStatus('connecting');
        this.attempts += 1;

        let ticket: string;
        try {
            ticket = await this.deps.mintTicket();
        } catch {
            // No ticket, no socket. There is deliberately no durable-token url to fall back to.
            if (generation === this.generation) {
                this.setStatus('disconnected');
                this.scheduleReconnect();
            }
            return;
        }

        if (generation !== this.generation || this.autoReconnectDisabled) {
            // Cancelled while minting. The ticket is discarded unused.
            return;
        }

        const url = `${socketBaseUrl(this.deps.basePath())}?${TICKET_QUERY_KEY}=${encodeURIComponent(ticket)}`;
        const socket = this.createSocket(url);
        this.socket = socket;

        socket.addEventListener('open', () => {
            if (this.socket !== socket) return;
            this.reconnectionAttempts = 0;
            this.setStatus('connected');
            for (const type of this.subscriptions.keys()) {
                const mapping = SUBSCRIPTION_REGISTRY[
                    type as keyof typeof SUBSCRIPTION_REGISTRY
                ] as
                    | {
                          createStartMessage: (
                              interval: PeriodicListenerInterval
                          ) => unknown;
                      }
                    | undefined;
                if (!mapping) continue;
                this.sendMessage(
                    mapping.createStartMessage(
                        this.subscriptionIntervals[type] ??
                            new PeriodicListenerInterval(0, 1000)
                    )
                );
            }
        });

        socket.addEventListener('message', (event: MessageEvent) => {
            if (this.socket !== socket) return;
            const data = JSON.parse(event.data as string) as {
                MessageType: string;
                Data?: number;
            };
            if (data.MessageType === 'ForceKeepAlive' && data.Data) {
                if (this.keepAlive) clearTimeout(this.keepAlive);
                this.keepAlive = setTimeout(
                    () => this.sendMessage({ MessageType: 'KeepAlive' }),
                    data.Data / 2
                );
                return;
            }
            for (const handler of this.subscriptions.get(data.MessageType) ??
                []) {
                handler(data);
            }
        });

        socket.addEventListener('close', () => {
            if (this.socket !== socket) return;
            this.socket = null;
            this.setStatus('disconnected');
            if (this.keepAlive) {
                clearTimeout(this.keepAlive);
                this.keepAlive = null;
            }
            this.scheduleReconnect();
        });
    }

    /**
     * Arm a reconnect. The retry re-enters {@link connect}, which mints AGAIN — the whole point of
     * owning this path.
     */
    private scheduleReconnect(): void {
        if (this.autoReconnectDisabled || this.subscriptions.size === 0) return;
        if (this.reconnectionTimeout) return;
        this.reconnectionAttempts += 1;
        const delay = Math.min(
            RECONNECT_INITIAL_DELAY *
                RECONNECT_DELAY_FACTOR ** (this.reconnectionAttempts - 1),
            RECONNECT_MAX_DELAY
        );
        this.reconnectionTimeout = setTimeout(() => {
            this.reconnectionTimeout = null;
            void this.connect();
        }, delay);
    }

    sendMessage(message: unknown): void {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        }
    }

    subscribe(
        messageTypes: string[],
        onMessage: Handler,
        subscriptionIntervals?: Record<string, PeriodicListenerInterval>
    ): () => void {
        if (subscriptionIntervals) {
            this.subscriptionIntervals = {
                ...this.subscriptionIntervals,
                ...subscriptionIntervals
            };
        }
        for (const type of messageTypes) {
            const isNewType = !this.subscriptions.has(type);
            if (isNewType) this.subscriptions.set(type, []);
            this.subscriptions.get(type)?.push(onMessage);
            if (isNewType && this.socket?.readyState === WebSocket.OPEN) {
                const mapping = SUBSCRIPTION_REGISTRY[
                    type as keyof typeof SUBSCRIPTION_REGISTRY
                ] as
                    | {
                          createStartMessage: (
                              interval: PeriodicListenerInterval
                          ) => unknown;
                      }
                    | undefined;
                if (mapping) {
                    this.sendMessage(
                        mapping.createStartMessage(
                            this.subscriptionIntervals[type] ??
                                new PeriodicListenerInterval(0, 1000)
                        )
                    );
                }
            }
        }

        this.autoReconnectDisabled = false;
        if (!this.socket) void this.connect();

        return () => {
            for (const type of messageTypes) {
                const handlers = this.subscriptions.get(type);
                if (!handlers) continue;
                const index = handlers.indexOf(onMessage);
                if (index !== -1) handlers.splice(index, 1);
                if (handlers.length === 0) {
                    this.subscriptions.delete(type);
                    const mapping = SUBSCRIPTION_REGISTRY[
                        type as keyof typeof SUBSCRIPTION_REGISTRY
                    ] as { createStopMessage: () => unknown } | undefined;
                    if (mapping) this.sendMessage(mapping.createStopMessage());
                }
            }
            if (this.subscriptions.size === 0) this.disconnect();
        };
    }

    /**
     * The seam `Api.update()` calls with a url it built itself.
     *
     * The argument is IGNORED on purpose: whatever the sdk put in it, this service builds its own
     * url from the base path and a freshly minted ticket. Accepting the argument would mean
     * accepting `?ApiKey=<durable token>`.
     */
    updateUrl(_uri?: string): void {
        const hadSubscriptions = this.subscriptions.size > 0;
        this.teardown();
        this.autoReconnectDisabled = false;
        if (hadSubscriptions) void this.connect();
    }

    /** Close, cancel every timer, and cancel any mint in flight. Subscriptions are preserved. */
    disconnect(): void {
        this.autoReconnectDisabled = true;
        this.teardown();
        this.setStatus('disconnected');
    }

    private teardown(): void {
        this.generation += 1;
        const socket = this.socket;
        this.socket = null;
        socket?.close();
        this.reconnectionAttempts = 0;
        if (this.reconnectionTimeout) {
            clearTimeout(this.reconnectionTimeout);
            this.reconnectionTimeout = null;
        }
        if (this.keepAlive) {
            clearTimeout(this.keepAlive);
            this.keepAlive = null;
        }
    }

    /** Permanent teardown: drops subscriptions too, so nothing can revive the socket. */
    dispose(): void {
        this.disconnect();
        this.subscriptions.clear();
        this.statusListeners.length = 0;
    }
}
