/**
 * Desktop captures, once per official theme, through the application's own theme resolution.
 *
 * The earlier version of this file asserted that Frosted Glass could not resolve in a server-free
 * run. That was true of the fixture, not of the product: the install script rewrote
 * `jellyfin_credentials` on every boot, so the reload threw away the session the wizard had just
 * created and the application came back anonymous with no user theme to resolve. The fixture now
 * leaves a live session alone, and both themes resolve.
 */
import {
    assertMatchedPairs,
    captureTheme,
    CLASSIC,
    FROSTED,
    REQUESTED_THEMES,
    statesFor,
    writeIndex,
    type CaptureRecord
} from './support/captureBody';
import { expect, test } from './support/harness';

const records: CaptureRecord[] = [];

test.afterAll(() => {
    writeIndex('desktop', records);
});

for (const theme of REQUESTED_THEMES) {
    test(`desktop captures of every M3 state in ${theme}`, async ({
        page,
        baseURL
    }) => {
        const captured = await captureTheme(
            page,
            baseURL!,
            'desktop',
            'desktop',
            theme
        );
        records.push(...captured);

        expect(captured).toHaveLength(statesFor('desktop').length);
        for (const record of captured) {
            // `shoot()` refuses to write anything else, so this is the assertion restating the
            // guarantee rather than discovering it.
            expect(record.requestedTheme).toBe(theme);
            expect(record.resolvedTheme).toBe(theme);
            expect(record.userId).not.toBeNull();
            expect(record.persisted.value).toBe(theme);
            expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
        }
    });
}

test('the two themes produced a matched pair of every required state', () => {
    assertMatchedPairs(records, statesFor('desktop'));

    const classic = records.filter((r) => r.requestedTheme === CLASSIC);
    const frosted = records.filter((r) => r.requestedTheme === FROSTED);
    expect(classic).toHaveLength(statesFor('desktop').length);
    expect(frosted).toHaveLength(statesFor('desktop').length);

    /*
     * Two themes that resolved to the same presentation would make the pairing pointless, so the
     * floor is that the resolved values actually differ. This is NOT the deferred project of making
     * Classic and Frosted look more different from each other.
     *
     * The comparison is on resolved TOKENS rather than on the `data-rf-*` recipe attributes,
     * because on these surfaces the recipe attribute set is empty — the presentation record is
     * bound on the modern Item Details route, and the wizard, the toolbar and Display preferences
     * carry the theme through tokens alone. The index records the empty recipe rather than hiding
     * it, and that is a fact about where the recipe is bound today, not about these captures.
     */
    const tokensOf = (list: CaptureRecord[]) =>
        JSON.stringify(
            list.find((r) => r.state === 'packs-none')?.tokens ?? {}
        );
    expect(tokensOf(classic)).not.toBe(tokensOf(frosted));

    for (const record of records) {
        expect(Object.keys(record.tokens)).toHaveLength(3);
        for (const value of Object.values(record.tokens)) {
            expect(value).not.toBe('');
        }
    }
});
