/**
 * #129 Step 1c: the migrated Item Details request and action ledger, proven in both directions.
 *
 * `tests/fixtures/item-details/migrated-request-action-ledger.json` is the authoritative record.
 * This suite is what makes it a CONTRACT rather than a description:
 *
 *   1. runtime -> ledger  every observed request and action matches exactly one row. An undeclared
 *                         API member cannot even be reached: the fail-closed proxy is built from
 *                         the ledger's own member set, so it throws on property access.
 *   2. ledger -> runtime  every applicable row is exercised. An orphaned row fails.
 *   3. affordance         every interactive node in the mounted tree is an executable action, an
 *                         explicit LOCAL_ONLY control, an explicit disabled control with a reason,
 *                         a declared navigation, or a declared delegated control.
 *   4. multiplicity       a missing, duplicated or repeated call fails.
 *   5. identity           arguments are written in identity ROLES and resolved per class, so an
 *                         item id where a media-source, channel or timer id belongs fails.
 *
 * Nothing here reads `usePresentation()` or `presentation.page.itemDetails`. Step 2 must leave
 * every assertion below unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import contract from '../fixtures/item-details/legacy-contract.json';
import {
    INTERACTIVE_SELECTOR,
    LEDGER,
    classifyAffordance,
    compareLedgerRuns,
    describeBreach,
    ledgerClass,
    requestMatches,
    resolveValue,
    valueMatches,
    type LedgerActionRow,
    type LedgerClass,
    type Observation
} from './support/ledger';
import { unmountAll } from './support/modernHarness';

vi.setConfig({ testTimeout: 60_000 });
vi.stubGlobal('__WEBPACK_SERVE__', false);
vi.mock('webcomponents.js/webcomponents-lite', () => ({}));

vi.mock('../../src/lib/globalize', () => {
    const translate = (key: string, ...args: unknown[]) =>
        args.length ? [key, ...args].join(' ') : key;
    const api = {
        translate,
        translateHtml: (html: string) => html,
        loadStrings: () => Promise.resolve(),
        defaultModule: () => 'core',
        getCurrentLocale: () => 'en-us',
        getCurrentDateTimeLocale: () => 'en-us',
        getDefaultLanguage: () => 'en-us',
        register: () => undefined,
        updateCurrentCulture: () => undefined,
        getIsRTL: () => false,
        getIsElementRTL: () => false,
        normalizeLocaleName: (culture: string) => culture
    };
    return { ...api, FALLBACK_CULTURE: 'en-us', default: api };
});

vi.mock('../../src/lib/jellyfin-apiclient', async () => {
    const { serverConnections } = await import('./support/ledgerHarness');
    return {
        ServerConnections: serverConnections,
        ConnectionState: { SignedIn: 'SignedIn' },
        ConnectionMode: { Local: 0, Remote: 1, Manual: 2 }
    };
});
vi.mock('../../src/lib/jellyfin-apiclient/ServerConnections', async () => {
    const { serverConnections } = await import('./support/ledgerHarness');
    return { default: serverConnections };
});
vi.mock('@jellyfin/sdk/lib/utils/api/library-api', async () => {
    const { libraryApiRef } = await import('./support/ledgerHarness');
    return { getLibraryApi: () => libraryApiRef.current };
});

/*
 * The user-data mutations run for real, through `hooks/useFetchItems`, and are observed where they
 * leave the application: at `getUserDataApi(api)`. Stubbing the mutation hooks instead — which the
 * P6 action suite does, because it asserts something else — would make the played and favourite
 * rows unfalsifiable, and those are the two mutations this route owns.
 */
vi.mock('@jellyfin/sdk/lib/utils/api/user-data-api', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { getUserDataApi: () => services.userDataApi };
});
vi.mock('../../src/hooks/useApi', () => ({
    useApi: () => ({ api: { axiosInstance: {} }, user: { Id: 'user-1' } })
}));

vi.mock('../../src/components/playback/playbackmanager', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { playbackManager: services.playbackManager };
});
vi.mock('../../src/components/itemContextMenu', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { default: services.itemContextMenu };
});
vi.mock('../../src/components/confirm/confirm', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { default: services.confirm };
});
vi.mock('../../src/scripts/fileDownloader', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { download: services.download };
});
vi.mock('../../src/utils/dashboard', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { default: services.dashboard };
});
vi.mock('../../src/components/recordingcreator/recordinghelper', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { default: services.recordingHelper };
});
vi.mock('../../src/components/router/appRouter', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { appRouter: services.appRouter };
});
vi.mock('../../src/utils/events', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { default: services.events };
});
vi.mock('../../src/scripts/libraryMenu', () => ({
    default: { setTitle: vi.fn(), setTransparentMenu: vi.fn() }
}));
vi.mock('../../src/components/loading/loading', () => ({
    default: { show: vi.fn(), hide: vi.fn() }
}));
vi.mock('../../src/components/backdrop/backdrop', () => ({
    setBackdrops: vi.fn(),
    clearBackdrop: vi.fn(),
    setBackdropTransparency: vi.fn()
}));

const {
    actionControl,
    activate,
    activateByKeyboard,
    changeSelect,
    mountForLedger,
    observationsOf,
    resetServiceLedger,
    selectControl,
    serviceLedger
} = await import('./support/ledgerHarness');

const RENDER_PHASES = [
    'primary',
    'subscription',
    'section',
    'delegated',
    'render'
];

afterEach(() => unmountAll());
beforeEach(() => {
    document.body.innerHTML = '';
    resetServiceLedger();
    vi.clearAllMocks();
});

/**
 * Normalise one service call to the shape the ledger freezes.
 *
 * The ledger records the SEMANTIC payload — which identity was targeted, which options were sent —
 * not the DTO the route happened to be holding. Freezing whole DTOs would make the ledger a
 * snapshot of the fixtures rather than a statement about the route.
 */
function normalizeService(observation: Observation): unknown {
    const [first, second] = observation.args as [any, any];
    switch (`${observation.surface}.${observation.member}`) {
        case 'service.playbackManager.play':
            return {
                items: (first.items ?? []).map((entry: any) => entry?.Id),
                startPositionTicks: first.startPositionTicks,
                mediaSourceId: first.mediaSourceId,
                audioStreamIndex: first.audioStreamIndex,
                subtitleStreamIndex: first.subtitleStreamIndex
            };
        case 'service.playbackManager.playTrailers':
        case 'service.playbackManager.instantMix':
        case 'service.playbackManager.shuffle':
            return [first?.Id];
        case 'service.itemContextMenu.show':
            return {
                item: first.item?.Id,
                user: first.user?.Id,
                open: first.open,
                play: first.play,
                playAllFromHere: first.playAllFromHere,
                queueAllFromHere: first.queueAllFromHere,
                cancelTimer: first.cancelTimer,
                record: first.record,
                deleteItem: first.deleteItem,
                shuffle: first.shuffle,
                instantMix: first.instantMix,
                share: first.share,
                positionTo: first.positionTo ? '<the action bar element>' : null
            };
        case 'service.recordingHelper.cancelTimer':
            return ['<the api client for item.ServerId>', second];
        case 'service.recordingHelper.cancelSeriesTimerWithConfirmation':
            return [first, second];
        case 'sdk.userData.markPlayedItem':
        case 'sdk.userData.markUnplayedItem':
        case 'sdk.userData.markFavoriteItem':
        case 'sdk.userData.unmarkFavoriteItem':
            return first;
        case 'service.fileDownloader.download':
            return (first as any[]).map((entry) => ({
                url: entry.url,
                itemId: entry.itemId,
                serverId: entry.serverId,
                title: entry.title,
                filename: entry.filename
            }));
        default:
            return observation.args;
    }
}

/** The one action row whose payload spans two surfaces. */
function downloadPayload(observations: Observation[]): unknown {
    const url = observations.find(
        (o) => o.surface === 'sdk' && o.member === 'getDownloadUrl'
    );
    const call = observations.find(
        (o) => o.surface === 'service.fileDownloader'
    );
    return {
        getDownloadUrl: url?.args[0],
        download: call ? normalizeService(call) : null
    };
}

function serviceCallsFor(row: LedgerActionRow): Observation[] {
    if (row.id === 'btnDownload') {
        return serviceLedger.filter(
            (o) => o.surface === 'service.fileDownloader'
        );
    }
    if (row.id === 'btnSplitVersions') return [];
    if (row.id === 'btnPlaystate' || row.id === 'btnUserRating') {
        return serviceLedger.filter((o) => o.surface === 'sdk.userData');
    }
    return serviceLedger.filter((o) => o.member === row.member);
}

// ---------------------------------------------------------------------------------------------
// 1 + 2 + 4 + 5 — the render-phase run, judged in both directions
// ---------------------------------------------------------------------------------------------

describe('migrated Item Details ledger — the render-phase run matches the ledger exactly', () => {
    for (const cls of LEDGER.classes) {
        it(`${cls.id}: every request is declared, and every declared request is issued`, async () => {
            const mounted = await mountForLedger(cls.id);
            const result = compareLedgerRuns(
                cls,
                observationsOf(mounted.api),
                RENDER_PHASES
            );

            expect(
                mounted.api.refused,
                `refused API members for "${cls.id}"`
            ).toEqual([]);
            expect(
                result.unknown,
                describeBreach(cls, 'route mount', result)
            ).toEqual([]);
            expect(
                result.ambiguous,
                describeBreach(cls, 'route mount', result)
            ).toEqual([]);
            expect(
                result.unexercised,
                describeBreach(cls, 'route mount', result)
            ).toEqual([]);
            expect(
                result.multiplicity,
                describeBreach(cls, 'route mount', result)
            ).toEqual([]);
        });
    }
});

/**
 * Absent reads are ENFORCED by the two directions above, not by a gate of their own.
 *
 * An absent read whose member the class never declares is unreachable: the fail-closed proxy throws
 * on property access. One that shares a member with a read the class DOES issue — `getItems`,
 * `getEpisodes` and `getLiveTvPrograms` each appear in more than one row — is caught by the argument
 * comparison, because the arguments of the absent variant match no row and land in `unknown`.
 *
 * What is left for this block is that the record explains itself: every declared absence names the
 * gate that excludes it, so a reader can tell "this class cannot" from "nobody checked".
 */
describe('migrated Item Details ledger — every declared absence names its gate', () => {
    for (const cls of LEDGER.classes) {
        it(`${cls.id}: all ${cls.absentRequests.length} inapplicable reads carry a reason`, () => {
            expect(cls.absentRequests.length).toBeGreaterThan(0);
            for (const absence of cls.absentRequests) {
                expect(
                    absence.reason,
                    `absence "${absence.signature}" of class "${cls.id}"`
                ).toMatch(/\S/);
            }
        });
    }

    /**
     * The same-member case, demonstrated rather than assumed.
     *
     * `children.folder` and `children.itemsByName` are both `legacy.getItems`, so a class issuing
     * the wrong one would reach a DECLARED member and could only be caught by its arguments.
     */
    it('a read sharing a member with a declared one is still caught by its arguments', async () => {
        const cls = ledgerClass('box-set');
        const mounted = await mountForLedger(cls.id);
        const observed = observationsOf(mounted.api).filter(
            (o) => o.member === 'getItems'
        );
        expect(observed).toHaveLength(1);

        const itemsByName = ledgerClass('person').requests.find(
            (row) => row.id === 'children.itemsByName'
        );
        expect(itemsByName).toBeDefined();
        expect(
            requestMatches(
                itemsByName as (typeof cls.requests)[number],
                observed[0],
                cls.identity
            ),
            'the items-by-name arguments must not match a folder read'
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------------------------
// 3 — affordance -> ledger
// ---------------------------------------------------------------------------------------------

describe('migrated Item Details ledger — every rendered affordance is classified', () => {
    for (const cls of LEDGER.classes) {
        it(`${cls.id}: no interactive node is unaccounted for`, async () => {
            const mounted = await mountForLedger(cls.id);
            const nodes = [
                ...mounted.container.querySelectorAll(INTERACTIVE_SELECTOR)
            ];

            const verdicts = nodes.map((node) => classifyAffordance(node, cls));
            const unclassified = verdicts.filter(
                (verdict) => verdict.kind === 'UNCLASSIFIED'
            );

            expect(
                unclassified,
                `[item-details ledger] class "${cls.id}" renders ${unclassified.length} control(s) ` +
                    'that map to no ledger action, no LOCAL_ONLY classification, no declared ' +
                    'navigation and no disabled state:\n' +
                    unclassified
                        .map(
                            (v) =>
                                `  ${(v as { description: string }).description}`
                        )
                        .join('\n')
            ).toEqual([]);

            // ledger -> runtime for the action surface: every declared action is rendered.
            for (const action of cls.actions) {
                expect(
                    verdicts.some(
                        (verdict) =>
                            verdict.kind === 'ACTION' &&
                            verdict.id === action.id
                    ),
                    `[item-details ledger] class "${cls.id}" declares action "${action.id}" but does not render it`
                ).toBe(true);
            }
            for (const local of cls.localOnly) {
                expect(
                    verdicts.some(
                        (verdict) =>
                            verdict.kind === 'LOCAL_ONLY' &&
                            verdict.id === local.id
                    ),
                    `[item-details ledger] class "${cls.id}" declares LOCAL_ONLY control "${local.id}" but does not render it`
                ).toBe(true);
            }
            for (const disabled of cls.disabledControls) {
                expect(
                    verdicts.some(
                        (verdict) =>
                            verdict.kind === 'DISABLED' &&
                            verdict.id === disabled.id
                    ),
                    `[item-details ledger] class "${cls.id}" declares disabled control "${disabled.id}" but it is not rendered disabled`
                ).toBe(true);
            }
            for (const delegated of cls.delegatedControls) {
                expect(
                    verdicts.some(
                        (verdict) =>
                            verdict.kind === 'DELEGATED' &&
                            verdict.id === delegated.id
                    ),
                    `[item-details ledger] class "${cls.id}" declares delegated control "${delegated.id}" but it is not rendered`
                ).toBe(true);
            }

            /*
             * Navigation target identity, §11 of the document.
             *
             * A link from this route is always to an ITEM. A URL carrying one of this item's
             * MEDIA-SOURCE ids would mean a card or a parent link had been built from the wrong
             * identity. Sources whose id equals the item's own are skipped: the ledger records that
             * collision explicitly, and asserting on it would pass for the wrong reason.
             */
            const distinctSourceIds = Object.entries(cls.identity)
                .filter(([role]) => role.startsWith('mediaSourceId.'))
                .map(([, value]) => value)
                .filter((value) => value !== cls.identity.itemId);
            for (const anchor of mounted.container.querySelectorAll(
                'a[href]'
            )) {
                const href = anchor.getAttribute('href') ?? '';
                for (const sourceId of distinctSourceIds) {
                    expect(
                        href.includes(sourceId),
                        `[item-details ledger] class "${cls.id}" renders a link to media-source ` +
                            `"${sourceId}": ${href}`
                    ).toBe(false);
                }
            }

            // And no action the ledger did NOT declare for this class is rendered.
            const rendered = new Set(
                [
                    ...mounted.container.querySelectorAll(
                        '[data-detail-action]'
                    )
                ].map((node) => node.getAttribute('data-detail-action'))
            );
            for (const absent of cls.absentActions) {
                expect(
                    rendered.has(absent.id),
                    `[item-details ledger] class "${cls.id}" renders "${absent.id}", which the ledger records as absent because ${absent.reason}`
                ).toBe(false);
            }
        });
    }
});

// ---------------------------------------------------------------------------------------------
// Actions: exact payload, exact target, exact multiplicity, declared follow-up
// ---------------------------------------------------------------------------------------------

const ACTIONS_WITH_SERVICE = (cls: LedgerClass) =>
    cls.actions.filter((row) => row.id !== 'btnSplitVersions');

describe('migrated Item Details ledger — every action sends exactly what the ledger froze', () => {
    for (const cls of LEDGER.classes) {
        for (const row of ACTIONS_WITH_SERVICE(cls)) {
            it(`${cls.id}/${row.id}: ${row.trigger}`, async () => {
                const mounted = await mountForLedger(cls.id);
                const before = mounted.api.calls.length;
                resetServiceLedger();

                await activate(actionControl(mounted.container, row.id));

                const expected = resolveValue(row.payload, cls.identity);
                const observed =
                    row.id === 'btnDownload'
                        ? downloadPayload([
                              ...observationsOf(mounted.api, before),
                              ...serviceLedger
                          ])
                        : (() => {
                              const calls = serviceCallsFor(row);
                              expect(
                                  calls.length,
                                  `[item-details ledger] class "${cls.id}", action "${row.id}": expected ` +
                                      `${row.multiplicity} call(s) to ${row.service} ${row.member}, observed ${calls.length}`
                              ).toBe(row.multiplicity);
                              expect(calls[0].member).toBe(row.member);
                              return normalizeService(calls[0]);
                          })();

                expect(
                    valueMatches(expected, observed),
                    `[item-details ledger] class "${cls.id}", action "${row.id}", trigger "${row.trigger}"\n` +
                        `  expected ${JSON.stringify(expected)}\n` +
                        `  observed ${JSON.stringify(observed)}\n` +
                        `  target contract: ${row.target}`
                ).toBe(true);

                // The declared follow-up re-fetch, exactly.
                if (row.refetch?.length) {
                    const after = observationsOf(mounted.api, before);
                    const result = compareLedgerRuns(cls, after, RENDER_PHASES);
                    expect(
                        result.unknown,
                        describeBreach(cls, row.id, result)
                    ).toEqual([]);
                    for (const id of row.refetch) {
                        expect(
                            result.hits[id],
                            `[item-details ledger] class "${cls.id}", action "${row.id}": the declared ` +
                                `follow-up re-fetch of "${id}" did not happen`
                        ).toBeGreaterThanOrEqual(1);
                    }
                } else {
                    const after = observationsOf(mounted.api, before).filter(
                        (o) =>
                            ![
                                'getCurrentUserId',
                                'getUrl',
                                'getScaledImageUrl'
                            ].includes(o.member)
                    );
                    const actionRows = cls.requests.filter(
                        (r) => r.phase === 'action'
                    );
                    for (const observation of after) {
                        expect(
                            actionRows.some(
                                (r) =>
                                    r.surface === observation.surface &&
                                    r.member === observation.member
                            ),
                            `[item-details ledger] class "${cls.id}", action "${row.id}" issued an ` +
                                `undeclared request ${observation.surface}.${observation.member}`
                        ).toBe(true);
                    }
                }
            });
        }
    }
});

describe('migrated Item Details ledger — the administrative split action', () => {
    const admin = LEDGER.classes.find((cls) =>
        cls.actions.some((row) => row.id === 'btnSplitVersions')
    );

    it('is declared by exactly one class', () => {
        expect(admin?.id).toBe('movie-grouped-admin');
    });

    it('confirms, then deletes the alternate sources of the ITEM', async () => {
        const cls = ledgerClass('movie-grouped-admin');
        const row = cls.actions.find(
            (entry) => entry.id === 'btnSplitVersions'
        )!;
        const mounted = await mountForLedger(cls.id);
        const before = mounted.api.calls.length;
        resetServiceLedger();

        await activate(actionControl(mounted.container, 'btnSplitVersions'));

        const confirmed = serviceLedger.filter(
            (o) => o.surface === 'service.confirm'
        );
        expect(confirmed).toHaveLength(1);
        expect(confirmed[0].args).toEqual(row.confirmation);

        const issued = observationsOf(mounted.api, before);
        const ajax = issued.filter((o) => o.member === 'ajax');
        expect(ajax).toHaveLength(1);
        expect(
            valueMatches(
                resolveValue(row.payload, cls.identity),
                ajax[0].args[0]
            ),
            `[item-details ledger] split versions targets ${row.target}`
        ).toBe(true);

        // The declared follow-up: a refresh AND the global refresh-needed event.
        expect(
            serviceLedger.some(
                (o) =>
                    o.surface === 'service.events' &&
                    o.args[1] === 'REFRESH_NEEDED'
            )
        ).toBe(true);
        const result = compareLedgerRuns(cls, issued, [
            ...RENDER_PHASES,
            'action'
        ]);
        expect(
            result.unknown,
            describeBreach(cls, 'btnSplitVersions', result)
        ).toEqual([]);
    });

    it('is not offered to a non-administrator holding the same item', async () => {
        const cls = ledgerClass('movie-grouped-regular');
        expect(cls.actions.map((row) => row.id)).not.toContain(
            'btnSplitVersions'
        );
        const mounted = await mountForLedger(cls.id);
        expect(actionControl(mounted.container, 'btnSplitVersions')).toBeNull();
    });
});

// ---------------------------------------------------------------------------------------------
// LOCAL_ONLY: a control that must NOT reach outward
// ---------------------------------------------------------------------------------------------

/**
 * How many of the declared LOCAL_ONLY controls were actually OPERATED.
 *
 * A selector with no options cannot be changed, so its test asserts that it is empty and stops.
 * Counting the two outcomes separately is the difference between "30 controls proved inert" and
 * "30 controls have a test", and only the first is true.
 */
const exercised = { operated: 0, skippedEmpty: 0 };

describe('migrated Item Details ledger — LOCAL_ONLY controls reach nothing outward', () => {
    for (const cls of LEDGER.classes) {
        for (const local of cls.localOnly) {
            it(`${cls.id}/${local.id}: ${local.reason.split('.')[0]}`, async () => {
                const mounted = await mountForLedger(cls.id);
                const before = mounted.api.calls.length;
                resetServiceLedger();

                if (local.id === 'overviewToggle') {
                    const toggle = mounted.container.querySelector<HTMLElement>(
                        '.rf-item-details__overview-toggle'
                    );
                    await activate(toggle);
                    exercised.operated += 1;
                } else {
                    const select = selectControl(mounted.container, local.id);
                    const options = [...(select?.options ?? [])].map(
                        (option) => option.value
                    );
                    // Pick a value other than the current one where the control offers one.
                    const next =
                        options.find((value) => value !== select?.value) ??
                        options[0];
                    if (next === undefined) {
                        /*
                         * An empty selector cannot be operated, so there is nothing to assert about
                         * what it reaches. Failing here rather than returning silently is what stops
                         * a control that UNEXPECTEDLY lost its options from passing as "nothing
                         * happened" — the shape this whole suite exists to refuse.
                         */
                        expect(
                            options.length,
                            `[item-details ledger] class "${cls.id}": LOCAL_ONLY control ` +
                                `"${local.id}" offers options but none could be selected`
                        ).toBe(0);
                        exercised.skippedEmpty += 1;
                        return;
                    }
                    exercised.operated += 1;
                    await changeSelect(select, next);
                }

                /*
                 * A re-render re-derives artwork URLs and re-reads the acting user id. Neither is a
                 * request: the ledger classifies them URL_BUILDER and LOCAL_ACCESSOR, and their call
                 * counts are explicitly not frozen. What must be empty is everything else.
                 */
                const passive = new Set(
                    cls.requests
                        .filter(
                            (row) =>
                                row.kind === 'URL_BUILDER' ||
                                row.kind === 'LOCAL_ACCESSOR'
                        )
                        .map((row) => row.member)
                );
                expect(
                    observationsOf(mounted.api, before).filter(
                        (o) => !passive.has(o.member)
                    ),
                    `[item-details ledger] class "${cls.id}": LOCAL_ONLY control "${local.id}" issued a request`
                ).toEqual([]);
                expect(
                    serviceLedger,
                    `[item-details ledger] class "${cls.id}": LOCAL_ONLY control "${local.id}" called an outward service`
                ).toEqual([]);
            });
        }
    }

    it('accounts for every declared LOCAL_ONLY control, operated or empty', () => {
        const declared = LEDGER.classes.reduce(
            (total, cls) => total + cls.localOnly.length,
            0
        );
        expect(
            exercised.operated + exercised.skippedEmpty,
            `[item-details ledger] ${declared} LOCAL_ONLY controls are declared but ` +
                `${exercised.operated} were operated and ${exercised.skippedEmpty} were empty`
        ).toBe(declared);
        // Most must actually be operable; a suite where everything was "empty" would prove nothing.
        expect(exercised.operated).toBeGreaterThan(exercised.skippedEmpty);
        // 26 operated, 4 empty at the time of freezing: the four `selectAudio` controls whose item
        // declares no media streams. Pinned so a control silently losing its options is a failure.
        expect(exercised.operated).toBe(26);
        expect(exercised.skippedEmpty).toBe(4);
    });
});

// ---------------------------------------------------------------------------------------------
// Variants: the identity guarantees that only a changed selection can prove
// ---------------------------------------------------------------------------------------------

describe('migrated Item Details ledger — declared local-state variants', () => {
    for (const cls of LEDGER.classes) {
        for (const variant of cls.variants) {
            for (const expectation of variant.expectations) {
                it(`${cls.id}/${variant.id}/${expectation.action}: ${expectation.proves}`, async () => {
                    const override = variant.itemOverride
                        ? Object.fromEntries(
                              Object.entries(variant.itemOverride).map(
                                  ([key, marker]) => {
                                      const match = /^\$now([+-])(\d+)s$/.exec(
                                          marker
                                      );
                                      if (!match)
                                          throw new Error(
                                              `unsupported override "${marker}"`
                                          );
                                      const delta =
                                          Number(match[2]) *
                                          1000 *
                                          (match[1] === '-' ? -1 : 1);
                                      return [
                                          key,
                                          new Date(
                                              Date.now() + delta
                                          ).toISOString()
                                      ];
                                  }
                              )
                          )
                        : undefined;

                    const mounted = await mountForLedger(cls.id, {
                        itemOverride: override
                    });
                    const before = mounted.api.calls.length;

                    for (const step of variant.setup ?? []) {
                        await changeSelect(
                            selectControl(mounted.container, step.control),
                            String(resolveValue(step.value, cls.identity))
                        );
                    }

                    resetServiceLedger();
                    await activate(
                        actionControl(mounted.container, expectation.action)
                    );

                    const calls = serviceLedger.filter(
                        (o) => o.member === expectation.member
                    );
                    expect(calls).toHaveLength(1);
                    const observed = normalizeService(calls[0]) as any;

                    if (expectation.payload) {
                        expect(
                            valueMatches(
                                resolveValue(expectation.payload, cls.identity),
                                observed
                            ),
                            `[item-details ledger] class "${cls.id}", variant "${variant.id}": ${expectation.proves}\n` +
                                `  expected ${JSON.stringify(resolveValue(expectation.payload, cls.identity))}\n` +
                                `  observed ${JSON.stringify(observed)}`
                        ).toBe(true);
                    }
                    if (expectation.payloadItem) {
                        const target = resolveValue(
                            expectation.payloadItem,
                            cls.identity
                        );
                        const actual = Array.isArray(observed)
                            ? observed[0]
                            : ((observed.items ?? [])[0] ?? observed.item);
                        expect(
                            actual,
                            `[item-details ledger] class "${cls.id}", variant "${variant.id}": ${expectation.proves}`
                        ).toBe(target);
                    }
                    for (const required of expectation.requires ?? []) {
                        const row = cls.requests.find(
                            (entry) => entry.id === required
                        )!;
                        const issued = observationsOf(mounted.api, before);
                        expect(
                            issued.some(
                                (o) =>
                                    o.surface === row.surface &&
                                    o.member === row.member
                            ),
                            `[item-details ledger] class "${cls.id}", variant "${variant.id}": the declared ` +
                                `request "${required}" was not issued`
                        ).toBe(true);
                    }
                });
            }
        }
    }
});

// ---------------------------------------------------------------------------------------------
// Keyboard reachability of the action surface, under the real components
// ---------------------------------------------------------------------------------------------

/**
 * Focusability, not activation.
 *
 * jsdom does not derive a button's activation behaviour from `Enter`, so what is provable here is
 * that every declared action control takes focus and is in the tab order. The keyboard ACTIVATION
 * proof — pressing Enter and watching the request leave — lives in
 * `tests/itemDetailsBrowser/itemDetails.ledger.browser.spec.ts`, where a real browser supplies it.
 */
describe('migrated Item Details ledger — every action control is focusable', () => {
    for (const cls of LEDGER.classes) {
        it(`${cls.id}: every declared action control takes focus`, async () => {
            const mounted = await mountForLedger(cls.id);
            for (const row of cls.actions) {
                const control = actionControl(mounted.container, row.id);
                expect(
                    control,
                    `action "${row.id}" is not rendered`
                ).not.toBeNull();
                expect(
                    control?.tabIndex ?? 0,
                    `action "${row.id}" is not keyboard-focusable`
                ).toBeGreaterThanOrEqual(0);
            }
            // One representative activation through the keyboard path, per class.
            const first = cls.actions[0];
            if (first) {
                resetServiceLedger();
                const reached = await activateByKeyboard(
                    actionControl(mounted.container, first.id)
                );
                expect(reached, `action "${first.id}" did not take focus`).toBe(
                    true
                );
            }
        });
    }
});

// ---------------------------------------------------------------------------------------------
// The ledger covers the whole frozen equivalence-class set
// ---------------------------------------------------------------------------------------------

describe('migrated Item Details ledger — coverage', () => {
    it('has one entry per P5 equivalence class, and no more', () => {
        const fromContract = (contract.classes as { id: string }[])
            .map((entry) => entry.id)
            .sort();
        const fromLedger = LEDGER.classes.map((entry) => entry.id).sort();
        expect(fromLedger).toEqual(fromContract);
        expect(fromLedger).toHaveLength(24);
    });

    it('includes both permission variants of every permission-gated class', () => {
        for (const [privileged, plain] of [
            ['movie-grouped-admin', 'movie-grouped-regular'],
            ['recording', 'recording-no-livetv'],
            ['series-timer', 'series-timer-no-livetv']
        ]) {
            const a = ledgerClass(privileged);
            const b = ledgerClass(plain);
            const actionsA = a.actions.map((row) => row.id);
            const actionsB = b.actions.map((row) => row.id);
            expect(
                actionsA,
                `"${privileged}" and "${plain}" must differ in the actions they offer`
            ).not.toEqual(actionsB);
        }
    });
});
