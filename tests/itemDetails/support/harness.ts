/**
 * Characterization harness for the LEGACY Item Details route.
 *
 * This mounts `src/apps/legacy/controllers/itemDetails/index.js` against its own
 * `index.html`, the same way `components/viewManager/ViewManagerPage.tsx` does: import the
 * controller factory, run the view template through `globalize.translateHtml`, and construct
 * `new controllerFactory(view, params)`. The controller under test is the PRODUCTION file —
 * nothing here reimplements a decision it makes.
 *
 * Two things are deliberately faked, and only two:
 *
 *  1. **The two API surfaces.** The controller reads through the legacy `apiClient` AND through
 *     the SDK (`ServerConnections.getApi` -> `getLibraryApi(api)`). Both are fail-closed Proxies:
 *     touching a member the fixture did not declare throws, so an undeclared call cannot be
 *     silently absorbed and every recorded call belongs to the declared read inventory.
 *
 *  2. **Customized built-in elements.** `emby-select`, `emby-playstatebutton`,
 *     `emby-ratingbutton` and `emby-scroller` are customized built-ins (`is="..."`). jsdom does
 *     not upgrade those from `innerHTML`, so their imperative API (`setLabel`, `setItem`,
 *     `toStart`) would not exist. The harness installs recording stubs with the same shape. This
 *     is test infrastructure standing in for a browser capability jsdom lacks — no production
 *     file is modified to make the route testable.
 *
 * Translations resolve to their KEY, not to prose (see the `lib/globalize` mock in each spec).
 * Freezing translated wording as a product contract is explicitly out of scope, so the tests
 * assert on keys like `HeaderCastAndCrew`, which are stable identifiers.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The `emby-*` elements are Custom Elements **v0** (`document.registerElement`), provided in the
 * browser by `webcomponents.js/webcomponents-lite`. That polyfill cannot run under jsdom — it
 * installs a document-wide MutationObserver that dereferences `window` after the environment is
 * torn down — so registration is accepted and elements simply are not upgraded, which is already
 * jsdom's behaviour for customized built-ins created from `innerHTML`.
 *
 * The imperative members the controller actually calls on those elements are supplied by
 * {@link installElementStubs}. Nothing here reimplements element BEHAVIOUR; it only stops
 * registration from throwing.
 */
if (typeof document !== 'undefined' && !('registerElement' in document)) {
    (
        document as Document & {
            registerElement?: (name: string) => unknown;
        }
    ).registerElement = () => function RegisteredElement() {};
}

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

export const VIEW_HTML_PATH = join(
    REPO_ROOT,
    'src',
    'apps',
    'legacy',
    'controllers',
    'itemDetails',
    'index.html'
);

/** One recorded call against either API surface. */
export interface ApiCall {
    /** `legacy` = the jellyfin-apiclient instance; `sdk` = a `@jellyfin/sdk` api function. */
    surface: 'legacy' | 'sdk';
    method: string;
    args: unknown[];
}

export interface FailClosedApiOptions {
    /**
     * Declared legacy `apiClient` members. A member absent from this map makes the access throw,
     * which is the whole point: an undeclared request is a test failure, not a silent success.
     */
    legacy: Record<string, unknown>;
    /** Declared `getLibraryApi(api)` members, same rule. */
    sdk?: Record<string, unknown>;
}

export interface FailClosedApi {
    apiClient: Record<string, unknown>;
    libraryApi: Record<string, unknown>;
    calls: ApiCall[];
    /** Members that were reached for but never declared. Non-empty means the mock refused a call. */
    refused: string[];
}

/**
 * Build the fail-closed API pair.
 *
 * Property ACCESS on an undeclared member throws — not just invocation — because the controller
 * frequently does `apiClient.getFoo(...)` in one expression, and a Proxy that returned `undefined`
 * would produce "is not a function", which reads like a harness bug rather than a contract breach.
 */
export function createFailClosedApi(
    options: FailClosedApiOptions
): FailClosedApi {
    const calls: ApiCall[] = [];
    const refused: string[] = [];

    const build = (
        surface: 'legacy' | 'sdk',
        declared: Record<string, unknown>
    ) =>
        new Proxy(declared, {
            get(target, property) {
                if (typeof property === 'symbol') {
                    return Reflect.get(target, property);
                }
                // Vitest/`await` probe these on any object; answering honestly is not a call.
                if (property === 'then' || property === 'constructor') {
                    return Reflect.get(target, property);
                }
                if (!(property in target)) {
                    refused.push(`${surface}.${property}`);
                    throw new Error(
                        `[item-details characterization] undeclared ${surface} API member ` +
                            `"${property}". Every call the route makes must be declared in the ` +
                            'legacy read inventory (tests/fixtures/item-details/legacy-contract.json). ' +
                            'If this call is legitimate, record it in the inventory first.'
                    );
                }
                const value = Reflect.get(target, property);
                if (typeof value !== 'function') {
                    return value;
                }
                return (...args: unknown[]) => {
                    calls.push({ surface, method: property, args });
                    return (value as (...a: unknown[]) => unknown)(...args);
                };
            }
        }) as Record<string, unknown>;

    return {
        apiClient: build('legacy', options.legacy),
        libraryApi: build('sdk', options.sdk ?? {}),
        calls,
        refused
    };
}

/**
 * Load the production view template and resolve its `${Key}` placeholders to the bare key.
 *
 * Mirrors `ViewManagerPage.importController`, which pipes the same file through
 * `globalize.translateHtml`. Keys rather than prose, on purpose — see the module doc.
 */
export function loadViewHtml(): string {
    return readFileSync(VIEW_HTML_PATH, 'utf8').replace(
        /\$\{([A-Za-z0-9_]+)\}/g,
        '$1'
    );
}

/** Recorded imperative calls the customized built-ins would have received in a browser. */
export interface ElementStubLedger {
    /** `.selectSource` etc. -> the label key it was given. */
    selectLabels: Record<string, string>;
    /** `btnPlaystate` / `btnUserRating` -> the item id (or null) each was last given. */
    userDataItems: { control: string; itemId: string | null }[];
    /** `emby-scroller.toStart()` invocations. */
    scrollerToStart: number;
    /** `emby-itemscontainer.refreshItems()` invocations. */
    itemsContainerRefreshes: number;
}

const SELECT_CLASSES = [
    'selectSource',
    'selectVideo',
    'selectAudio',
    'selectSubtitles'
];

/**
 * Install the customized-built-in stubs. Idempotent and safe to re-run: card builders and list
 * views replace whole subtrees, so freshly written scrollers need the same treatment.
 */
export function installElementStubs(
    root: HTMLElement,
    ledger: ElementStubLedger
) {
    for (const className of SELECT_CLASSES) {
        for (const element of root.querySelectorAll(`.${className}`)) {
            const select = element as HTMLSelectElement & {
                setLabel?: (label: string) => void;
            };
            if (select.setLabel) continue;
            select.setLabel = (label: string) => {
                ledger.selectLabels[className] = label;
            };
        }
    }

    for (const control of ['btnPlaystate', 'btnUserRating']) {
        for (const element of root.querySelectorAll(`.${control}`)) {
            const button = element as HTMLElement & {
                setItem?: (item: { Id?: string } | null) => void;
            };
            if (button.setItem) continue;
            button.setItem = (item: { Id?: string } | null) => {
                ledger.userDataItems.push({
                    control,
                    itemId: item?.Id ?? null
                });
            };
        }
    }

    for (const element of root.querySelectorAll('[is="emby-scroller"]')) {
        const scroller = element as HTMLElement & { toStart?: () => void };
        if (scroller.toStart) continue;
        /**
         * `emby-scroller`'s `createdCallback` adds this class in a browser, and the controller
         * looks the element back up BY that class (`section.querySelector('.emby-scroller')` in
         * `renderMoreFromSeason`). Without the upgrade there is no class, the lookup returns null,
         * and the route throws inside a `setTimeout` — a jsdom artifact, not route behaviour.
         */
        scroller.classList.add('emby-scroller');
        scroller.toStart = () => {
            ledger.scrollerToStart += 1;
        };
    }

    for (const element of root.querySelectorAll('[is="emby-itemscontainer"]')) {
        const container = element as HTMLElement & {
            fetchData?: () => Promise<{ Items?: unknown[] }>;
            getItemsHtml?: (items: unknown[]) => string;
            refreshItems?: () => Promise<void>;
            enableDragReordering?: (enabled: boolean) => void;
            notifyRefreshNeeded?: () => void;
            pause?: () => void;
            resume?: () => Promise<void>;
        };
        if (container.refreshItems) continue;
        container.enableDragReordering = () => undefined;
        container.pause = () => undefined;
        container.resume = () => Promise.resolve();
        container.notifyRefreshNeeded = () => undefined;
        /**
         * `emby-itemscontainer.refreshItems()` is the seam `scripts/playlistViewer` and
         * `scripts/itemsByName` drive their child lists through: the caller assigns `fetchData`
         * and `getItemsHtml`, the element calls them. The stub honours exactly that contract, so
         * the REQUEST the route issues and the ORDER it renders are both real observations. It
         * does not reproduce the element's refresh-interval or pause bookkeeping, which is
         * element behaviour rather than route behaviour.
         */
        container.refreshItems = () => {
            ledger.itemsContainerRefreshes += 1;
            if (!container.fetchData) return Promise.resolve();
            return container.fetchData().then((data) => {
                if (container.getItemsHtml) {
                    container.innerHTML = container.getItemsHtml(
                        data?.Items ?? []
                    );
                }
            });
        };
    }
}

export function createElementStubLedger(): ElementStubLedger {
    return {
        selectLabels: {},
        userDataItems: [],
        scrollerToStart: 0,
        itemsContainerRefreshes: 0
    };
}

/**
 * Drain pending microtasks AND macrotasks until the page stops changing.
 *
 * The controller fans out into ~10 dynamic `import()` chains (autoFocuser, peoplecardbuilder,
 * chaptercardbuilder, itemsByName, playlistViewer, recordingfields, seriesrecordingeditor,
 * chapter cards, recordinghelper) layered on top of promise-returning API calls. A microtask
 * flush leaves all of them pending; only a real macrotask turn lets a dynamic import resolve.
 */
export async function settle(
    root?: HTMLElement,
    ledger?: ElementStubLedger,
    turns = 12
) {
    for (let i = 0; i < turns; i++) {
        await new Promise((r) => setTimeout(r, 0));
        if (root && ledger) installElementStubs(root, ledger);
    }
}

/** Section ids/classes in the order the VIEW declares them, top to bottom. */
export const VIEW_SECTION_ORDER: readonly string[] = [
    'nameContainer',
    'itemMiscInfo-primary',
    'itemMiscInfo-secondary',
    'mainDetailButtons',
    'trackSelections',
    'recordingFields',
    'tagline',
    'overview',
    'itemBirthday',
    'itemBirthLocation',
    'itemDeathDate',
    'seriesAirTime',
    'itemTags',
    'itemExternalLinks',
    'itemDetailsGroup',
    'seriesTimerScheduleSection',
    'collectionItems',
    'nextUpSection',
    'programGuideSection',
    'listChildrenCollapsible',
    'childrenCollapsible',
    'additionalPartsCollapsible',
    'moreFromSeasonSection',
    'lyricsSection',
    'moreFromArtistSection',
    'castCollapsible',
    'guestCastCollapsible',
    'seriesScheduleSection',
    'specialsCollapsible',
    'musicVideosCollapsible',
    'scenesCollapsible',
    'collectionsCollapsible',
    'similarCollapsible'
];

/**
 * Is this element actually on screen — i.e. neither it nor any ancestor up to `root` is `.hide`?
 *
 * The controller hides whole containers (`hideAll(page, 'mainDetailButtons')`) without touching the
 * controls inside them, so asking only about the element's own class list would report a hidden
 * button as visible.
 */
export function isVisible(element: Element, root: HTMLElement): boolean {
    let node: Element | null = element;
    while (node && node !== root) {
        if (node.classList.contains('hide')) return false;
        node = node.parentElement;
    }
    return true;
}

/**
 * The visible semantic sections, in document order.
 *
 * Read from the DOM the way a viewer perceives the page — which blocks are on screen — rather than
 * from the controller's own branch table, which would assert the implementation against itself.
 */
export function visibleSections(root: HTMLElement): string[] {
    const found: string[] = [];
    for (const name of VIEW_SECTION_ORDER) {
        const element =
            root.querySelector(`#${name}`) ?? root.querySelector(`.${name}`);
        if (!element) continue;
        if (!isVisible(element, root)) continue;
        found.push(name);
    }
    return found;
}

/** Visible action buttons, by their stable `btn*` class, in document order. */
export function visibleActions(root: HTMLElement): string[] {
    const actions: string[] = [];
    for (const button of root.querySelectorAll('.mainDetailButtons button')) {
        if (!isVisible(button, root)) continue;
        const name = [...button.classList].find((c) => c.startsWith('btn'));
        if (name) actions.push(name);
    }
    return actions;
}

/**
 * Visible section headings, in document order.
 *
 * Headings resolve to their translation KEY (see the `lib/globalize` mock), so this is a stable
 * semantic label — `HeaderCastAndCrew`, not whatever English string ships this week.
 */
export function visibleHeadings(root: HTMLElement): string[] {
    return [...root.querySelectorAll('h2.sectionTitle')]
        .filter((heading) => isVisible(heading, root))
        .map((heading) => (heading.textContent ?? '').trim())
        .filter(Boolean);
}
