/**
 * The smallest claim this suite makes: the real production bundle, served with no Reefin server,
 * authenticates against the fixture and renders `/contentpacks` from the server's own projection.
 *
 * Everything else in this directory builds on this, so when the harness itself breaks this is the
 * spec that says so.
 */
import {
    DIST,
    cardSubtitles,
    cardTitles,
    expect,
    openList,
    settled,
    test
} from './support/harness';
import { installFixtureApi } from './support/fixtureApi';
import { MANAGER_A, clone } from './support/profiles';

test('the mosaic renders the packs the server sent, in the server order', async ({
    page,
    baseURL
}) => {
    const fixture = await installFixtureApi(
        page,
        baseURL as string,
        DIST,
        clone(MANAGER_A)
    );

    await openList(page);
    await settled(page);

    // The authored order is deliberately not alphabetical, so a client-side sort would show.
    expect(await cardTitles(page)).toEqual([
        'Weeknights',
        'Archive',
        'Nothing yet'
    ]);

    // Every count is the server's `VisibleItemCount`, verbatim — including the `9` that disagrees
    // with the four items the authorized page holds, and the `0`.
    const subtitles = await cardSubtitles(page);
    expect(subtitles[0]).toContain('9');
    expect(subtitles[1]).toContain('1');
    expect(subtitles[2]).toContain('0');

    expect(fixture.ledger.undeclared).toEqual([]);
    expect(fixture.ledger.requests).toContain('GET /ContentPacks');
});
