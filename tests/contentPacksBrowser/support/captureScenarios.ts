/**
 * The states the capture matrix names, each set up once and reused by all three viewport specs.
 *
 * One module rather than three copies, because the point of a matched matrix is that the desktop,
 * mobile and TV pictures of "populated mosaic" are the same STATE at three widths. Three
 * hand-written setups would drift and the reviewer would be comparing different things.
 */
import type { Page } from '@playwright/test';

import { installFixtureApi, type FixtureProfile } from './fixtureApi';
import { DIST, PAGE, sel, settled } from './harness';
import { MANAGER_A, MANAGER_EMPTY, VIEWER_A, clone } from './profiles';

export interface ScenarioContext {
    page: Page;
    baseURL: string;
    theme: string;
    layout?: 'tv';
}

const install = async (
    { page, baseURL, theme, layout }: ScenarioContext,
    base: FixtureProfile
) => {
    const profile = clone(base);
    profile.theme = theme;
    if (layout) profile.layout = layout;
    return installFixtureApi(page, baseURL, DIST, profile);
};

export interface Scenario {
    /** Matrix row name; also the capture filename stem. */
    state: string;
    /** What a reviewer should look at in this picture. */
    inspect: string;
    /** Must be visible before the shutter opens. */
    waitFor: string;
    run: (context: ScenarioContext) => Promise<void>;
}

const openList = async (page: Page) => {
    await page.goto('/#/contentpacks');
    await page.waitForSelector(`${PAGE} ${sel('mosaic-heading')}`, {
        timeout: 45_000
    });
    await settled(page);
};

export const POPULATED_MOSAIC: Scenario = {
    state: 'populated-mosaic',
    inspect:
        'Hierarchy and density of the card grid; the server order (Weeknights, Archive, Nothing yet); the count under each card, including the 0; the placeholder on the pack whose representative the server declined to name.',
    waitFor: `${PAGE} [data-rf-slot="media-card"]`,
    run: async (context) => {
        await install(context, MANAGER_A);
        await openList(context.page);
    }
};

export const MIXED_MEDIA_PACK: Scenario = {
    state: 'mixed-media-pack',
    inspect:
        'One aspect for the whole grid, with a film, an episode, an album and a book side by side; the episode carrying its series artwork; the heading and the server count (9), which is deliberately larger than the four items shown.',
    waitFor: `${PAGE} ${sel('pack-name')}`,
    run: async (context) => {
        await install(context, MANAGER_A);
        await context.page.goto('/#/contentpacks/pack-weeknights');
        await context.page.waitForSelector(`${PAGE} ${sel('pack-name')}`, {
            timeout: 45_000
        });
        await settled(context.page);
    }
};

export const MANAGER_CONTROLS: Scenario = {
    state: 'manager-controls',
    inspect:
        'The management row: target size, the disabled first move-up and last move-down, and whether the controls read as belonging to the pack named beside them.',
    waitFor: `${PAGE} ${sel('manage-list')}`,
    run: async (context) => {
        await install(context, MANAGER_A);
        await openList(context.page);
    }
};

export const DELETE_CONFIRMATION: Scenario = {
    state: 'delete-confirmation',
    inspect:
        'Whether the seven-part scope sentence reads as reassuring rather than alarming, and whether the pack being deleted is unmistakable.',
    waitFor: `[role="dialog"] ${sel('delete-scope')}`,
    run: async (context) => {
        await install(context, MANAGER_A);
        await context.page.goto('/#/contentpacks/pack-weeknights');
        await context.page.waitForSelector(`${PAGE} ${sel('detail-delete')}`, {
            timeout: 45_000
        });
        await settled(context.page);
        await context.page.locator(sel('detail-delete')).click();
    }
};

export const ITEM_ASSIGNMENT: Scenario = {
    state: 'item-assignment',
    inspect:
        'The assignment dialog over Item Details: every accessible pack listed, the current membership marked, and whether the row labels make the add/remove direction obvious.',
    waitFor: `[role="dialog"] ${sel('assign-list')}`,
    run: async (context) => {
        await install(context, MANAGER_A);
        await context.page.goto('/#/details?id=movie-1&serverId=server-1');
        await context.page.waitForSelector(
            '#itemDetailPage [data-detail-section="nameContainer"] h1',
            { timeout: 45_000 }
        );
        await context.page
            .locator('#itemDetailPage [data-detail-action="btnContentPacks"]')
            .click();
    }
};

export const NON_MANAGER: Scenario = {
    state: 'non-manager',
    inspect:
        'The same mosaic with no management surface at all — not a disabled row, an absent one. Check the page still reads as complete rather than as something with a hole in it.',
    waitFor: `${PAGE} [data-rf-slot="media-card"]`,
    run: async (context) => {
        await install(context, VIEWER_A);
        await openList(context.page);
    }
};

export const EMPTY_STATE: Scenario = {
    state: 'empty-state',
    inspect:
        'The empty mosaic: the heading, the explanation, and the create control still offered — an empty list is where it matters most.',
    waitFor: '[data-rf-slot="state-empty"]',
    run: async (context) => {
        await install(context, MANAGER_EMPTY);
        await openList(context.page);
    }
};

export const ERROR_STATE: Scenario = {
    state: 'error-state',
    inspect:
        'The failed list: whether the message and its retry read as recoverable, and whether the page still says where the viewer is.',
    waitFor: '[data-rf-slot="state-error"]',
    run: async (context) => {
        const fixture = await install(context, MANAGER_A);
        fixture.profile.faults = { listStatus: 500 };
        await openList(context.page);
    }
};

/**
 * The TV focus state: the same surface with a control actually focused, because what a TV reviewer
 * needs to judge is whether the focus ring is visible from across a room.
 */
export const TV_FOCUS_MOSAIC: Scenario = {
    state: 'populated-mosaic',
    inspect:
        'Focus visibility at TV distance: the ring on the first card, and whether the grid density still reads from a sofa.',
    waitFor: `${PAGE} [data-rf-slot="media-card"]`,
    run: async (context) => {
        await install(context, MANAGER_A);
        await openList(context.page);
        await context.page
            .locator(`${PAGE} [data-rf-slot="media-card"]`)
            .first()
            .focus();
    }
};

export const TV_FOCUS_PACK: Scenario = {
    state: 'mixed-media-pack',
    inspect:
        'Focus visibility at TV distance on the detail route, with the rename control focused.',
    waitFor: `${PAGE} ${sel('pack-name')}`,
    run: async (context) => {
        await install(context, MANAGER_A);
        await context.page.goto('/#/contentpacks/pack-weeknights');
        await context.page.waitForSelector(`${PAGE} ${sel('detail-rename')}`, {
            timeout: 45_000
        });
        await settled(context.page);
        await context.page.locator(sel('detail-rename')).focus();
    }
};
