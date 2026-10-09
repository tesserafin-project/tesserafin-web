import { request } from '@playwright/test';
import { expect, test } from './support/origin-inventory';
import {
    AUTH_HEADER,
    BASE_URL,
    MOVIE_TITLE,
    PASSWORD,
    USER,
    signIn
} from './support/b2';

/**
 * POLISH-1 — the open Home page follows the server.
 *
 * WHAT THIS PINS. The Home queries are fresh for a minute and persisted to IndexedDB, so before
 * `QueryClientEventHandler` listened to the server's own change messages a Home page that was
 * already on screen never learned that anything had changed — and a reload inside that minute did
 * not ask either. The visible first-run symptom was a home page frozen on a half-finished scan.
 *
 * WHY PLAY STATE AND NOT A LIBRARY. Adding a library would do it too, but `library.spec.ts` needs
 * this rig to hold exactly one movies library with exactly two items. A resume position on a
 * seeded movie travels the same path — a WebSocket message invalidating `['Home', userId]` — and
 * is undone in `finally` without touching the library.
 *
 * NO RELOAD AND NO NAVIGATION between the change and the assertion: either would make this pass
 * on the old code after the stale minute and prove nothing.
 */
test('the open Home page shows a new resume position without a reload', async ({
    page
}) => {
    const api = await request.newContext({ baseURL: BASE_URL });
    const auth = await api.post('/Users/AuthenticateByName', {
        headers: { Authorization: AUTH_HEADER },
        data: { Username: USER, Pw: PASSWORD }
    });
    expect(auth.ok(), 'the admin fixture user must authenticate').toBe(true);
    const { AccessToken, User } = await auth.json();
    const headers = { Authorization: `${AUTH_HEADER}, Token="${AccessToken}"` };

    const found = await api.get(
        `/Items?recursive=true&includeItemTypes=Movie&searchTerm=${encodeURIComponent(MOVIE_TITLE)}&userId=${User.Id}`,
        { headers }
    );
    const movieId = (await found.json()).Items[0].Id as string;
    const userData = `/UserItems/${movieId}/UserData?userId=${User.Id}`;

    let changed = false;
    try {
        await signIn(page);
        const continueWatching = page.getByRole('heading', {
            name: 'Continue Watching'
        });
        await expect(page.getByText('My Media').first()).toBeVisible({
            timeout: 25_000
        });
        await expect(
            continueWatching,
            'precondition: nothing is in progress on this rig'
        ).toHaveCount(0);

        changed = true;
        const saved = await api.post(userData, {
            headers,
            data: { PlaybackPositionTicks: 5_000_000 }
        });
        expect(saved.ok(), 'the resume position must be accepted').toBe(true);

        await expect(
            continueWatching,
            'the open Home page must show the new resume position on its own'
        ).toBeVisible({ timeout: 20_000 });
    } finally {
        // Only undo what this test did: a rig that already had something in progress fails the
        // precondition, and its state is evidence, not ours to clear.
        if (changed) {
            await api.post(userData, {
                headers,
                data: { PlaybackPositionTicks: 0 }
            });
        }
        await api.dispose();
    }
});
