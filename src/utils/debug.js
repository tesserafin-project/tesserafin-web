/**
 * Routine diagnostics are opt-in in production. Enable for this browser with
 * localStorage.setItem('tesserafin.debug', 'true'); remove the key to disable.
 * Read on each call so toggling does not require a reload. Storage can be denied.
 * Warnings and errors continue to use console directly.
 * @param {...unknown} args Diagnostic values (never credentials or media URLs).
 */
export function debug(...args) {
    if (process.env.NODE_ENV !== 'production') {
        console.debug(...args);
        return;
    }

    try {
        if (globalThis.localStorage?.getItem('tesserafin.debug') === 'true') {
            console.debug(...args);
        }
    } catch {
        // Disabled when storage is unavailable, including restricted webviews.
    }
}
