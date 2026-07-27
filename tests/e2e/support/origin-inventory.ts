import {
    test as base,
    expect,
    type BrowserContext,
    type Page,
    type TestInfo
} from '@playwright/test';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * B1 (#54) — RUNTIME ORIGIN INVENTORY.
 *
 * `scripts/verify-no-runtime-jellyfin.mjs` is a STATIC gate: it reads the source and the
 * built bundle and refuses an upstream host in a request-shaped position. Its own header
 * says runtime evidence is not its job and must come from the image-backed browser run.
 * This is that evidence, and it does not replace the static gate — both run.
 *
 * WHAT IT DOES. Every spec in this directory imports `test` from here instead of from
 * `@playwright/test`. An automatic fixture subscribes to the browser context for the whole
 * of every test and records every destination the APPLICATION reaches for:
 *
 *   * HTTP and HTTPS requests of every resource type — documents, scripts, styles, XHR and
 *     fetch, IMAGES, MEDIA, and beacons (`navigator.sendBeacon` surfaces as an ordinary
 *     request of type `ping`/`beacon`);
 *   * WEBSOCKETS, via `page.on('websocket')` on every page in the context — these are not
 *     requests and would otherwise be invisible. Note the asymmetry: Playwright exposes
 *     `websocket` on Page ONLY, so this one subscription is per-page while the rest are on
 *     the context;
 *   * WORKERS — dedicated and service worker traffic reaches the context-level `request`
 *     event, which is why the request subscription is on the context and not on a page;
 *   * `data:` and `blob:` URLs, recorded and classified separately rather than silently
 *     dropped, because "no network origin" and "not observed at all" are different claims.
 *
 * FAIL-CLOSED, TWICE.
 *
 *   1. In-test: an origin that is neither the candidate server nor local browser
 *      infrastructure fails the test AT THE MOMENT IT IS OBSERVED, naming the URL. A new
 *      runtime dependency cannot be introduced and merely noticed later.
 *   2. After the run: `scripts/verify-runtime-origins.mjs` reduces the emitted records to a
 *      deterministic unique inventory, and additionally requires that EVERY spec file the
 *      run executed reported at least one origin. Without that second check, a spec that
 *      quietly stopped importing this module would contribute nothing and the gate would
 *      report a clean inventory it never actually collected.
 *
 * CLASSIFICATION. Deliberately narrow, so that "expected" cannot quietly widen:
 *
 *   candidate-server  — the origin of TESSERAFIN_E2E_BASE_URL. The image under test.
 *   local-infra       — 127.0.0.1/localhost/[::1] on another port, plus the schemes the
 *                       browser itself uses (about:, chrome:, devtools:). Playwright's own
 *                       harness, not the application.
 *   in-document       — data: and blob:. Never leaves the browser.
 *   EXTERNAL          — anything else. Recorded always; FAILS unless the origin is declared
 *                       in support/runtime-origin-allowlist.json with a reviewed reason.
 *                       Declaring an origin does not hide it — it still appears in the
 *                       inventory under `external`, which is what #54 asks to be surfaced.
 */

const BASE_URL = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';
const CANDIDATE_ORIGIN = new URL(BASE_URL).origin;

/** Where the records land. Overridable so a rig can collect several runs side by side. */
const OUT_FILE =
    process.env.TESSERAFIN_E2E_ORIGIN_INVENTORY ??
    join(process.cwd(), 'test-results', 'runtime-origins.jsonl');

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const BROWSER_SCHEMES = new Set([
    'about:',
    'chrome:',
    'chrome-extension:',
    'devtools:',
    'chrome-error:'
]);

export type OriginClass =
    | 'candidate-server'
    | 'local-infra'
    | 'in-document'
    | 'external';

export interface OriginRecord {
    spec: string;
    origin: string;
    class: OriginClass;
    kind: 'request' | 'websocket';
    /** Resource type for requests: document, script, image, media, fetch, xhr, ping... */
    resourceType?: string;
    /** A redacted sample, so the inventory is reviewable without leaking credentials. */
    sample: string;
}

/**
 * Non-local origins the shipped client is DECLARED to reach, each with a reviewed reason.
 * An external origin that is not declared fails the test where it is observed. Declaring one
 * does not hide it: it is still recorded and still printed in the inventory under `external`.
 */
let declaredCache: ReadonlySet<string> | null = null;

/**
 * Resolved from `testInfo.project.testDir` rather than `__dirname` or `import.meta.url`, so
 * it works identically whichever module format Playwright's transform emits, and does not
 * depend on the working directory the runner was started from.
 */
function declaredOrigins(testDir: string): ReadonlySet<string> {
    if (declaredCache) return declaredCache;
    const file = join(testDir, 'support', 'runtime-origin-allowlist.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
        entries: Array<{ origin: string; alsoObservedAs?: string }>;
    };
    declaredCache = new Set(
        parsed.entries.flatMap(
            (e) => [e.origin, e.alsoObservedAs].filter(Boolean) as string[]
        )
    );
    return declaredCache;
}

export function classifyUrl(raw: string): {
    origin: string;
    cls: OriginClass;
} {
    if (raw.startsWith('data:')) return { origin: 'data:', cls: 'in-document' };
    if (raw.startsWith('blob:')) return { origin: 'blob:', cls: 'in-document' };

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        // Unparseable is not "safe by default".
        return { origin: raw, cls: 'external' };
    }

    if (BROWSER_SCHEMES.has(url.protocol)) {
        return { origin: url.protocol, cls: 'local-infra' };
    }
    if (url.origin === CANDIDATE_ORIGIN) {
        return { origin: url.origin, cls: 'candidate-server' };
    }
    // ws:// to the candidate host is the application's own socket, not a foreign origin.
    if (LOCAL_HOSTS.has(url.hostname)) {
        return { origin: url.origin, cls: 'local-infra' };
    }
    return { origin: url.origin, cls: 'external' };
}

/**
 * Strips query strings entirely. The recorded sample must be reviewable in an issue
 * comment, and Tesserafin media URLs carry `ApiKey=` and a device id.
 */
function redact(raw: string): string {
    if (raw.startsWith('data:')) return 'data:[...]';
    if (raw.startsWith('blob:')) return 'blob:[...]';
    try {
        const u = new URL(raw);
        return `${u.origin}${u.pathname}`;
    } catch {
        return raw.split('?')[0];
    }
}

function emit(record: OriginRecord) {
    mkdirSync(dirname(OUT_FILE), { recursive: true });
    appendFileSync(OUT_FILE, `${JSON.stringify(record)}\n`, 'utf8');
}

function specOf(testInfo: TestInfo): string {
    return relative(testInfo.project.testDir, testInfo.file).replace(
        /\\/g,
        '/'
    );
}

function subscribe(context: BrowserContext, testInfo: TestInfo) {
    const spec = specOf(testInfo);
    const declared = declaredOrigins(testInfo.project.testDir);
    const seen = new Set<string>();
    const offenders: string[] = [];

    const note = (
        raw: string,
        kind: OriginRecord['kind'],
        resourceType?: string
    ) => {
        const { origin, cls } = classifyUrl(raw);
        const key = `${kind}|${origin}|${resourceType ?? ''}`;
        if (!seen.has(key)) {
            seen.add(key);
            emit({
                spec,
                origin,
                class: cls,
                kind,
                resourceType,
                sample: redact(raw)
            });
        }
        if (cls === 'external' && !declared.has(origin)) {
            offenders.push(redact(raw));
        }
    };

    context.on('request', (r) => note(r.url(), 'request', r.resourceType()));
    // A refused or aborted request still names a destination the application reached for.
    context.on('requestfailed', (r) =>
        note(r.url(), 'request', r.resourceType())
    );

    // WEBSOCKETS ARE A PAGE EVENT, NOT A CONTEXT EVENT. Playwright exposes `websocket` on
    // Page only; subscribing on the context silently never fires, which would make the
    // websocket half of this gate decorative — it would report a clean inventory having
    // observed nothing. Verified empirically: a context-level subscription recorded zero
    // websockets over a run in which the client's `/socket` connection was live.
    const watchPage = (page: Page) =>
        page.on('websocket', (ws) => note(ws.url(), 'websocket'));
    context.pages().forEach(watchPage);
    context.on('page', watchPage);

    return () => offenders;
}

export const test = base.extend<{ originInventory: void }>({
    originInventory: [
        async ({ context }, use, testInfo) => {
            const offenders = subscribe(context, testInfo);
            await use();
            expect(
                offenders(),
                'the application reached a non-local origin at runtime'
            ).toEqual([]);
        },
        { auto: true }
    ]
});

export { expect };
