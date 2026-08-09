/**
 * The two phone rows of the layout reach matrix (#139 gates 4 and 5).
 *
 * A phone is not one shell. `layout=mobile` boots the modern app; `layout=mobile-legacy` boots
 * `apps/legacy`, where the MUI toolbar this branch first proved the arrangement on is never
 * rendered at all. Both are shipped, so both are rows.
 *
 * Runs in the `mobile` project against a real `Pixel 7` descriptor rather than a narrow desktop
 * window: reflow and touch are the two things a resized desktop cannot report honestly.
 */
import {
    LEGACY_PHONE,
    MODERN_MOBILE,
    proveArrangementReach
} from './support/layoutMatrix';
import { expect, test } from './support/harness';

for (const layoutCase of [MODERN_MOBILE, LEGACY_PHONE]) {
    test(`the arrangement reaches ${layoutCase.label}`, async ({
        page,
        baseURL
    }) => {
        const row = await proveArrangementReach(page, baseURL!, layoutCase);

        expect(row.settingReachable).toBe(true);
        expect(row.persistsServerSide).toBe(true);
        expect(row.navigationChanges).toBe(true);
    });
}
