import { captureTheme, CLASSIC, writeIndex } from './support/captureBody';
import { expect, test } from './support/harness';

test('mobile captures of every M3 state', async ({ page, baseURL }) => {
    const records = await captureTheme(
        page,
        baseURL!,
        'mobile',
        'mobile',
        CLASSIC
    );
    writeIndex('mobile', records);

    expect(records).toHaveLength(5);
    for (const record of records) expect(record.resolvedTheme).toBe(CLASSIC);
});
