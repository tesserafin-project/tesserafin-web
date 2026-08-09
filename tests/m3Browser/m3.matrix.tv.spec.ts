/**
 * The television row of the layout reach matrix (#139 gates 4 and 5).
 *
 * `tv` is in `LegacyLayoutModes`, so a television has always booted `apps/legacy` here. Its primary
 * navigation is the nav drawer `scripts/libraryMenu.js` builds — the modern toolbar is not on the
 * page — and the arrangement has to reach that drawer or a household watching on a television would
 * see no effect from the choice the wizard asked it to make.
 *
 * The modern toolbar is deliberately not imported to satisfy this, and the layout is not forced to
 * modern: `proveArrangementReach` asserts the application agrees it is in TV layout before it
 * asserts anything else.
 */
import { LEGACY_TV, proveArrangementReach } from './support/layoutMatrix';
import { expect, test } from './support/harness';

test(`the arrangement reaches ${LEGACY_TV.label}`, async ({
    page,
    baseURL
}) => {
    const row = await proveArrangementReach(page, baseURL!, LEGACY_TV);

    expect(row.settingReachable).toBe(true);
    expect(row.persistsServerSide).toBe(true);
    expect(row.navigationChanges).toBe(true);
});
