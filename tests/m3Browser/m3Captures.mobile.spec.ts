import {
    assertMatchedPairs,
    captureTheme,
    REQUESTED_THEMES,
    statesFor,
    writeIndex,
    type CaptureRecord
} from './support/captureBody';
import { expect, test } from './support/harness';

const records: CaptureRecord[] = [];

test.afterAll(() => {
    writeIndex('mobile', records);
});

for (const theme of REQUESTED_THEMES) {
    test(`mobile captures of every M3 state in ${theme}`, async ({
        page,
        baseURL
    }) => {
        const captured = await captureTheme(
            page,
            baseURL!,
            'mobile',
            'mobile',
            theme
        );
        records.push(...captured);

        expect(captured).toHaveLength(statesFor('mobile').length);
        for (const record of captured) {
            expect(record.resolvedTheme).toBe(theme);
            expect(record.persisted.value).toBe(theme);
        }
    });
}

test('the mobile set is matched across both themes', () => {
    assertMatchedPairs(records, statesFor('mobile'));
});
