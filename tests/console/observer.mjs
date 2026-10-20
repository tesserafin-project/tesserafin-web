/** Count payloads only in memory; reports contain no message text or URL. */
export function watchConsole(page, origin) {
    const groups = { firstParty: {}, dependency: {}, unknown: {} };
    let pageErrors = 0;
    const listener = (message) => {
        let owner = 'unknown';
        try {
            const url = new URL(message.location().url);
            if (url.origin === origin) {
                const asset = url.pathname.split('/').at(-1);
                // Matches webpack.common.js's node_modules cache group. Copied
                // workers in libraries/ remain dependency output as well.
                if (
                    asset.startsWith('node_modules.') ||
                    url.pathname.includes('/libraries/')
                ) {
                    owner = 'dependency';
                } else if (
                    /\.(bundle|chunk)\.js$/.test(asset) ||
                    asset === 'serviceworker.js'
                ) {
                    owner = 'firstParty';
                }
            }
        } catch {
            // Browser messages / unattributed emissions stay visible and fail closed.
        }
        const level = message.type();
        groups[owner][level] = (groups[owner][level] ?? 0) + 1;
    };
    const onPageError = () => {
        pageErrors++;
    };
    page.on('console', listener);
    page.on('pageerror', onPageError);
    return {
        finish() {
            page.off('console', listener);
            page.off('pageerror', onPageError);
            return { ...groups, pageErrors };
        }
    };
}

/** No severity exceptions. Dependencies are counted/reported, never silenced. */
export function violations(report, ceiling) {
    const failures = [];
    for (const [owner, counts] of Object.entries(report)) {
        if (owner === 'pageErrors') continue;
        if ((counts.warning ?? 0) + (counts.error ?? 0) > 0) {
            failures.push(`${owner}: warning/error`);
        }
    }
    const volume =
        (report.firstParty.log ?? 0) + (report.firstParty.debug ?? 0);
    if (volume > ceiling)
        failures.push(`firstParty: volume ${volume} > ${ceiling}`);
    if (Object.values(report.unknown).some((count) => count > 0)) {
        failures.push('unattributed output');
    }
    if (report.pageErrors > 0) failures.push('uncaught page error');
    return failures;
}
