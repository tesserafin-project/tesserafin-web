/**
 * Reads a query-string parameter from a media URL.
 *
 * Matches `?name=` or `&name=` case-insensitively and returns the decoded
 * value (with `+` treated as a space), or `''` when the parameter is absent.
 * The parameter name is matched literally: every RegExp metacharacter in it
 * is escaped, not just the first `[` / `]`.
 * @param name The parameter name.
 * @param url The URL to search.
 * @returns The decoded parameter value, or an empty string.
 */
export function getParam(name: string, url: string): string {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('[\\?&]' + escaped + '=([^&#]*)', 'i');

    const results = regex.exec(url);
    if (results == null) {
        return '';
    }
    return decodeURIComponent(results[1].replace(/\+/g, ' '));
}
