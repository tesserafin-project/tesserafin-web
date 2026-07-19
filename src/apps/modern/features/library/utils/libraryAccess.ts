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
 * ## What Reefin actually answers — measured, not assumed
 *
 * The two endpoints this route uses disagree, and it matters:
 *
 * - **`GET /Items/{itemId}`** (`Reefin.Api/Controllers/UserLibraryController.cs`'s `GetItem`, which
 *   backs `useLibraryInfo`) resolves through `_libraryManager.GetItemById<BaseItem>(itemId, user)`
 *   — the *user-filtered* overload — and returns `NotFound()` when it yields null. A library the
 *   user may not see is therefore **indistinguishable from one that does not exist** at this
 *   endpoint: both are 404. That is a deliberate server-side choice (not confirming that an id
 *   exists is the safer answer), and no amount of client code can see through it. In practice a
 *   forbidden library renders the *not found* state, and this module does not pretend otherwise.
 * - **`GET /Items`** (`Reefin.Api/Controllers/ItemsController.cs`, which backs the Browse grid)
 *   does distinguish: `!item.IsVisible(user)` returns **401** with an explicit
 *   "is not permitted to access Library X" message. This is the path on which `access-denied` is
 *   really reachable, which is why the grid classifies its error too rather than only the shell.
 *
 * So the classification below is correct per status code, and the *coverage* of `access-denied`
 * depends on which request failed. Stated here rather than in a report, because a future reader
 * looking at the access-denied branch deserves to know when it can actually fire.
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
