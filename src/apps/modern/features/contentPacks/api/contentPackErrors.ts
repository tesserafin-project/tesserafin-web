/**
 * The one place the slice reads a transport status code.
 *
 * `getContentPack` answers `404` for a pack that is absent **or** wholly inaccessible to the
 * caller, and §4.4.3 makes the two deliberately indistinguishable. The surfaces need to tell that
 * apart from a transport failure — a 404 is a final answer and must not be retried or offered a
 * "try again" button, while a dropped connection is neither — so the distinction is made once,
 * here, instead of at each call site.
 *
 * Nothing here infers *why* the server answered 404, and nothing anywhere else in the slice does
 * either: "this pack is not available" is the whole of what the Web is entitled to say.
 */

const UNAUTHORIZED = 401;
const NOT_FOUND = 404;

const statusOf = (error: unknown): number | undefined => {
    if (!error || typeof error !== 'object') return undefined;
    const candidate = error as {
        response?: { status?: unknown };
        status?: unknown;
    };
    const status = candidate.response?.status ?? candidate.status;
    return typeof status === 'number' ? status : undefined;
};

export const isNotFoundError = (error: unknown): boolean =>
    statusOf(error) === NOT_FOUND;

/**
 * Retry policy for the pack-scoped reads.
 *
 * Identical to the application default (`utils/query/queryClient.ts`: up to two retries, never on
 * `401`) with one addition — a `404` is not retried either. Retrying it would triple the request
 * count for the most ordinary failure this route has, a stale bookmark, and would delay the
 * not-found surface by the backoff for no chance of a different answer.
 */
const MAX_RETRIES = 2;

export const retryUnlessNotFound = (
    failureCount: number,
    error: unknown
): boolean => {
    const status = statusOf(error);
    if (status === UNAUTHORIZED || status === NOT_FOUND) return false;
    return failureCount < MAX_RETRIES;
};
