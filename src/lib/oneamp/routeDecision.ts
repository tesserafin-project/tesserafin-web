/**
 * Demonstrator route policy (OneAmp web host contract §6). Pure: the player
 * gathers the facts, this decides. Only a capturable Direct Play audio item
 * without hls.js, outside Safari and with the experimental flag on, goes
 * through OneAmp.
 */

export const ONEAMP_FLAG_KEY = 'tesserafin.experimental.oneamp';

export type RouteReason =
    | 'flag-off'
    | 'safari'
    | 'not-audio'
    | 'not-direct-play'
    | 'hls'
    | 'not-capturable';

export type RouteDecision =
    | { route: 'oneamp' }
    | { route: 'bypass'; reason: RouteReason };

export interface RouteFacts {
    flag: boolean;
    safari: boolean;
    mediaType: string | null | undefined;
    playMethod: string | null | undefined;
    hls: boolean;
    capturable: boolean;
}

export function decideRoute(f: RouteFacts): RouteDecision {
    if (!f.flag) return { route: 'bypass', reason: 'flag-off' };
    if (f.safari) return { route: 'bypass', reason: 'safari' };
    if ((f.mediaType ?? '').toLowerCase() !== 'audio') {
        return { route: 'bypass', reason: 'not-audio' };
    }
    if (f.playMethod !== 'DirectPlay') {
        return { route: 'bypass', reason: 'not-direct-play' };
    }
    if (f.hls) return { route: 'bypass', reason: 'hls' };
    if (!f.capturable) return { route: 'bypass', reason: 'not-capturable' };
    return { route: 'oneamp' };
}

/** The flag: `localStorage['tesserafin.experimental.oneamp'] === '1'`, off on any error. */
export function readOneAmpFlag(
    storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage
): boolean {
    try {
        return storage?.getItem(ONEAMP_FLAG_KEY) === '1';
    } catch {
        return false;
    }
}
