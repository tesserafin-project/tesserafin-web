/**
 * The modern desktop row of the layout reach matrix (#139 gates 4 and 5).
 *
 * `m3.navigation.spec.ts` already proves the modern toolbar in detail — absent values, unrecognised
 * values, one member's choice not leaking into another's. This spec is the row of the matrix, run
 * through the same helper as the legacy rows, so that "every layout reads the server-owned
 * preference" is one executable statement rather than four differently-shaped specs that happen to
 * agree.
 */
import { MODERN_DESKTOP, proveArrangementReach } from './support/layoutMatrix';
import { expect, test } from './support/harness';

test(`the arrangement reaches ${MODERN_DESKTOP.label}`, async ({
    page,
    baseURL
}) => {
    const row = await proveArrangementReach(page, baseURL!, MODERN_DESKTOP);

    expect(row.settingReachable).toBe(true);
    expect(row.persistsServerSide).toBe(true);
    expect(row.navigationChanges).toBe(true);
});
