import {
    captureTheme,
    CLASSIC,
    FROSTED,
    writeIndex,
    type CaptureRecord
} from './support/captureBody';
import { expect, test } from './support/harness';

const records: CaptureRecord[] = [];

test.afterAll(() => {
    writeIndex('desktop', records);
});

test('desktop captures of every M3 state', async ({ page, baseURL }) => {
    records.push(
        ...(await captureTheme(page, baseURL!, 'desktop', 'desktop', CLASSIC))
    );

    expect(records).toHaveLength(5);
    // Named by what resolved, so a file called `classic` cannot be anything else.
    for (const record of records) {
        expect(record.resolvedTheme).toBe(CLASSIC);
        expect(record.file).toContain('-classic-');
    }
});

/**
 * Frosted Glass is NOT reachable in a server-free wizard run, and this test says so out loud rather
 * than letting a set of Classic images sit under Frosted filenames.
 *
 * `userSettings.theme()` resolves through DisplayPreferences, which the theme picker writes and
 * which a server-free fixture cannot meaningfully author; the `appSettings` fallback the fixture
 * does write is namespaced by the signed-in user id and is read at boot, before the wizard has one.
 * Requesting Frosted therefore lands on Classic — which is what this asserts.
 *
 * The consequence for review: the M3 captures show one theme. Classic/Frosted differentiation is
 * deferred work in its own right, and a capture set that pretended to cover it would be the
 * misleading half of that deferral.
 */
test('Frosted Glass does not resolve in a server-free wizard run', async ({
    page,
    baseURL
}) => {
    const frosted = await captureTheme(
        page,
        baseURL!,
        'desktop-frosted-attempt',
        'desktop',
        FROSTED
    );

    for (const record of frosted) {
        expect(record.theme).toBe(FROSTED);
        expect(record.resolvedTheme).toBe(CLASSIC);
    }
    records.push(...frosted);
});
