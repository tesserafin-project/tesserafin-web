import { captureTheme, CLASSIC, writeIndex } from './support/captureBody';
import { expect, test } from './support/harness';

test('TV captures of every M3 state', async ({ page, baseURL }) => {
    const records = await captureTheme(page, baseURL!, 'tv', 'tv', CLASSIC);
    writeIndex('tv', records);

    expect(records).toHaveLength(5);
    for (const record of records) expect(record.resolvedTheme).toBe(CLASSIC);
    // The TV project is a real 1920x1080 viewport with `hasTouch: false`.
    for (const record of records) expect(record.viewport).toBe('1920x1080');
});
