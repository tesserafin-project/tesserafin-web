/**
 * Tells apart the three ways `/library/:libraryId` can fail to load its library (issue #15, L15b).
 *
 * Before activation this distinction was cosmetic: nothing linked to the route, so the only way to
 * reach a bad id was to type one. Activation changes that — `getRouteUrl()` now emits
 * `/library/:libraryId` everywhere, so stale bookmarks (library since deleted) and shared links
 * (library the recipient cannot see) both land here, and they are *different* situations that a
 * single "there was an error" swallows:
 *
 * - **not found** — the id does not resolve. Retrying will never help; the honest message says the
 *   library is gone.
 * - **access denied** — the id resolves for someone, but not for this user. Again not retryable,
 *   and telling the user to "try again" would be a lie about what went wrong.
 * - **error** — anything else (network, 5xx, parse). Retryable, and the existing `ErrorState` with
 *   its retry button is the right answer.
 *
 * The classification reads the HTTP status off the thrown Axios error rather than matching message
 * text: status codes are contract, message strings are not.
 *
 * Note on 404: a server may answer "you cannot see this" with 404 rather than 403, to avoid
 * confirming that an id exists. That is a legitimate server choice and this module cannot see
 * through it — a 404 is reported as *not found*, which is what the client was told.
 */

export type LibraryFailureKind = 'not-found' | 'access-denied' | 'error';

const getStatus = (error: unknown): number | undefined => {
    if (!error || typeof error !== 'object') return undefined;

    // Axios shape (`AxiosError.response.status`), read structurally so this stays usable for any
    // error carrying the same shape and needs no axios import.
    const response = (error as { response?: { status?: unknown } }).response;
    const status = response?.status;

    return typeof status === 'number' ? status : undefined;
};

export const classifyLibraryFailure = (error: unknown): LibraryFailureKind => {
    const status = getStatus(error);

    if (status === 404) return 'not-found';
    if (status === 401 || status === 403) return 'access-denied';

    return 'error';
};

/** Only a genuine transport/server error is worth a retry button; the other two are terminal. */
export const isRetryableLibraryFailure = (kind: LibraryFailureKind): boolean =>
    kind === 'error';
