/**
 * The per-`ApiClient` playback credential broker (#153-A1).
 *
 * ONE INSTANCE PER `ApiClient`. There is deliberately no module-level cache and no singleton: two
 * servers, two users or two `ApiClient` instances must not be able to reach each other's
 * credentials, and the cheapest way to guarantee that is to make it structurally impossible rather
 * than to compare identities at read time.
 *
 * WHAT IT IS NOT. It is not a URL builder. `ApiClient.getUrl` is synchronous and stays synchronous;
 * minting is a network round trip. Callers await a capability at an existing asynchronous playback
 * boundary and then pass the already-minted value into `getUrl` as an ordinary query parameter.
 * Hiding the round trip inside `getUrl` would turn every synchronous URL construction in the app
 * into a latent await.
 *
 * OUTPUT SAFETY. No branch of this module logs a capability value, a ticket value or an access
 * token. Errors name a capability by its id, never by its value.
 */
import type { PlaybackCapabilityDto } from 'lib/tesserafin-sdk/generated/models/playback-capability-dto';
import type { PlaybackCapabilityRenewalDto } from 'lib/tesserafin-sdk/generated/models/playback-capability-renewal-dto';
import type { PlaybackCapabilityRequestDto } from 'lib/tesserafin-sdk/generated/models/playback-capability-request-dto';
import type { PlaybackCapabilityScope } from 'lib/tesserafin-sdk/generated/models/playback-capability-scope';
import type { WebSocketTicketDto } from 'lib/tesserafin-sdk/generated/models/web-socket-ticket-dto';

import { authorityKey, canonicalScopes } from './identity';
import type { CapabilityAuthority } from './identity';

/**
 * Renewal may only be attempted inside the final five minutes before expiry. The server answers
 * `PlaybackCapabilityRenewalTooEarly` (400) outside that window, so renewing early is not a
 * harmless optimisation — it is a request that fails and leaves the capability unrenewed.
 */
export const RENEWAL_WINDOW_MS = 5 * 60 * 1000;

/**
 * How far INSIDE the renewal window the timer aims.
 *
 * Firing at the exact boundary means any forward skew of the local clock puts the request before
 * the window the SERVER is measuring, which answers `PlaybackCapabilityRenewalTooEarly` (400) —
 * and a refused renewal fails closed, so a clock a minute fast would end playback rather than
 * extend it. Aiming inside the window costs nothing: the window is five minutes and a renewal is
 * one round trip.
 */
export const RENEWAL_SKEW_MARGIN_MS = 30 * 1000;

/** What a caller asks for. The broker supplies every other authority dimension itself. */
export interface CapabilityDemand {
    scopes: readonly PlaybackCapabilityScope[];
    itemId: string | null;
    mediaSourceId: string | null;
    playSessionId: string;
}

/** What a caller gets. The `value` is the query parameter; nothing else is needed to build a URL. */
export interface HeldCapability {
    capabilityId: string;
    value: string;
    /** Epoch milliseconds. Extended in place by renewal; the value never rotates. */
    expiresAt: number;
}

/** Everything the broker touches that is not itself. Injected so the unit tests need no network. */
export interface BrokerDependencies {
    serverId: () => string;
    userId: () => string;
    deviceId: () => string;
    /** Read, compared, and never stored: a change bumps the session epoch. */
    accessToken: () => string;
    mintCapability: (
        request: PlaybackCapabilityRequestDto
    ) => Promise<PlaybackCapabilityDto>;
    renewCapability: (
        capabilityId: string
    ) => Promise<PlaybackCapabilityRenewalDto>;
    mintWebSocketTicket: () => Promise<WebSocketTicketDto>;
    now?: () => number;
}

/** Raised when a capability cannot be obtained. There is no fallback for a caller to reach for. */
export class PlaybackCredentialError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PlaybackCredentialError';
    }
}

/**
 * The capability's expiry expressed on the LOCAL clock.
 *
 * The absolute `ExpiresAt` the server sends is on the server's clock; comparing it against
 * `Date.now()` imports the whole clock difference between the two machines into every expiry and
 * renewal decision. The lifetime `ExpiresAt - IssuedAt` is measured entirely on the server's clock,
 * so it carries no skew at all; anchoring it to the moment the response was RECEIVED yields a local
 * expiry that can only ever be pessimistic by the response latency — which is the safe direction,
 * because it makes the renewal fire marginally earlier inside the window rather than after it.
 *
 * Falls back to the absolute value when a server omits `IssuedAt`.
 */
function localExpiry(
    issuedAt: string | undefined | null,
    expiresAt: string,
    receivedAt: number
): number {
    const absolute = Date.parse(expiresAt);
    if (!issuedAt) return absolute;
    const issued = Date.parse(issuedAt);
    if (Number.isNaN(issued) || Number.isNaN(absolute)) return absolute;
    return receivedAt + (absolute - issued);
}

interface CacheEntry {
    capabilityId: string;
    value: string;
    expiresAt: number;
    playSessionId: string;
    timer: ReturnType<typeof setTimeout> | null;
    /**
     * Set once renewal has been refused or the capability has expired. A failed entry is NEVER
     * re-minted for the same authority: re-minting would rotate a fresh secret into a URL the media
     * element is already using, which is exactly the "rebuild the URL" behaviour A1 forbids. The
     * play session has to end and a new one begin.
     */
    failed: boolean;
}

export class PlaybackCredentialBroker {
    private readonly deps: BrokerDependencies;
    private readonly now: () => number;
    private readonly entries = new Map<string, CacheEntry>();
    private readonly inFlight = new Map<string, Promise<HeldCapability>>();
    private lastAccessToken: string;
    /**
     * The play session id used when a caller genuinely has none.
     *
     * `PlaybackCapabilityRequestDto.PlaySessionId` is `[Required]`, and `RequiredAttribute` rejects
     * an empty string, so `''` is answered `400 The PlaySessionId field is required` before the
     * mint handler runs — measured against the real server, not assumed. Several families
     * legitimately have no play session: a direct-play url names none, and neither does a subtitle
     * url, so the server never compares one for them and any value satisfies the demand.
     *
     * ONE id per broker, not one per call: a fresh id per call would change the cache key on every
     * request and turn the cache off. It is deliberately NOT used for a family whose url NAMES a
     * play session — the transcoding url does, and its caller reads the server's own value out of
     * the url instead, because minting with anything else is a
     * `PlaybackCapabilityPlaySessionMismatch`.
     */
    private readonly syntheticPlaySessionId = `web-${Math.random()
        .toString(36)
        .slice(2)}-${Date.now().toString(36)}`;
    private sessionEpoch = 0;
    private disposed = false;

    constructor(deps: BrokerDependencies) {
        this.deps = deps;
        this.now = deps.now ?? (() => Date.now());
        this.lastAccessToken = deps.accessToken();
    }

    /**
     * The authority a demand resolves to, with the broker's own dimensions filled in.
     *
     * Reading the access token here — not only in the constructor — is what makes a re-login
     * detectable: the epoch bumps and every previously cached capability becomes unreachable,
     * because its key named the old epoch.
     */
    private authorityFor(demand: CapabilityDemand): CapabilityAuthority {
        const token = this.deps.accessToken();
        if (token !== this.lastAccessToken) {
            this.lastAccessToken = token;
            this.sessionEpoch += 1;
            this.discardAll();
        }
        return {
            serverId: this.deps.serverId(),
            userId: this.deps.userId(),
            sessionEpoch: this.sessionEpoch,
            deviceId: this.deps.deviceId(),
            playSessionId: demand.playSessionId || this.syntheticPlaySessionId,
            itemId: demand.itemId,
            mediaSourceId: demand.mediaSourceId,
            scopes: demand.scopes
        };
    }

    /**
     * A capability for this demand, minted if necessary.
     *
     * Concurrent calls for the SAME authority share one mint. Concurrent calls for different
     * authorities do not: coalescing across authorities is how one capability quietly ends up
     * serving two, and the shared one is always the wider.
     */
    async capability(demand: CapabilityDemand): Promise<HeldCapability> {
        if (this.disposed) {
            throw new PlaybackCredentialError(
                'the credential broker has been disposed'
            );
        }
        const authority = this.authorityFor(demand);
        const key = authorityKey(authority);

        const existing = this.entries.get(key);
        if (existing) {
            if (existing.failed) {
                throw new PlaybackCredentialError(
                    `capability ${existing.capabilityId} failed renewal; this play session cannot continue`
                );
            }
            if (existing.expiresAt > this.now()) {
                return {
                    capabilityId: existing.capabilityId,
                    value: existing.value,
                    expiresAt: existing.expiresAt
                };
            }
            // Expired without a successful renewal: fail closed rather than silently re-minting.
            this.expire(key);
            throw new PlaybackCredentialError(
                'the playback capability expired and was not renewed'
            );
        }

        const pending = this.inFlight.get(key);
        if (pending) return pending;

        const mint = this.mint(key, authority, demand).finally(() => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, mint);
        return mint;
    }

    private async mint(
        key: string,
        authority: CapabilityAuthority,
        demand: CapabilityDemand
    ): Promise<HeldCapability> {
        const request: PlaybackCapabilityRequestDto = {
            PlaySessionId: authority.playSessionId,
            Scopes: canonicalScopes(demand.scopes)
        };
        // Omitted, not null: an item-less family must not name an item at all.
        if (demand.itemId !== null) request.ItemId = demand.itemId;
        if (demand.mediaSourceId !== null) {
            request.MediaSourceId = demand.mediaSourceId;
        }

        const mintedUnderEpoch = authority.sessionEpoch;
        const dto = await this.deps.mintCapability(request);
        const receivedAt = this.now();
        if (this.disposed) {
            throw new PlaybackCredentialError(
                'the credential broker was disposed while minting'
            );
        }
        if (this.sessionEpoch !== mintedUnderEpoch) {
            // The session changed while this mint was in flight. Storing it now would write an
            // entry under a key nothing can ever look up again — unreachable, but still holding a
            // renewal timer that keeps a dead session's capability alive. Drop it instead.
            throw new PlaybackCredentialError(
                'the session changed while the playback capability was being minted'
            );
        }
        const expiresAt = localExpiry(
            dto.IssuedAt as unknown as string,
            dto.ExpiresAt as unknown as string,
            receivedAt
        );
        const entry: CacheEntry = {
            capabilityId: String(dto.CapabilityId),
            value: String(dto.Value),
            expiresAt,
            playSessionId: authority.playSessionId,
            timer: null,
            failed: false
        };
        this.entries.set(key, entry);
        this.scheduleRenewal(key, entry);
        return {
            capabilityId: entry.capabilityId,
            value: entry.value,
            expiresAt: entry.expiresAt
        };
    }

    /**
     * Arm the renewal timer so it fires INSIDE the final five minutes and not before.
     *
     * A capability whose remaining life is already inside the window renews immediately; one with
     * more life waits until it enters the window. Firing earlier would be refused by the server with
     * `PlaybackCapabilityRenewalTooEarly`, so an "early is safe" schedule renews nothing at all.
     */
    private scheduleRenewal(key: string, entry: CacheEntry): void {
        if (entry.timer !== null) clearTimeout(entry.timer);
        const remaining = entry.expiresAt - this.now();
        // Inside the window, never at its edge, and never after expiry.
        const delay = Math.min(
            Math.max(0, remaining - RENEWAL_WINDOW_MS + RENEWAL_SKEW_MARGIN_MS),
            Math.max(0, remaining)
        );
        entry.timer = setTimeout(() => {
            void this.renew(key);
        }, delay);
    }

    private async renew(key: string): Promise<void> {
        const entry = this.entries.get(key);
        if (!entry || this.disposed) return;
        entry.timer = null;
        try {
            const renewal = await this.deps.renewCapability(entry.capabilityId);
            const receivedAt = this.now();
            const current = this.entries.get(key);
            if (!current || current !== entry || this.disposed) return;
            // The SAME secret, a later expiry. Nothing is rebuilt and no url changes.
            entry.expiresAt = localExpiry(
                renewal.IssuedAt as unknown as string,
                renewal.ExpiresAt as unknown as string,
                receivedAt
            );
            entry.failed = false;
            this.scheduleRenewal(key, entry);
        } catch {
            // Fail closed. No re-mint, no ApiKey, no second attempt on a different transport.
            entry.failed = true;
            if (entry.timer !== null) {
                clearTimeout(entry.timer);
                entry.timer = null;
            }
        }
    }

    private expire(key: string): void {
        const entry = this.entries.get(key);
        if (!entry) return;
        if (entry.timer !== null) clearTimeout(entry.timer);
        this.entries.delete(key);
    }

    /**
     * A fresh WebSocket ticket, minted for ONE physical upgrade attempt.
     *
     * Never cached and never coalesced. A ticket is single-use: two concurrent attempts sharing one
     * would make the second present a consumed ticket, and a reconnect replaying a stored one would
     * do the same on every retry.
     */
    async webSocketTicket(): Promise<string> {
        if (this.disposed) {
            throw new PlaybackCredentialError(
                'the credential broker has been disposed'
            );
        }
        if (!this.deps.accessToken()) {
            // A credential-less upgrade attempt must not consume a ticket.
            throw new PlaybackCredentialError(
                'no session; a websocket ticket cannot be minted'
            );
        }
        const dto = await this.deps.mintWebSocketTicket();
        return String(dto.Value);
    }

    /** Drop every capability belonging to one play session, and cancel its renewals. */
    releasePlaySession(playSessionId: string): void {
        for (const [key, entry] of this.entries) {
            if (entry.playSessionId !== playSessionId) continue;
            if (entry.timer !== null) clearTimeout(entry.timer);
            this.entries.delete(key);
        }
    }

    /** Drop everything: logout, server change, user change, session change, failed initialisation. */
    discardAll(): void {
        for (const entry of this.entries.values()) {
            if (entry.timer !== null) clearTimeout(entry.timer);
        }
        this.entries.clear();
    }

    /** Permanent teardown. A disposed broker mints nothing and hands out nothing. */
    dispose(): void {
        this.discardAll();
        this.inFlight.clear();
        this.disposed = true;
    }

    /**
     * The `playbackCapability` value for one media family, as a bare string.
     *
     * These family helpers exist for a measured reason, not a stylistic one. Their call sites are
     * in `playbackmanager.js`, which is in the INITIAL delivery graph, and
     * `verify:verify-delivery-budget` leaves a few hundred bytes of headroom there. Keeping the
     * scope literal, the demand object shape and the url rewriting on THIS side of the `import()`
     * boundary keeps each eager call site down to one short call.
     */
    async mediaValue(
        itemId: string | null,
        mediaSourceId: string | null,
        playSessionId: string
    ): Promise<string> {
        const held = await this.capability({
            scopes: ['Media'],
            itemId,
            mediaSourceId,
            playSessionId
        });
        return held.value;
    }

    /**
     * A SERVER-EMITTED url with its durable credential replaced by a capability.
     *
     * `MediaSource.TranscodingUrl` and every subtitle `DeliveryUrl` are built by the server with
     * the durable token already in them (`StreamInfo.ToUrl`, `StreamInfo.GetSubtitleStreamInfo`),
     * and the web client consumes them verbatim — so migrating only the urls the client builds
     * itself would leave both families carrying the token.
     *
     * Both durable keys are deleted, not overwritten: the server writes `api_key` in one place and
     * `ApiKey` in the other, and deleting only the one a given call expected is how a token
     * survives a migration that looks complete.
     */
    async rewrite(url: string, demand: CapabilityDemand): Promise<string> {
        const held = await this.capability(demand);
        const separator = url.indexOf('?');
        const path = separator === -1 ? url : url.slice(0, separator);
        const params = new URLSearchParams(
            separator === -1 ? '' : url.slice(separator + 1)
        );
        params.delete('api_key');
        params.delete('ApiKey');
        params.set('playbackCapability', held.value);
        return `${path}?${params.toString()}`;
    }

    /** A server-emitted MEDIA url, rewritten. The common case, kept short for its call sites. */
    rewriteMedia(
        url: string,
        itemId: string | null,
        mediaSourceId: string | null,
        playSessionId: string
    ): Promise<string> {
        return this.rewrite(url, {
            scopes: ['Media'],
            itemId,
            mediaSourceId,
            playSessionId
        });
    }

    /**
     * The `playbackCapability` value for the FONT family.
     *
     * Fonts is the one item-less scope, and the server refuses a `Fonts` capability that names an
     * item or a media source at all (`PlaybackCredentialsController` answers 400). A fallback font
     * belongs to no item, so binding one to whatever happened to be playing would be a narrow
     * credential quietly made wide.
     */
    async fontsValue(playSessionId: string): Promise<string> {
        const held = await this.capability({
            scopes: ['Fonts'],
            itemId: null,
            mediaSourceId: null,
            playSessionId
        });
        return held.value;
    }

    /** A server-emitted ATTACHMENT url, rewritten. Carries no credential at all before this. */
    rewriteAttachment(
        url: string,
        itemId: string | null,
        mediaSourceId: string | null,
        playSessionId: string
    ): Promise<string> {
        return this.rewrite(url, {
            scopes: ['Attachments'],
            itemId,
            mediaSourceId,
            playSessionId
        });
    }

    /** The `playbackCapability` value for the TRICKPLAY family. */
    async trickplayValue(
        itemId: string | null,
        mediaSourceId: string | null,
        playSessionId: string
    ): Promise<string> {
        const held = await this.capability({
            scopes: ['Trickplay'],
            itemId,
            mediaSourceId,
            playSessionId
        });
        return held.value;
    }

    /** A server-emitted SUBTITLE url, rewritten. */
    rewriteSubtitle(
        url: string,
        itemId: string | null,
        mediaSourceId: string | null,
        playSessionId: string
    ): Promise<string> {
        return this.rewrite(url, {
            scopes: ['Subtitles'],
            itemId,
            mediaSourceId,
            playSessionId
        });
    }

    /** Test seam: how many capabilities are currently held. Never exposes a value. */
    get heldCount(): number {
        return this.entries.size;
    }
}
