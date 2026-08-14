import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S4 — THE PLAYBACK URL MUST NOT REACH THE CONSOLE.
 *
 * A playback url built by `playbackmanager` carries `ApiKey=<the session's access token>`, so any
 * console write of that url publishes the caller's durable credential. Both HTML players used to
 * do exactly that, unconditionally, on every play.
 *
 * These tests drive the real `setCurrentSrc` path of both players with a URL carrying a UNIQUE
 * SYNTHETIC credential, and inspect every console argument RECURSIVELY - strings, nested objects,
 * arrays and Error messages - without ever handing a raw argument back to the runner. A failure
 * reports the offending console method and the shape that matched, never the value.
 *
 * They also assert the url still reaches the media element unchanged, including the `#t=` start
 * position fragment, so "quiet" cannot be achieved by breaking playback.
 */
// Two seams the rest of this repository's vitest suites already use, for the same reasons they
// document: the players' import graph reaches `apphost` → `webSettings`, which reads webpack's
// build-time `__WEBPACK_SERVE__` define, and `lib/globalize` drags in the whole legacy shell.
// Neither is what these tests assert.
vi.stubGlobal('__WEBPACK_SERVE__', false);

vi.mock('lib/globalize', () => ({
    default: { translate: (key: string) => key },
    translate: (key: string) => key
}));

const SYNTHETIC_CREDENTIAL = `s4-synthetic-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const SERVER = 'http://127.0.0.1:8096';
const MEDIA_PATH = '/Videos/00000000000000000000000000000001/stream.mp4';
const PLAYBACK_URL = `${SERVER}${MEDIA_PATH}?Static=true&mediaSourceId=1&ApiKey=${SYNTHETIC_CREDENTIAL}&Tag=abc`;

/** Everything a console argument may hide a credential inside. Never returns the value. */
function containsSecret(value: unknown, needles: string[], depth = 0): boolean {
    if (depth > 6 || value == null) return false;
    if (typeof value === 'string')
        return needles.some((needle) => value.includes(needle));
    if (typeof value === 'number' || typeof value === 'boolean') return false;
    if (value instanceof Error)
        return (
            containsSecret(value.message, needles, depth + 1) ||
            containsSecret(value.stack ?? '', needles, depth + 1)
        );
    if (Array.isArray(value))
        return value.some((item) => containsSecret(item, needles, depth + 1));
    if (typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).some((item) =>
            containsSecret(item, needles, depth + 1)
        );
    }
    return false;
}

const DISCLOSURE_NEEDLES = [
    SYNTHETIC_CREDENTIAL,
    'ApiKey=',
    'api_key=',
    MEDIA_PATH
];

interface ConsoleWatch {
    /** Console methods that emitted something matching a needle. Never the payload. */
    offenders: string[];
    restore: () => void;
}

function watchConsole(): ConsoleWatch {
    const offenders: string[] = [];
    const methods = ['debug', 'log', 'info', 'warn', 'error', 'dir'] as const;
    const originals = methods.map(
        (method) => [method, console[method]] as const
    );
    for (const method of methods) {
        const original = console[method] as (...args: unknown[]) => void;
        console[method] = (...args: unknown[]) => {
            if (containsSecret(args, DISCLOSURE_NEEDLES)) {
                // Recorded, never forwarded: a matching payload must not reach the runner's output.
                offenders.push(method);
                return;
            }
            // Everything else passes through, so the runner can still report real failures.
            original.apply(console, args);
        };
    }
    return {
        offenders,
        restore: () => {
            for (const [method, original] of originals) {
                (console as unknown as Record<string, unknown>)[method] =
                    original;
            }
        }
    };
}

const mediaHelperStubs: Record<string, unknown> = {
    playWithPromise: () => Promise.resolve(),
    getCrossOriginValue: () => null,
    enableHlsJsPlayerForCodecs: () => false,
    destroyHlsPlayer: () => undefined,
    destroyFlvPlayer: () => undefined,
    destroyCastPlayer: () => undefined,
    getIncludeCorsCredentials: () => Promise.resolve(false),
    isValidDuration: () => true
};

// `playbackmanager` is imported by the video player for one predicate; its module body wires the
// legacy shell together and throws under jsdom. Only the predicate is needed here.
// BOTH SPECIFIERS. The players import this by relative path; the alias form alone does not
// intercept it, which is the seam this repository's legacy-controller suites already document.
vi.mock('../../src/components/playback/playbackmanager', () => ({
    playbackManager: {
        trackHasSecondarySubtitleSupport: () => false,
        getPlayerInfo: () => null
    }
}));

vi.mock('components/playback/playbackmanager', () => ({
    playbackManager: {
        trackHasSecondarySubtitleSupport: () => false,
        getPlayerInfo: () => null
    }
}));

vi.mock('../../src/components/htmlMediaHelper', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, ...mediaHelperStubs };
});

vi.mock('../../src/scripts/settings/webSettings', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        getIncludeCorsCredentials: () => Promise.resolve(false)
    };
});

vi.mock('components/htmlMediaHelper', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        ...mediaHelperStubs
    };
});

const mediaSource = {
    Id: '1',
    Container: 'mp4',
    MediaStreams: [],
    DefaultSubtitleStreamIndex: null,
    DefaultAudioStreamIndex: 0,
    RunTimeTicks: 100000000
};

const options = (extra: Record<string, unknown> = {}) => ({
    url: PLAYBACK_URL,
    playMethod: 'DirectPlay',
    mediaSource,
    item: { Id: '1', ServerId: 'server-1' },
    playerStartPositionTicks: 0,
    ...extra
});

describe('playback url disclosure', () => {
    let watch: ConsoleWatch;

    beforeEach(() => {
        // NOT `vi.resetModules()`: re-importing the players re-runs `elements/emby-*`'s custom
        // element registrations and jsdom rejects the second definition. The module graph is
        // imported once and the assertions are per-call.
        watch = watchConsole();
    });

    afterEach(() => {
        watch.restore();
    });

    it('the video player logs no console argument containing the credential', async () => {
        const { HtmlVideoPlayer } = await import(
            '../../src/plugins/htmlVideoPlayer/plugin'
        );
        const player = new HtmlVideoPlayer();
        const elem = document.createElement('video') as HTMLVideoElement & {
            src: string;
        };

        await player.setCurrentSrc(elem, options());

        watch.restore();
        expect(
            watch.offenders,
            'a console method emitted the playback credential'
        ).toEqual([]);
        // The url still reached the media element, unchanged: `applySrc` is the real one, so this
        // is the element the product would have played.
        expect(elem.src).toBe(PLAYBACK_URL);
    });

    it('the video player still appends the start-position fragment', async () => {
        const { HtmlVideoPlayer } = await import(
            '../../src/plugins/htmlVideoPlayer/plugin'
        );
        const player = new HtmlVideoPlayer();
        const elem = document.createElement('video') as HTMLVideoElement & {
            src: string;
        };

        // 30 s expressed in ticks, the unit the player converts from.
        await player.setCurrentSrc(
            elem,
            options({ playerStartPositionTicks: 300000000 })
        );

        watch.restore();
        expect(watch.offenders).toEqual([]);
        expect(elem.src).toBe(`${PLAYBACK_URL}#t=30`);
    });

    it('the audio player logs no console argument containing the credential', async () => {
        const { default: HtmlAudioPlayer } = await import(
            '../../src/plugins/htmlAudioPlayer/plugin'
        );
        const player = new HtmlAudioPlayer();

        await player.play(options());
        const playedAudioSrc = () =>
            document.querySelector('audio')?.getAttribute('src') ??
            (document.querySelector('audio') as HTMLAudioElement | null)?.src ??
            '';

        watch.restore();
        expect(
            watch.offenders,
            'a console method emitted the playback credential'
        ).toEqual([]);
        expect(playedAudioSrc(), 'the audio element must receive the url').toBe(
            PLAYBACK_URL
        );
    });

    it('does not mistake an ordinary query parameter for a credential', () => {
        // The inspector must discriminate: a url with no credential in it is not a disclosure, or
        // the gate would be satisfied by any change that happens to drop urls entirely.
        expect(
            containsSecret(
                [`${SERVER}/Items?SortBy=SortName&Limit=10`],
                DISCLOSURE_NEEDLES
            )
        ).toBe(false);
        expect(containsSecret([PLAYBACK_URL], DISCLOSURE_NEEDLES)).toBe(true);
        // And it must see through nesting, which is how a redactor-free "fix" would leak.
        expect(
            containsSecret(
                [{ request: { url: PLAYBACK_URL } }],
                DISCLOSURE_NEEDLES
            )
        ).toBe(true);
        expect(
            containsSecret([new Error(PLAYBACK_URL)], DISCLOSURE_NEEDLES)
        ).toBe(true);
    });
});
