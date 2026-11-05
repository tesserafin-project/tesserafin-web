/**
 * Query parameters of a view URL as a plain object (last value wins, as before).
 *
 * `Object.fromEntries` defines own data properties, so a key such as `__proto__` or `constructor`
 * from the URL becomes an ordinary own property instead of a write through the object's
 * prototype chain (CodeQL js/remote-property-injection, web alert #25).
 */
export function getViewParams(url) {
    const index = url.indexOf('?');
    return Object.fromEntries(new URLSearchParams(url.substring(index + 1)));
}
