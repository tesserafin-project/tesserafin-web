const SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js';
const TIMEOUT_MS = 5000;
let pendingLoad;

// Loading the script is not SDK readiness: chrome.cast may appear later. Keep
// one attempt across callers/instances and let a later explicit action retry.
class CastSenderApi {
    load() {
        if (window.appMode === 'cordova' || window.appMode === 'android') {
            window.chrome = window.chrome || {};
            return Promise.resolve();
        }
        if (window.chrome?.cast?.isAvailable) return Promise.resolve();
        if (pendingLoad) return pendingLoad;

        pendingLoad = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            let timer;
            let poll;
            let settled = false;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                clearInterval(poll);
                script.onload = script.onerror = null;
                if (error) {
                    script.remove();
                    pendingLoad = undefined;
                    reject(error);
                } else {
                    resolve();
                }
            };
            const check = () => {
                if (window.chrome?.cast?.isAvailable) finish();
            };
            script.src = SDK_URL;
            script.onload = check;
            script.onerror = () => finish(new Error('Cast SDK unavailable'));
            timer = setTimeout(
                () => finish(new Error('Cast SDK timed out')),
                TIMEOUT_MS
            );
            poll = setInterval(check, 25);
            document.head.appendChild(script);
        });
        return pendingLoad;
    }
}

export function waitForCastPlayer(player) {
    return new Promise((resolve, reject) => {
        const poll = setInterval(() => {
            if (!player || player._disposed || player.initializationFailed) {
                finish(new Error('Cast initialization unavailable'));
            } else if (
                player.isInitialized &&
                player.receiverAvailabilityKnown
            ) {
                finish();
            }
        }, 25);
        const timer = setTimeout(
            () => finish(new Error('Cast initialization timed out')),
            TIMEOUT_MS
        );
        function finish(error) {
            clearInterval(poll);
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
        }
    });
}

export default CastSenderApi;
