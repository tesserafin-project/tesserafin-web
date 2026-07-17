function isTv(userAgent) {
    // This is going to be really difficult to get right

    // The OculusBrowsers userAgent also has the samsungbrowser defined but is not a tv.
    if (userAgent.includes('oculusbrowser')) {
        return false;
    }

    if (userAgent.includes('tv')) {
        return true;
    }

    if (userAgent.includes('samsungbrowser')) {
        return true;
    }

    if (userAgent.includes('viera')) {
        return true;
    }

    if (userAgent.includes('titanos')) {
        return true;
    }

    return false;
}

function isMobile(userAgent) {
    const terms = [
        'mobi',
        'ipad',
        'iphone',
        'ipod',
        'silk',
        'gt-p1000',
        'nexus 7',
        'kindle fire',
        'opera mini'
    ];

    for (const term of terms) {
        if (userAgent.includes(term)) {
            return true;
        }
    }

    return false;
}

function hasKeyboard(browser) {
    if (browser.touch) {
        return true;
    }

    if (browser.xboxOne) {
        return true;
    }

    if (browser.ps4) {
        return true;
    }

    return !!browser.tv;
}

function iOSversion() {
    // MacIntel: Apple iPad Pro 11 iOS 13.1
    if (/iP(hone|od|ad)|MacIntel/.test(navigator.platform)) {
        const tests = [
            // Original test for getting full iOS version number in iOS 2.0+
            /OS (\d+)_(\d+)_?(\d+)?/,
            // Test for iPads running iOS 13+ that can only get the major OS version
            /Version\/(\d+)/
        ];
        for (const test of tests) {
            const matches = RegExp(test).exec(navigator.appVersion);
            if (matches) {
                return [
                    parseInt(matches[1], 10),
                    parseInt(matches[2] || 0, 10),
                    parseInt(matches[3] || 0, 10)
                ];
            }
        }
    }
    return [];
}

let _supportsCssAnimation;
let _supportsCssAnimationWithPrefix;
function supportsCssAnimation(allowPrefix) {
    // TODO: Assess if this is still needed, as all of our targets should natively support CSS animations.
    if (
        allowPrefix &&
        (_supportsCssAnimationWithPrefix === true ||
            _supportsCssAnimationWithPrefix === false)
    ) {
        return _supportsCssAnimationWithPrefix;
    }
    if (_supportsCssAnimation === true || _supportsCssAnimation === false) {
        return _supportsCssAnimation;
    }

    let animation = false;
    const domPrefixes = ['Webkit', 'O', 'Moz'];
    const elm = document.createElement('div');

    if (elm.style.animationName !== undefined) {
        animation = true;
    }

    if (animation === false && allowPrefix) {
        for (const domPrefix of domPrefixes) {
            if (elm.style[domPrefix + 'AnimationName'] !== undefined) {
                animation = true;
                break;
            }
        }
    }

    if (allowPrefix) {
        _supportsCssAnimationWithPrefix = animation;
        return _supportsCssAnimationWithPrefix;
    } else {
        _supportsCssAnimation = animation;
        return _supportsCssAnimation;
    }
}

const uaMatch = function (ua) {
    // Motorola Edge device UA triggers false positive for Edge browser
    ua = ua.replace(/(motorola edge)/, '').trim();

    const match =
        /(edg)[ /]([\w.]+)/.exec(ua) ||
        /(edga)[ /]([\w.]+)/.exec(ua) ||
        /(edgios)[ /]([\w.]+)/.exec(ua) ||
        /(edge)[ /]([\w.]+)/.exec(ua) ||
        /(titanos)[ /]([\w.]+)/.exec(ua) ||
        /(opera)[ /]([\w.]+)/.exec(ua) ||
        /(opr)[ /]([\w.]+)/.exec(ua) ||
        /(chrome)[ /]([\w.]+)/.exec(ua) ||
        /(safari)[ /]([\w.]+)/.exec(ua) ||
        /(firefox)[ /]([\w.]+)/.exec(ua) ||
        (!ua.includes('compatible') &&
            /(mozilla)(?:.*? rv:([\w.]+)|)/.exec(ua)) ||
        [];

    const versionMatch = /(version)[ /]([\w.]+)/.exec(ua);

    let platformMatch =
        /(ipad)/.exec(ua) ||
        /(iphone)/.exec(ua) ||
        /(windows)/.exec(ua) ||
        /(android)/.exec(ua) ||
        /(titanos)/.exec(ua) ||
        [];

    let browser = match[1] || '';

    if (browser === 'edge') {
        platformMatch = [''];
    }

    if (browser === 'opr') {
        browser = 'opera';
    }

    let version;
    if (versionMatch && versionMatch.length > 2) {
        version = versionMatch[2];
    }

    version = version || match[2] || '0';

    let versionMajor = parseInt(version.split('.')[0], 10);

    if (isNaN(versionMajor)) {
        versionMajor = 0;
    }

    return {
        browser,
        version,
        platform: platformMatch[0] || '',
        versionMajor
    };
};

export const detectBrowser = (userAgent = navigator.userAgent) => {
    const normalizedUA = userAgent.toLowerCase();

    const matched = uaMatch(normalizedUA);
    const browser = {};

    if (matched.browser) {
        browser[matched.browser] = true;
        browser.version = matched.version;
        browser.versionMajor = matched.versionMajor;
    }

    if (matched.platform) {
        browser[matched.platform] = true;
    }

    browser.edgeChromium = browser.edg || browser.edga || browser.edgios;

    if (
        !browser.chrome &&
        !browser.edgeChromium &&
        !browser.edge &&
        !browser.opera &&
        normalizedUA.includes('webkit')
    ) {
        browser.safari = true;
    }

    browser.osx = normalizedUA.includes('mac os x');

    // This is a workaround to detect iPads on iOS 13+ that report as desktop Safari
    // This may break in the future if Apple releases a touchscreen Mac
    // https://forums.developer.apple.com/thread/119186
    if (
        browser.osx &&
        !browser.iphone &&
        !browser.ipod &&
        !browser.ipad &&
        navigator.maxTouchPoints > 1
    ) {
        browser.ipad = true;
    }

    if (isMobile(normalizedUA)) {
        browser.mobile = true;
    }

    browser.ps4 = normalizedUA.includes('playstation 4');
    browser.xboxOne = normalizedUA.includes('xbox');

    browser.animate =
        typeof document !== 'undefined' &&
        document.documentElement.animate != null;
    browser.hisense = normalizedUA.includes('hisense');
    browser.vega = normalizedUA.includes('kepler');
    browser.vidaa = normalizedUA.includes('vidaa');

    browser.tv =
        browser.ps4 || browser.vega || browser.xboxOne || isTv(normalizedUA);

    if (browser.titanos) {
        // UserAgent string contains 'Safari', but we only want 'titanos' to be true
        delete browser.safari;
    } else if (browser.vega) {
        // UserAgent string contains 'Chrome' and 'Safari', but we only want 'vega' to be true
        delete browser.chrome;
        delete browser.safari;
        // UserAgent string contains 'Mobile Chrome', but it is a TV
        delete browser.mobile;
    }

    if (browser.mobile || browser.tv) {
        browser.slow = true;
    }

    if (
        (typeof document !== 'undefined' && 'ontouchstart' in window) ||
        navigator.maxTouchPoints > 0
    ) {
        browser.touch = true;
    }

    browser.keyboard = hasKeyboard(browser);
    browser.supportsCssAnimation = supportsCssAnimation;

    browser.iOS = browser.ipad || browser.iphone || browser.ipod;

    if (browser.iOS) {
        browser.iOSVersion = iOSversion();

        if (browser.iOSVersion && browser.iOSVersion.length >= 2) {
            browser.iOSVersion =
                browser.iOSVersion[0] + browser.iOSVersion[1] / 10;
        }
    }

    return browser;
};

export default detectBrowser();
