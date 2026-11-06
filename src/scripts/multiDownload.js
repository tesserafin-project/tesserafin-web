import browser from '../scripts/browser';

function fallback(urls) {
    let i = 0;

    (function createIframe() {
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        frame.src = urls[i++];
        document.documentElement.appendChild(frame);

        // the download init has to be sequential otherwise IE only use the first
        const interval = setInterval(function () {
            if (
                frame.contentWindow.document.readyState === 'complete' ||
                frame.contentWindow.document.readyState === 'interactive'
            ) {
                clearInterval(interval);

                // Safari needs a timeout
                setTimeout(function () {
                    frame.parentNode.removeChild(frame);
                }, 1000);

                if (i < urls.length) {
                    createIframe();
                }
            }
        }, 100);
    })();
}

function download(url) {
    const a = document.createElement('a');
    a.download = '';
    a.href = url;
    a.click();
}

const DOWNLOAD_PROTOCOLS = new Set(['http:', 'https:', 'blob:']);

/**
 * Resolves a download URL and refuses any scheme other than http(s) or blob.
 *
 * The URL ends up as an iframe `src` or an anchor `href` that is clicked, where a `javascript:`
 * URL would execute in the app's origin (CodeQL js/xss-through-dom, web alerts #16/#17). Every
 * caller today passes a server download or image URL, so this only closes the door.
 */
export function toDownloadUrl(url) {
    const parsed = new URL(url, document.baseURI);
    if (!DOWNLOAD_PROTOCOLS.has(parsed.protocol)) {
        throw new Error(`refusing to download a ${parsed.protocol} URL`);
    }
    return parsed.href;
}

export default function (rawUrls) {
    if (!rawUrls) {
        throw new Error('`urls` required');
    }
    const urls = rawUrls.map(toDownloadUrl);

    if (
        typeof document.createElement('a').download === 'undefined' ||
        browser.iOS
    ) {
        return fallback(urls);
    }

    let delay = 0;

    urls.forEach(function (url) {
        setTimeout(download.bind(null, url), 100 * ++delay);
    });
}
