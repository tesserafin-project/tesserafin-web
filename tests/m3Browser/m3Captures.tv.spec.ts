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
    writeIndex('tv', records);
});

for (const theme of REQUESTED_THEMES) {
    test(`TV captures of every M3 state in ${theme}`, async ({
        page,
        baseURL
    }) => {
        const captured = await captureTheme(page, baseURL!, 'tv', 'tv', theme);
        records.push(...captured);

        expect(captured).toHaveLength(statesFor('tv').length);
        for (const record of captured) {
            expect(record.resolvedTheme).toBe(theme);
            // The TV project is a real 1920x1080 viewport with `hasTouch: false`.
            expect(record.viewport).toBe('1920x1080');
        }

        // A TV capture with nothing focused shows nothing about a remote-driven layout, so the
        // state that puts focus on a meaningful control has to carry it.
        const focused = captured.filter(
            (record) => record.state === 'packs-arrangement'
        );
        expect(focused).toHaveLength(1);
        for (const record of focused) expect(record.focus).not.toBe('none');
    });
}

test('the TV set is matched across both themes', () => {
    assertMatchedPairs(records, statesFor('tv'));
});
