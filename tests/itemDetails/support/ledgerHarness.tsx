/**
 * The mount harness the ledger suites share.
 *
 * It differs from `modernHarness` in one way that matters: the fail-closed API is built from the
 * LEDGER's declared member set for the class under test, not from the historical P5 read inventory.
 * That is what makes "runtime -> ledger" fail closed at the API surface — a member the ledger does
 * not declare throws on property access, before the route can pretend it succeeded.
 *
 * Every outward SERVICE is recorded too, on the same `Observation` shape as the API surfaces, so a
 * playback call and a `getItem` call are judged by one comparator.
 */
import React from 'react';
import { vi } from 'vitest';

import {
    ITEM_DETAILS_CASES,
    type ItemDetailsCase
} from '../../fixtures/item-details/cases';
import { createFailClosedApi, type FailClosedApi } from './failClosedApi';
import { createTestQueryClient, renderRoute, settle } from './modernHarness';
import { legacyResponders, sdkResponders } from './responders';
import { ledgerClass, type LedgerClass, type Observation } from './ledger';

/** Every service call the route made, in order. Cleared by {@link resetServiceLedger}. */
export const serviceLedger: Observation[] = [];

export function resetServiceLedger(): void {
    serviceLedger.length = 0;
}

const record = (surface: string, member: string, args: unknown[]) => {
    serviceLedger.push({ surface, member, args });
};

/**
 * The mocked outward services.
 *
 * These are not conveniences: each one is a module the effect-frontier audit classifies as an
 * outward surface, and recording it here is how an action's payload becomes assertable.
 */
export const services = {
    playbackManager: {
        canPlay: vi.fn(
            (item: { Type?: string; MediaType?: string }) =>
                ['Video', 'Audio'].includes(item?.MediaType ?? '') ||
                [
                    'Series',
                    'Season',
                    'MusicAlbum',
                    'MusicArtist',
                    'Playlist',
                    'BoxSet',
                    'MusicGenre',
                    'Genre'
                ].includes(item?.Type ?? '')
        ),
        getSupportedCommands: vi.fn(() => ['PlayMediaSource', 'PlayTrailers']),
        play: vi.fn((options: unknown) =>
            record('service.playbackManager', 'play', [options])
        ),
        playTrailers: vi.fn((item: unknown) =>
            record('service.playbackManager', 'playTrailers', [item])
        ),
        instantMix: vi.fn((item: unknown) =>
            record('service.playbackManager', 'instantMix', [item])
        ),
        shuffle: vi.fn((item: unknown) =>
            record('service.playbackManager', 'shuffle', [item])
        )
    },
    itemContextMenu: {
        getCommands: vi.fn(() => Promise.resolve(['delete'])),
        show: vi.fn((options: unknown) => {
            record('service.itemContextMenu', 'show', [options]);
            return Promise.resolve({});
        })
    },
    confirm: vi.fn((message: string, title: string) => {
        record('service.confirm', 'confirm', [message, title]);
        return Promise.resolve();
    }),
    download: vi.fn((items: unknown) =>
        record('service.fileDownloader', 'download', [items])
    ),
    dashboard: {
        navigate: vi.fn((path: string) =>
            record('service.dashboard', 'navigate', [path])
        )
    },
    recordingHelper: {
        cancelTimer: vi.fn((client: unknown, timerId: unknown) => {
            record('service.recordingHelper', 'cancelTimer', [client, timerId]);
            return Promise.resolve();
        }),
        cancelSeriesTimerWithConfirmation: vi.fn(
            (itemId: unknown, serverId: unknown) => {
                record(
                    'service.recordingHelper',
                    'cancelSeriesTimerWithConfirmation',
                    [itemId, serverId]
                );
                return Promise.resolve();
            }
        )
    },
    appRouter: {
        showItem: vi.fn((id: unknown, serverId: unknown) =>
            record('service.appRouter', 'showItem', [id, serverId])
        ),
        goHome: vi.fn(() => record('service.appRouter', 'goHome', [])),
        getRouteUrl: vi.fn(
            (item: { Id?: string; Type?: string }) =>
                `#/details?id=${item?.Id ?? ''}`
        )
    },
    events: {
        trigger: vi.fn((target: unknown, name: unknown) => {
            if (typeof name === 'string')
                record('service.events', 'trigger', ['<document>', name]);
        }),
        on: vi.fn(),
        off: vi.fn()
    },
    userDataApi: new Proxy(
        {},
        {
            get:
                (_target, property: string) =>
                (...args: unknown[]) => {
                    record('sdk.userData', property, args);
                    return Promise.resolve({
                        data: { Played: true, IsFavorite: true }
                    });
                }
        }
    )
};

export const libraryApiRef: { current: Record<string, unknown> } = {
    current: {}
};

export const serverConnections = {
    getApiClient: vi.fn(),
    currentApiClient: vi.fn(),
    getApi: vi.fn()
};

export function findCase(id: string): ItemDetailsCase {
    const found = ITEM_DETAILS_CASES.find((entry) => entry.id === id);
    if (!found)
        throw new Error(`[item-details ledger] no case fixture for "${id}"`);
    return found;
}

/** The distinct API members the ledger declares for a class, per surface. */
export function declaredMembers(
    cls: LedgerClass,
    surface: 'legacy' | 'sdk'
): string[] {
    return [
        ...new Set(
            cls.requests
                .filter((row) => row.surface === surface)
                .map((row) => row.member)
        )
    ];
}

function pickDeclared(
    menu: Record<string, unknown>,
    allowed: string[]
): Record<string, unknown> {
    const picked: Record<string, unknown> = {};
    for (const name of allowed) {
        if (!(name in menu)) {
            throw new Error(
                `[item-details ledger] the ledger declares "${name}" but tests/itemDetails/support/responders.ts ` +
                    'has no responder for it.'
            );
        }
        picked[name] = menu[name];
    }
    return picked;
}

export interface LedgerMount {
    container: HTMLElement;
    api: FailClosedApi;
    unmount: () => void;
}

export interface MountOptions {
    /** Applied on top of the class fixture's item. Used only by declared ledger variants. */
    itemOverride?: Record<string, unknown>;
}

/**
 * Mount one equivalence class with the ledger's own member set as the permission grant.
 */
export async function mountForLedger(
    classId: string,
    options: MountOptions = {}
): Promise<LedgerMount> {
    const cls = ledgerClass(classId);
    const testCase = findCase(classId);
    const item = { ...testCase.item, ...(options.itemOverride ?? {}) };

    const responderOptions = {
        item,
        user: testCase.user,
        lists: testCase.lists
    };
    const api = createFailClosedApi({
        legacy: pickDeclared(
            legacyResponders(responderOptions),
            declaredMembers(cls, 'legacy')
        ),
        sdk: pickDeclared(
            sdkResponders(responderOptions),
            declaredMembers(cls, 'sdk')
        )
    });

    libraryApiRef.current = api.libraryApi;
    serverConnections.getApiClient.mockReturnValue(api.apiClient);
    serverConnections.currentApiClient.mockReturnValue(api.apiClient);
    serverConnections.getApi.mockReturnValue({});

    const { default: ItemDetailsPage } = await import(
        '../../../src/apps/modern/features/details/components/ItemDetailsPage'
    );
    const mounted = await renderRoute(
        <ItemDetailsPage searchParams={new URLSearchParams(testCase.params)} />,
        createTestQueryClient()
    );

    /*
     * The delegated recording widget arrives through a dynamic import inside an effect. Waiting for
     * ITS OWN read rather than for a fixed number of turns is what keeps the program class's
     * multiplicity assertions deterministic.
     */
    if (cls.requests.some((row) => row.phase === 'delegated')) {
        for (let turn = 0; turn < 40; turn++) {
            if (api.calls.some((call) => call.method === 'getLiveTvProgram'))
                break;
            await settle(1);
        }
        await settle(2);
    }

    return { container: mounted.container, api, unmount: mounted.unmount };
}

/** The observations a mount produced, API surfaces and services together. */
export function observationsOf(api: FailClosedApi, from = 0): Observation[] {
    return api.calls.slice(from).map((call) => ({
        surface: call.surface,
        member: call.method,
        args: call.args
    }));
}

export const actionControl = (
    root: HTMLElement,
    name: string
): HTMLElement | null => {
    const wrap = root.querySelector<HTMLElement>(
        `[data-detail-action="${name}"]`
    );
    if (!wrap) return null;
    return wrap.tagName === 'BUTTON'
        ? wrap
        : wrap.querySelector<HTMLElement>('button');
};

export const selectControl = (root: HTMLElement, name: string) =>
    root.querySelector<HTMLSelectElement>(`[data-detail-select="${name}"]`);

/** Activate a control the way a viewer does. */
export async function activate(element: HTMLElement | null): Promise<void> {
    if (!element)
        throw new Error('[item-details ledger] the control is not rendered');
    const { act } = await import('react');
    await act(async () => {
        element.focus();
        element.click();
        await Promise.resolve();
    });
    await settle(6);
}

/** Activate a control with the keyboard alone, then confirm the browser default fired. */
export async function activateByKeyboard(
    element: HTMLElement | null
): Promise<boolean> {
    if (!element)
        throw new Error('[item-details ledger] the control is not rendered');
    const { act } = await import('react');
    let defaultPrevented = false;
    await act(async () => {
        element.focus();
        const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true
        });
        defaultPrevented = !element.dispatchEvent(event);
        // jsdom does not synthesise the activation behaviour a browser derives from Enter on a
        // button; the browser suite proves that end of it. Here the click completes the sequence.
        element.click();
        await Promise.resolve();
    });
    await settle(6);
    return !defaultPrevented && document.activeElement === element;
}

export async function changeSelect(
    element: HTMLSelectElement | null,
    value: string
): Promise<void> {
    if (!element)
        throw new Error('[item-details ledger] the selector is not rendered');
    const { act } = await import('react');
    await act(async () => {
        element.focus();
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
    });
    await settle(2);
}
