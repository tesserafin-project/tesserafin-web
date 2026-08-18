/**
 * The cache identity of a playback capability (#153-A1).
 *
 * A cached capability may be reused ONLY when every authority-bearing dimension matches. Dropping
 * any one of them is a privilege bug that no behavioural test of a single account can see, so each
 * dimension is a separate, independently mutable field here and Phase 4 mutates them one at a time.
 *
 * `null` is a VALUE, never a wildcard. The server's `PlaybackCapabilityDemand` refuses a bound
 * capability when the route names no item or media source, so a capability minted with
 * `itemId: null` and one minted with `itemId: '<guid>'` are different authorities and must never
 * collide in this cache.
 *
 * The access token is deliberately NOT a dimension. A cache key is a string, and a string ends up in
 * a diagnostic sooner or later. The session is represented by `sessionEpoch`, a counter the broker
 * bumps whenever it observes the token change.
 */
import type { PlaybackCapabilityScope } from 'lib/tesserafin-sdk/generated/models/playback-capability-scope';

/** Everything that decides what a capability is allowed to fetch. */
export interface CapabilityAuthority {
    /** The server this capability belongs to. */
    serverId: string;
    /** The user the capability was minted for. */
    userId: string;
    /** Bumped whenever the broker observes a different access token — i.e. a different session. */
    sessionEpoch: number;
    /** The device the session belongs to. */
    deviceId: string;
    /** The play session that owns the capability; ending it revokes this capability and no other. */
    playSessionId: string;
    /** The item, or `null` for an item-less family (fonts). */
    itemId: string | null;
    /** The media source, or `null` for a route that names none (universal audio, legacy HLS). */
    mediaSourceId: string | null;
    /** The scopes this capability carries. Canonicalised by {@link canonicalScopes}. */
    scopes: readonly PlaybackCapabilityScope[];
}

/**
 * Sorted, de-duplicated scopes.
 *
 * `[Media]` and `[Media, Media]` are one authority; `[Media]` and `[Media, Subtitles]` are two. A
 * key built from an unsorted array would mint twice for the same authority, which looks like a
 * performance bug and hides a correctness one: the two entries would then expire independently.
 */
export function canonicalScopes(
    scopes: readonly PlaybackCapabilityScope[]
): PlaybackCapabilityScope[] {
    return [...new Set(scopes)].sort();
}

/**
 * `null` and the string `'null'` must not collide, and neither must a value containing the
 * separator. Each field is length-prefixed, which makes the encoding injective without escaping.
 */
function field(value: string | null): string {
    return value === null ? '-' : `${value.length}:${value}`;
}

/**
 * The cache key for one authority.
 *
 * Every dimension of {@link CapabilityAuthority} appears exactly once. Adding a dimension to the
 * interface without adding it here is the failure this function exists to make impossible to do
 * quietly, so the field order below mirrors the interface declaration order.
 */
export function authorityKey(authority: CapabilityAuthority): string {
    return [
        field(authority.serverId),
        field(authority.userId),
        field(String(authority.sessionEpoch)),
        field(authority.deviceId),
        field(authority.playSessionId),
        field(authority.itemId),
        field(authority.mediaSourceId),
        field(canonicalScopes(authority.scopes).join(','))
    ].join('|');
}
