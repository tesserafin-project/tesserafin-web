/**
 * The safe stand-in for a url in a diagnostic message (#75 / S4).
 *
 * Printing a url is what published the session credential in the first place: `playbackmanager`
 * builds playback urls with `ApiKey=<the session's access token>`, and the server hands back
 * transcoding urls with the same parameter. A message that carries the url therefore carries the
 * credential, and there is no message that "only sometimes" does - the caller cannot know which
 * url it was handed.
 *
 * So diagnostics name the *kind* of request instead of the request. `endpointCategory` returns the
 * first path segment and nothing else: no origin, no query string, no fragment, no identifiers
 * from deeper in the path. `/Videos/<item id>/stream.mp4?api_key=...` becomes `Videos`, which is
 * what a developer reading a console actually uses, and is not a credential under any input.
 */

/** Path segments are ASCII endpoint names; anything else is not something to print. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,32}$/;

/**
 * The endpoint category of a url: its first path segment, or a placeholder.
 *
 * Never returns the origin, the query string, the fragment, or any later path segment, so the
 * result cannot carry a credential or identify the media being played.
 */
export function endpointCategory(url: unknown): string {
    if (typeof url !== 'string' || url.length === 0) return 'unknown';

    let pathname: string;
    try {
        // The base only has to make a relative url parseable; it is never read back out.
        pathname = new URL(url, 'http://endpoint-category.invalid').pathname;
    } catch {
        return 'unknown';
    }

    const first = pathname.split('/').find((segment) => segment.length > 0);
    if (!first) return 'root';

    // A segment that is not a plain endpoint name is an identifier, an encoded blob, or something
    // unexpected. None of those are safe to print, and none of them are useful as a category.
    return SAFE_SEGMENT.test(first) ? first : 'unknown';
}
