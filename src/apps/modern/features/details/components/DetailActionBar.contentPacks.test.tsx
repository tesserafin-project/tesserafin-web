// @vitest-environment jsdom
/**
 * The content-pack affordance on the Item Details action bar (#138 §8, §9.14).
 *
 * The ABSENT half is already proved at scale: `tests/itemDetails/` replays all 24 equivalence
 * classes, none of whose acting users has `EnableContentPackManagement`, and the ledger declares
 * `btnContentPacks` absent in every one of them. What that suite cannot show is the PRESENT half —
 * no fixture user has the capability — so this covers it, plus the exact gate in both directions on
 * one class.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    mountRoute,
    settle,
    unmountAll
} from '../../contentPacks/testing/harness';

vi.stubGlobal('__WEBPACK_SERVE__', false);

vi.mock('lib/globalize', () => ({
    default: { translate: (key: string) => key },
    translate: (key: string) => key
}));

const apiState: {
    reefinApi?: unknown;
    user?: { Id?: string; Policy?: Record<string, unknown> };
} = {};
vi.mock('hooks/useApi', () => ({ useApi: () => apiState }));

// The action bar's own dependencies, stubbed to their inert answers: this suite is about one
// control's presence, not about playback capability or the context menu.
vi.mock('components/itemContextMenu', () => ({
    default: {
        getCommands: () => Promise.resolve([]),
        show: () => Promise.resolve({})
    }
}));
/*
 * `ServerConnections` also imports `appHost` and calls `utils/dashboard`'s `capabilities(appHost)`
 * at module load, which reaches `getPushTokenInfo()`. The mock has to answer that too or the whole
 * suite dies at import with "host.getPushTokenInfo is not a function".
 */
vi.mock('components/apphost', () => ({
    appHost: {
        supports: () => false,
        getPushTokenInfo: () => ({}),
        deviceName: () => 'Test Device',
        deviceId: () => 'device-1',
        appName: () => 'Tesserafin Web',
        appVersion: () => '1.0.0'
    }
}));
vi.mock('elements/emby-playstatebutton/PlayedButton', () => ({
    default: () => null
}));
vi.mock('elements/emby-ratingbutton/FavoriteButton', () => ({
    default: () => null
}));

const DetailActionBar = (await import('./DetailActionBar')).default;

const ITEM = {
    Id: 'item-1',
    Name: 'A Film',
    Type: 'Movie',
    MediaType: 'Video',
    UserData: {}
} as never;
const USER = { Id: 'user-1' } as never;
const ACTIONS = {
    play: vi.fn(),
    replay: vi.fn(),
    instantMix: vi.fn(),
    shuffle: vi.fn(),
    playTrailer: vi.fn(),
    showContextMenu: vi.fn(),
    splitVersions: vi.fn(),
    cancelTimer: vi.fn(),
    cancelSeriesTimer: vi.fn(),
    downloadItem: vi.fn()
};

beforeEach(() => {
    apiState.reefinApi = {};
    apiState.user = { Id: 'user-1', Policy: {} };
});

afterEach(() => {
    unmountAll();
    vi.clearAllMocks();
});

const render = async () => {
    const tree = mountRoute(
        <DetailActionBar item={ITEM} user={USER} actions={ACTIONS} />
    );
    await settle(3);
    return tree;
};

const control = (container: HTMLElement) =>
    container.querySelector('[data-detail-action="btnContentPacks"]');

describe('the gate is exactly EnableContentPackManagement', () => {
    it.each([
        ['no policy at all', {}],
        [
            'the capability explicitly false',
            { EnableContentPackManagement: false }
        ],
        ['an administrator without it', { IsAdministrator: true }]
    ])('is absent with %s', async (_name, policy) => {
        apiState.user = { Id: 'user-1', Policy: policy };
        const { container } = await render();

        expect(control(container)).toBeNull();
    });

    it('is present with the capability', async () => {
        apiState.user = {
            Id: 'user-1',
            Policy: { EnableContentPackManagement: true }
        };
        const { container } = await render();

        const button = control(container);
        expect(button).not.toBeNull();
        expect(button?.getAttribute('aria-label')).toBe(
            'HeaderContentPackAssign'
        );
    });

    it('opens nothing until the control is used, so the feature chunk stays unrequested', async () => {
        apiState.user = {
            Id: 'user-1',
            Policy: { EnableContentPackManagement: true }
        };
        await render();

        // The dialog is behind `lazy()` and is not even rendered until the button is clicked.
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
});
