/**
 * The HTTP status of a failed request, whichever client made it: the legacy ApiClient rejects with
 * the fetch `Response` itself, the SDK with an Axios error carrying `response.status`.
 */
export function getHttpStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;

    const direct = (error as { status?: unknown }).status;
    if (typeof direct === 'number') return direct;

    const nested = (error as { response?: { status?: unknown } }).response
        ?.status;
    return typeof nested === 'number' ? nested : undefined;
}

/**
 * Whether a failed item request means the item is not there for this user (tesserafin-web#195).
 *
 * The server answers an item the user may not see exactly as one that does not exist: 404. The
 * client cannot tell them apart and must not try, so both get one message.
 */
export function isItemUnavailable(error: unknown): boolean {
    return getHttpStatus(error) === 404;
}
