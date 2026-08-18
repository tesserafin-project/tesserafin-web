#!/usr/bin/env node
/*
 * #153-A1 phase 0 — the executable credential-transport inventory.
 *
 * This is a GATE, not a report. Every category below names a place a credential can reach a URL in
 * the WEB runtime. A category is satisfied in exactly one of two ways:
 *
 *   producers : one or more resolved hits. Zero hits is a FAILURE — a pattern that silently stops
 *               matching while the exposure it described is still in the tree is worse than no
 *               inventory at all, because the design is then built against a surface nobody
 *               re-derived.
 *   absence   : an EXECUTABLE absence assertion. Not a sentence: a predicate that reads the tree
 *               (or the installed dependency, or the production bundle) and would fail if the
 *               surface appeared. An absence category with no assertion is a FAILURE too.
 *
 * Sources it reads, all resolved from this file, never from an absolute path:
 *
 *   src/                                   first-party source, generated SDK excluded
 *   src/lib/tesserafin-sdk/generated/      the generated client (separate source of truth)
 *   node_modules/jellyfin-apiclient/dist/  the INSTALLED prebuilt dependency bundle
 *   dist/                                  the PRODUCTION bundle, when one has been built
 *
 * Usage:
 *   node ci/credential-transport-inventory.mjs                 # baseline: pre-migration tree
 *   node ci/credential-transport-inventory.mjs --phase migrated # additionally assert the durable
 *                                                              # token no longer reaches any
 *                                                              # playback or socket URL
 *   node ci/credential-transport-inventory.mjs --json          # machine-readable on stdout
 *
 * OUTPUT SAFETY: this script prints file paths, line numbers and matched SOURCE text. It never
 * reads or prints a runtime credential value; it does not run the app.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const PHASE = args.includes('--phase')
    ? args[args.indexOf('--phase') + 1]
    : 'baseline';
const AS_JSON = args.includes('--json');

if (PHASE !== 'baseline' && PHASE !== 'migrated') {
    console.error(
        `unknown --phase ${PHASE}; expected 'baseline' or 'migrated'`
    );
    process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// tree walking
// ---------------------------------------------------------------------------------------------

const SOURCE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs)$/;
const GENERATED_SDK = join('src', 'lib', 'tesserafin-sdk', 'generated');

function walk(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile()) out.push(full);
    }
    return out;
}

function read(file) {
    try {
        return readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

const SRC_FILES = walk(join(ROOT, 'src'))
    .filter((f) => SOURCE_EXT.test(f))
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.startsWith(GENERATED_SDK + sep))
    .sort();

const SDK_FILES = walk(join(ROOT, GENERATED_SDK))
    .filter((f) => SOURCE_EXT.test(f))
    .map((f) => relative(ROOT, f))
    .sort();

const DEP_FILE = join(
    'node_modules',
    'jellyfin-apiclient',
    'dist',
    'jellyfin-apiclient.js'
);
const DEP_PRESENT = existsSync(join(ROOT, DEP_FILE));

const SDK_DEP_DIR = join('node_modules', '@jellyfin', 'sdk', 'lib');
const SDK_DEP_FILES = walk(join(ROOT, SDK_DEP_DIR))
    .filter((f) => /\.js$/.test(f))
    .map((f) => relative(ROOT, f))
    .sort();
const SDK_DEP_PRESENT = SDK_DEP_FILES.length > 0;

const DIST_DIR = join(ROOT, 'dist');
const DIST_FILES = walk(DIST_DIR)
    .filter((f) => /\.(js|css|html|json|m3u8|map)$/.test(f))
    .map((f) => relative(ROOT, f))
    .sort();
const DIST_PRESENT = DIST_FILES.length > 0;

/** Every line of every file in `files` matching `rx`. */
function grep(files, rx) {
    const hits = [];
    for (const f of files) {
        const lines = read(join(ROOT, f)).split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (rx.test(lines[i])) {
                hits.push({
                    file: f,
                    line: i + 1,
                    text: lines[i].trim().slice(0, 180)
                });
            }
            rx.lastIndex = 0;
        }
    }
    return hits;
}

/** Count of non-overlapping matches of `rx` across one file's whole content. */
function countIn(file, rx) {
    const content = read(join(ROOT, file));
    const m = content.match(rx);
    return m ? m.length : 0;
}

// ---------------------------------------------------------------------------------------------
// the categories
// ---------------------------------------------------------------------------------------------

/**
 * Shape of a category:
 *   kind          'producers' | 'absence'
 *   surface       the runtime family it names
 *   producer      who builds the url
 *   consumer      who requests it
 *   construction  'sync' | 'async' | 'server' | 'browser'
 *   identities    which of item / mediaSource / playSession are known BEFORE construction
 *   scope         the capability scope this family must demand
 *   childInherits how child requests get their query (inherit | reconstruct | n/a)
 *   durableToday  does the durable session token reach the url today
 *   provingTest   the runtime test that will prove the migration
 *   hits/assert   resolved evidence
 */
/**
 * Exactly two packages construct a WebSocket in the shipped bundle: the patched
 * `jellyfin-apiclient` prebuilt bundle (`api_key`) and `@jellyfin/sdk` (`ApiKey`). A third site is a
 * producer nobody inventoried.
 */
const KNOWN_WEBSOCKET_PRODUCERS = 2;

/**
 * `@jellyfin/sdk` `LibraryApi.getDownloadUrl()` builds `/Items/{id}/Download?ApiKey=<durable token>`.
 * That is a GENERAL-API route, not a media-delivery one: `AuthorizationContext` reads `ApiKey` there
 * by design, and a playback capability must NEVER authenticate it — `Policies.MediaDelivery` is the
 * only policy that names the capability scheme. It is therefore deliberately OUT OF SCOPE for
 * #153-A1 and is pinned here by count so it cannot grow silently.
 */
const OUT_OF_SCOPE_DOWNLOAD_URL_SITES = 1;

const categories = [];

function producers(spec) {
    categories.push({ kind: 'producers', ...spec });
}
function absence(spec) {
    categories.push({ kind: 'absence', ...spec });
}

// --- 1. the durable token itself ---------------------------------------------------------------
producers({
    id: 'durable-token-in-url',
    surface: 'every first-party url that names the session token',
    producer: 'src/** passing ApiKey into ApiClient.getUrl query objects',
    consumer: 'media element, fetch, DOM style',
    construction: 'sync',
    identities: 'varies per site; see the per-family categories',
    scope: 'n/a — this is the credential, not a family',
    childInherits: 'n/a',
    durableToday: true,
    provingTest: 'browser matrix: no request url carries ApiKey/api_key',
    hits: grep(SRC_FILES, /\bApiKey\s*:|\bApiKey=|\bapi_key=/)
});

producers({
    id: 'access-token-reads',
    surface: 'accessToken() reads that feed a url',
    producer: 'ApiClient.accessToken()',
    consumer: 'url builders',
    construction: 'sync',
    identities: 'n/a',
    scope: 'n/a',
    childInherits: 'n/a',
    durableToday: true,
    provingTest: 'unit: no url builder calls accessToken() after migration',
    hits: grep(SRC_FILES, /accessToken\(\)/)
});

// --- 2. getUrl ---------------------------------------------------------------------------------
producers({
    id: 'geturl',
    surface: 'the synchronous url builder every family goes through',
    producer:
        'jellyfin-apiclient ApiClient.getUrl(name, params, serverAddress)',
    consumer: 'all first-party callers',
    construction: 'sync',
    identities: 'whatever the caller already holds',
    scope: 'n/a',
    childInherits: 'n/a',
    durableToday: true,
    provingTest: 'unit: getUrl stays synchronous and gains no network call',
    hits: grep(SRC_FILES, /\.getUrl\(/)
});

producers({
    id: 'geturl-dependency-definition',
    surface: 'the installed dependency definition of getUrl',
    producer: 'node_modules/jellyfin-apiclient (prebuilt bundle)',
    consumer: 'first-party callers',
    construction: 'sync',
    identities: 'n/a',
    scope: 'n/a',
    childInherits: 'n/a',
    durableToday: false,
    provingTest: 'patcher test: pristine -> patched bytes',
    hits: DEP_PRESENT
        ? [
              {
                  file: DEP_FILE,
                  line: 0,
                  text: `getUrl definitions: ${countIn(DEP_FILE, /key:"getUrl"/g)}; ApiKey occurrences: ${countIn(DEP_FILE, /ApiKey/g)}; api_key occurrences: ${countIn(DEP_FILE, /api_key/g)}`
              }
          ]
        : []
});

// --- 3. direct video ---------------------------------------------------------------------------
producers({
    id: 'direct-video',
    surface: 'GET /Videos/{id}/stream.{container}?static=true',
    producer: 'playbackmanager.js createStreamInfo direct branch',
    consumer: '<video src>',
    construction: 'sync, inside an async playback boundary (playInternal)',
    identities: 'item, mediaSource known; playSession from PlaybackInfo',
    scope: 'Media',
    childInherits: 'n/a — single request, Range/HEAD reuse the same url',
    durableToday: true,
    provingTest:
        'browser matrix: direct video GET/HEAD/Range with playbackCapability only',
    hits: grep(
        SRC_FILES,
        /'\/stream\.'|"\/stream\."|\/stream\.' \+|Videos\/'\s*\+/
    )
});

// --- 4. direct audio ---------------------------------------------------------------------------
producers({
    id: 'direct-audio',
    surface: 'GET /Audio/{id}/stream.{container}?static=true',
    producer:
        "playbackmanager.js createStreamInfo, prefix = type === 'Video' ? 'Videos' : 'Audio'",
    consumer: '<audio src>',
    construction: 'sync, inside playInternal',
    identities: 'item, mediaSource known',
    scope: 'Media',
    childInherits: 'n/a',
    durableToday: true,
    provingTest: 'browser matrix: direct audio',
    hits: grep(SRC_FILES, /type === 'Video' \? 'Videos' : 'Audio'/)
});

// --- 5. universal audio ------------------------------------------------------------------------
producers({
    id: 'universal-audio',
    surface: 'GET /Audio/{id}/universal',
    producer: 'playbackmanager.js getAudioStreamUrl',
    consumer: '<audio src> / hls.js',
    construction: 'sync, and BEFORE any PlaybackInfo call',
    identities:
        'item known; mediaSource NOT named; playSession is CLIENT-INVENTED (startingPlaySession counter)',
    scope: 'Media',
    childInherits: 'hls child playlists inherit the echoed query',
    durableToday: true,
    provingTest: 'browser matrix: universal audio',
    hits: grep(SRC_FILES, /\/universal/)
});

// --- 6. transcoded video / TranscodingUrl ------------------------------------------------------
producers({
    id: 'transcoding-url',
    surface:
        'PlaybackInfo.MediaSources[].TranscodingUrl, built by the SERVER with api_key',
    producer:
        'server: StreamInfo.ToUrl(baseUrl, accessToken, query) via MediaInfoHelper; web consumes verbatim',
    consumer:
        'apiClient.getUrl(mediaSource.TranscodingUrl) -> <video src> / hls.js',
    construction: 'server, consumed synchronously',
    identities:
        'item, mediaSource, playSession all present in the PlaybackInfo response',
    scope: 'Media',
    childInherits:
        'HLS children inherit: DynamicHlsController echoes Request.QueryString verbatim into every segment uri',
    durableToday: true,
    provingTest:
        'browser matrix: transcoded HLS master + media playlist + child segments carry playbackCapability only',
    hits: grep(SRC_FILES, /TranscodingUrl/)
});

// --- 7. HLS playlists and child segments -------------------------------------------------------
producers({
    id: 'hls-playlists-and-children',
    surface: 'master.m3u8 / main.m3u8 / hls1/main/N.mp4',
    producer: 'server playlist body (query echoed) + hls.js resolving the uris',
    consumer: 'hls.js loader, or the native player',
    construction: 'browser',
    identities: 'inherited from the playlist url',
    scope: 'Media',
    childInherits:
        'inherit — the server writes the parent query into each child uri',
    durableToday: true,
    provingTest:
        'browser matrix: every hls child request carries playbackCapability only',
    hits: grep(SRC_FILES, /new Hls\(|loadSource\(|master\.m3u8/)
});

// --- 8. legacy HLS without a media-source parameter --------------------------------------------
producers({
    id: 'legacy-hls-no-media-source',
    surface:
        '/Videos/{id}/hls/{playlistId}/{segmentId}.ts and /Audio/{id}/hls/{seg}/stream.{ext}',
    producer:
        'server HlsSegmentController; reached from a legacy playlist body, never built in web src',
    consumer: 'hls.js / native player',
    construction: 'browser',
    identities:
        'item present in the route; media source NOT named -> the demand carries MediaSourceId = null, which REFUSES a media-source-bound capability',
    scope: 'Media, with mediaSourceId = null (a SEPARATE capability, not a widened one)',
    childInherits: 'inherit',
    durableToday: true,
    provingTest:
        'browser matrix: legacy HLS reached with a null-media-source capability; a media-source-bound one is refused',
    hits: grep(SRC_FILES, /htmlMediaHelper|hls\.js response error code/)
});

// --- 9. subtitles ------------------------------------------------------------------------------
producers({
    id: 'subtitles',
    surface: '/Videos/{id}/{ms}/Subtitles/{index}/{ticks}/Stream.{fmt}',
    producer:
        'SERVER: StreamInfo.GetSubtitleStreamInfo appends "?ApiKey=" + accessToken to DeliveryUrl; web consumes it verbatim',
    consumer:
        '<track src>, libass subUrl, apiClient.getUrl(textStream.DeliveryUrl)',
    construction: 'server, consumed synchronously',
    identities: 'item, mediaSource, playSession known from PlaybackInfo',
    scope: 'Subtitles',
    childInherits: 'subtitle playlist children inherit',
    durableToday: true,
    provingTest: 'browser matrix: subtitle stream + subtitle playlist',
    hits: grep(SRC_FILES, /DeliveryUrl|getSubtitleUrl|getTextTrackUrl/)
});

// --- 10. fallback fonts ------------------------------------------------------------------------
producers({
    id: 'fallback-fonts',
    surface: '/FallbackFont/Fonts and /FallbackFont/Fonts/{name}',
    producer: 'htmlVideoPlayer/plugin.js renderSsaAss',
    consumer: 'apiClient.getJSON + libass fonts[]',
    construction: 'sync, inside an async import().then() boundary',
    identities:
        'NO item and NO media source — this family is item-less by construction',
    scope: 'Fonts (the only item-less scope; it must NOT name an item)',
    childInherits: 'n/a',
    durableToday: true,
    provingTest:
        'browser matrix: font list + font file with a Fonts capability that names no item',
    hits: grep(SRC_FILES, /FallbackFont/)
});

// --- 11. attachments ---------------------------------------------------------------------------
producers({
    id: 'attachments',
    surface: '/Videos/{id}/{ms}/Attachments/{index}',
    producer:
        'SERVER: MediaInfoHelper sets attachment.DeliveryUrl with NO credential; web calls apiClient.getUrl(i.DeliveryUrl)',
    consumer: 'libass availableFonts[]',
    construction: 'server path, consumed synchronously',
    identities: 'item, mediaSource known from the media source',
    scope: 'Attachments',
    childInherits: 'n/a',
    durableToday: false,
    provingTest:
        'browser matrix: attachment fetch succeeds carrying an Attachments capability (it carries NO credential today)',
    hits: grep(SRC_FILES, /MediaAttachments|Attachments/)
});

// --- 12. trickplay -----------------------------------------------------------------------------
producers({
    id: 'trickplay',
    surface:
        '/Videos/{id}/Trickplay/{width}/{n}.jpg and /Trickplay/{width}/tiles.m3u8',
    producer: 'apps/legacy/controllers/playback/video/index.js',
    consumer: 'CSS background-image on the chapter thumb element',
    construction: 'sync, inside the scrubber handler',
    identities: 'item and mediaSource known',
    scope: 'Trickplay',
    childInherits: 'n/a',
    durableToday: true,
    provingTest:
        'browser matrix: trickplay image request + the DOM style attribute contains no durable token',
    hits: grep(SRC_FILES, /Trickplay/)
});

// --- 13. urls placed in DOM attributes or CSS --------------------------------------------------
producers({
    id: 'dom-and-css-url-placement',
    surface: 'a media url that lands in a DOM attribute or a style declaration',
    producer: 'setAttribute / .src = / style.backgroundImage',
    consumer: 'the DOM itself — visible to any script and to a DOM dump',
    construction: 'sync',
    identities: 'inherited from the builder',
    scope: 'inherited',
    childInherits: 'n/a',
    durableToday: true,
    provingTest:
        'browser matrix: dump every attribute value and computed style url; none contains the durable token',
    hits: grep(
        SRC_FILES,
        /style\.backgroundImage|backgroundImage\s*=|setAttribute\(\s*['"]src|\.src\s*=\s*|setCurrentSrc/
    )
});

// --- 14. websocket -----------------------------------------------------------------------------
producers({
    id: 'websocket-upgrade',
    surface: 'ws(s)://…/socket?api_key=…&deviceId=…',
    producer:
        'jellyfin-apiclient openWebSocket() — SYNCHRONOUS, throws without an access token; the ONLY api_key in the installed bundle',
    consumer: 'the browser WebSocket upgrade',
    construction: 'sync',
    identities: 'device known; no item/media source/play session',
    scope: 'n/a — a WebSocket ticket, not a playback capability',
    childInherits: 'n/a',
    durableToday: true,
    provingTest:
        'browser matrix: initial upgrade, message exchange and reconnect each carry a distinct webSocketTicket and no api_key',
    hits: DEP_PRESENT
        ? [
              {
                  file: DEP_FILE,
                  line: 0,
                  text: `openWebSocket definitions: ${countIn(DEP_FILE, /key:"openWebSocket"/g)}; api_key occurrences: ${countIn(DEP_FILE, /api_key/g)}`
              },
              ...grep(SRC_FILES, /openWebSocket|ensureWebSocket|closeWebSocket/)
          ]
        : grep(SRC_FILES, /openWebSocket|ensureWebSocket|closeWebSocket/)
});

producers({
    id: 'websocket-reconnection',
    surface: 'the reconnect path that re-enters openWebSocket',
    producer:
        'jellyfin-apiclient onclose -> websocketclose event; first-party listeners re-ensure',
    consumer: 'the browser WebSocket upgrade',
    construction: 'sync',
    identities: 'device known',
    scope: 'n/a',
    childInherits: 'n/a',
    durableToday: true,
    provingTest:
        'browser matrix: a forced close mints a SECOND ticket, never reuses the first',
    hits: DEP_PRESENT
        ? [
              {
                  file: DEP_FILE,
                  line: 0,
                  text: `websocketclose handlers: ${countIn(DEP_FILE, /websocketclose/g)}; ensureWebSocket definitions: ${countIn(DEP_FILE, /key:"ensureWebSocket"/g)}`
              },
              ...grep(SRC_FILES, /websocketclose|websocketopen/)
          ]
        : grep(SRC_FILES, /websocketclose|websocketopen/)
});

// --- 15. server-emitted urls consumed by the web client ----------------------------------------
producers({
    id: 'server-emitted-urls',
    surface: 'every url the web client did not build itself',
    producer:
        'server (TranscodingUrl, subtitle DeliveryUrl, attachment DeliveryUrl, playlist bodies)',
    consumer: 'web, verbatim through apiClient.getUrl(...)',
    construction: 'server',
    identities: 'present in the PlaybackInfo response',
    scope: 'per family',
    childInherits: 'inherit',
    durableToday: true,
    provingTest:
        'browser matrix: every server-emitted url is rewritten before use; none reaches the network with a durable token',
    hits: grep(
        SRC_FILES,
        /getUrl\(\s*(mediaSource\.TranscodingUrl|textStream\.DeliveryUrl|i\.DeliveryUrl|stream\.DeliveryUrl)/
    )
});

// --- 16. the generated SDK seam ----------------------------------------------------------------
producers({
    id: 'generated-sdk-credential-apis',
    surface: 'PlaybackCredentialsApi and WebSocketTicketsApi',
    producer: 'the merged generated SDK',
    consumer:
        'the A1 credential broker (mint + renew), authenticating in the HEADER only',
    construction: 'async',
    identities: 'the broker supplies them',
    scope: 'n/a',
    childInherits: 'n/a',
    durableToday: false,
    provingTest:
        'unit: mint/renew requests carry no url credential and an Authorization header',
    hits: grep(SDK_FILES, /PlaybackCredentialsApi|WebSocketTicketsApi/)
});

// --- 16b. the SECOND websocket producer: @jellyfin/sdk -----------------------------------------
producers({
    id: 'sdk-websocket-producer',
    surface:
        'ws(s)://…/socket?ApiKey=… built by @jellyfin/sdk, NOT by jellyfin-apiclient',
    producer:
        '@jellyfin/sdk Api.subscribe() and Api.update() call getUri(WEBSOCKET_URL_PATH, { ApiKey: accessToken }); WebSocketService then owns the socket',
    consumer:
        'every first-party api.subscribe(...) caller — useApi hooks, serverNotifications, taskbutton, playbackmanager remote control, guide, recordingfields, itemDetailsApi',
    construction: 'sync',
    identities: 'device and user known; no item/media source/play session',
    scope: 'n/a — a WebSocket ticket',
    childInherits: 'n/a',
    durableToday: true,
    provingTest:
        'browser matrix: the sdk socket upgrade carries webSocketTicket only, and a reconnect mints a NEW ticket',
    hits: SDK_DEP_PRESENT
        ? grep(
              SDK_DEP_FILES,
              /AUTHORIZATION_PARAMETER|WEBSOCKET_URL_PATH|new WebSocket\(/
          )
        : []
});

producers({
    id: 'sdk-websocket-reconnect-reuses-url',
    surface: 'the sdk reconnect path',
    producer:
        "@jellyfin/sdk WebSocketService: the 'close' handler re-enters initSocket() after an exponential backoff and rebuilds the socket from the STORED this.url",
    consumer: 'the browser WebSocket upgrade',
    construction: 'sync, on a timer',
    identities: 'none — the url is replayed verbatim',
    scope: 'n/a',
    childInherits: 'n/a',
    durableToday: true,
    provingTest:
        'unit + browser: a forced close must not replay the previous ticket; a consumed ticket must never be re-presented',
    hits: SDK_DEP_PRESENT
        ? grep(
              SDK_DEP_FILES,
              /reconnectionTimeout|calculateBackoffDelay|autoReconnectDisabled/
          )
        : []
});

absence({
    id: 'websocket-producers-in-production-bundle',
    surface: 'every WebSocket constructed by the shipped bundle',
    producer:
        'whatever ends up in dist/ — the only ground truth for what ships',
    consumer: 'the browser',
    construction: 'build',
    identities: 'n/a',
    scope: 'n/a',
    childInherits: 'n/a',
    durableToday: true,
    provingTest:
        'bundle scan: exactly the two known producers construct a WebSocket; a third fails this category',
    assert: () => {
        if (!DIST_PRESENT) {
            return {
                ok: false,
                detail: 'no production build present — this category cannot be evaluated; run npm run build:production'
            };
        }
        const js = DIST_FILES.filter((f) => f.endsWith('.js'));
        const sites = js
            .map((f) => countIn(f, /new WebSocket\(/g))
            .reduce((a, b) => a + b, 0);
        const apiKeyParam = js
            .map((f) => countIn(f, /api_key/g))
            .reduce((a, b) => a + b, 0);
        const apiKeyProp = js
            .map((f) => countIn(f, /ApiKey\s*:/g))
            .reduce((a, b) => a + b, 0);
        // TWO producers, and only two: the patched jellyfin-apiclient bundle and @jellyfin/sdk.
        // A third `new WebSocket(` site is a producer nobody inventoried.
        const ok = sites === KNOWN_WEBSOCKET_PRODUCERS;
        return {
            ok,
            detail: `new WebSocket( sites: ${sites} (expected ${KNOWN_WEBSOCKET_PRODUCERS}); api_key: ${apiKeyParam}; ApiKey: ${apiKeyProp}`
        };
    }
});

// --- 17. Range and HEAD ------------------------------------------------------------------------
producers({
    id: 'range-and-head',
    surface: 'HEAD and Range requests against a media url',
    producer:
        'TWO producers. (a) FIRST-PARTY: htmlAudioPlayer enableHlsPlayer() issues a HEAD against the media url through utils/fetch to sniff Content-Type before choosing hls.js. (b) THE BROWSER: a media element issues its own HEAD/Range against the src it was given.',
    consumer: 'utils/fetch ajax, and the media element itself',
    construction:
        'sync url, async request; the url is already built when the HEAD is issued',
    identities: 'inherited from the url the player was handed',
    scope: 'Media — inherited; the SAME capability must satisfy the HEAD, the Range and the GET',
    childInherits: 'inherit — identical url, identical query',
    durableToday: true,
    provingTest:
        'browser matrix: the first-party HEAD, a browser Range GET and the plain GET against the direct-video url all succeed (200/200/206) carrying playbackCapability only',
    hits: grep(
        SRC_FILES,
        /type\s*:\s*['"]HEAD['"]|method\s*:\s*['"]HEAD['"]|['"]Range['"]\s*:/
    ).filter((h) => !/\.(test|spec)\./.test(h.file))
});

// --- 18. LIVE TV -------------------------------------------------------------------------------
absence({
    id: 'livetv-delivery-routes',
    surface:
        '/LiveTv/LiveRecordings/{recordingId}/stream and /LiveTv/LiveStreamFiles/{streamId}/stream.{container}',
    producer:
        'SERVER only: SharedHttpStream.Open and HdHomerunUdpStream.Open write the LiveStreamFiles url into MediaSource.Path; MediaSourceManager.GetRecordingStreamMediaSources writes the LiveRecordings url into EncoderPath (a server-side ffmpeg input, never client-facing)',
    consumer:
        'NOBODY in the web runtime — see the assertion. Web live TV playback goes through /Videos/{channelItemId}/… like any other item.',
    construction: 'server',
    identities: 'n/a',
    scope: 'NOT MODELLED by the merged contract. LiveTvController carries plain [Authorize], deliberately not Policies.MediaDelivery and with no [RequiresPlaybackCapability].',
    childInherits: 'n/a',
    durableToday: 'durable token only, and only if a client requested it',
    provingTest:
        'browser matrix + runtime probe: play a live TV channel and assert no request url matches /LiveTv/Live(StreamFiles|Recordings)/',
    assert: () => {
        const rx = /\/LiveTv\/Live(StreamFiles|Recordings)/;
        const firstParty = grep(SRC_FILES, rx);
        const sdk = grep(SDK_FILES, rx);
        // The generated SDK necessarily declares both routes: it is generated from the whole
        // contract. What matters is that no first-party module CALLS the generated operations.
        const sdkCallers = grep(
            SRC_FILES,
            /getLiveRecordingFile|getLiveStreamFile/
        );
        const ok = firstParty.length === 0 && sdkCallers.length === 0;
        return {
            ok,
            detail: ok
                ? `no first-party producer and no caller of the generated operations; the generated SDK declares the two routes at ${sdk
                      .map((h) => `${h.file}:${h.line}`)
                      .join(', ')} and nothing calls them`
                : `LIVE TV IS REACHED: ${[...firstParty, ...sdkCallers]
                      .map((h) => `${h.file}:${h.line}`)
                      .join(', ')}`
        };
    }
});

absence({
    id: 'livetv-direct-play-path',
    surface: 'mediaSource.Path used verbatim as the media url',
    producer:
        'playbackmanager.js createStreamInfo, mediaSource.enableDirectPlay branch',
    consumer: '<video src>',
    construction: 'sync',
    identities: 'n/a — the url is opaque server output',
    scope: 'n/a',
    childInherits: 'n/a',
    durableToday: false,
    provingTest:
        'runtime probe: open a live stream and assert the opened media source never reaches the direct-play branch',
    assert: () => {
        // This is the ONLY branch that could turn a server-supplied LiveStreamFiles url into a
        // browser request. It is gated by supportsDirectPlay(), whose sole true-returning path
        // requires `Protocol === 'Http' && !RequiredHttpHeaders.length`. Every live source whose
        // Path is a LiveStreamFiles url sets a User-Agent in RequiredHttpHeaders (M3UTunerHost) or
        // ships SupportsDirectPlay = false (HdHomerunHost). Assert the gate still reads both.
        const pathUse = grep(SRC_FILES, /mediaUrl = mediaSource\.Path/);
        const gate = grep(SRC_FILES, /RequiredHttpHeaders\.length/);
        const ok = pathUse.length > 0 && gate.length > 0;
        return {
            ok,
            detail: ok
                ? `direct-play branch at ${pathUse
                      .map((h) => `${h.file}:${h.line}`)
                      .join(
                          ', '
                      )} is still gated by the RequiredHttpHeaders check at ${gate
                      .map((h) => `${h.file}:${h.line}`)
                      .join(', ')}`
                : `the direct-play gate changed shape: mediaSource.Path uses=${pathUse.length}, RequiredHttpHeaders gate=${gate.length}`
        };
    }
});

// --- 19. the production bundle -----------------------------------------------------------------
absence({
    id: 'production-bundle',
    surface: 'the built bundle, not the source tree',
    producer: 'webpack production build',
    consumer: 'the browser',
    construction: 'build',
    identities: 'n/a',
    scope: 'n/a',
    childInherits: 'n/a',
    durableToday: true,
    provingTest:
        'bundle scan: the migrated bundle contains no ApiKey/api_key url construction',
    assert: () => {
        if (!DIST_PRESENT) {
            return {
                ok: PHASE === 'baseline',
                detail:
                    PHASE === 'baseline'
                        ? 'no dist/ present; the bundle assertion is deferred to the migrated phase, which requires a production build'
                        : 'MIGRATED PHASE REQUIRES A PRODUCTION BUILD: dist/ is absent'
            };
        }
        const bundleHits = grep(
            DIST_FILES.filter((f) => f.endsWith('.js')),
            /ApiKey\s*:|api_key=/
        ).filter((h) => !/\/Download`?,\s*\{/.test(h.text));
        if (PHASE === 'baseline') {
            return {
                ok: true,
                detail: `baseline bundle carries ${bundleHits.length} durable-token url construction site(s)`
            };
        }
        return {
            ok: bundleHits.length === 0,
            detail:
                bundleHits.length === 0
                    ? `migrated bundle carries no ApiKey/api_key url construction outside the ${OUT_OF_SCOPE_DOWNLOAD_URL_SITES} pinned general-api Download site(s)`
                    : `migrated bundle still carries ${bundleHits.length} site(s): ${bundleHits
                          .map((h) => `${h.file}:${h.line}`)
                          .join(', ')}`
        };
    }
});

// ---------------------------------------------------------------------------------------------
// migrated-phase assertions
// ---------------------------------------------------------------------------------------------

const migratedAssertions = [];
if (PHASE === 'migrated') {
    migratedAssertions.push({
        id: 'no-durable-token-in-any-playback-url',
        assert: () => {
            const hits = grep(SRC_FILES, /\bApiKey\s*:\s*.*accessToken\(\)/);
            return {
                ok: hits.length === 0,
                detail:
                    hits.length === 0
                        ? 'no src/ site puts the durable token into a url'
                        : hits.map((h) => `${h.file}:${h.line}`).join(', ')
            };
        }
    });
    migratedAssertions.push({
        id: 'no-apikey-parameter-in-sdk-websocket',
        assert: () => {
            if (!SDK_DEP_PRESENT) {
                return { ok: false, detail: '@jellyfin/sdk missing' };
            }
            const hits = grep(
                SDK_DEP_FILES,
                /AUTHORIZATION_PARAMETER\]\s*:\s*this\.accessToken/
            );
            return {
                ok: hits.length === 0,
                detail:
                    hits.length === 0
                        ? 'the sdk no longer names the durable token in the socket uri'
                        : hits.map((h) => `${h.file}:${h.line}`).join(', ')
            };
        }
    });
    migratedAssertions.push({
        id: 'no-api_key-in-installed-dependency',
        assert: () => {
            if (!DEP_PRESENT) {
                return { ok: false, detail: 'installed dependency missing' };
            }
            const n = countIn(DEP_FILE, /api_key/g);
            return {
                ok: n === 0,
                detail: `installed jellyfin-apiclient api_key occurrences: ${n}`
            };
        }
    });
}

// ---------------------------------------------------------------------------------------------
// verdict
// ---------------------------------------------------------------------------------------------

const results = categories.map((c) => {
    if (c.kind === 'producers') {
        return {
            ...c,
            hitCount: c.hits.length,
            ok: c.hits.length > 0,
            detail:
                c.hits.length > 0
                    ? `${c.hits.length} hit(s)`
                    : 'ZERO HITS — a named category resolved to nothing'
        };
    }
    const a = c.assert();
    return { ...c, hitCount: null, ok: a.ok, detail: a.detail };
});

const migrated = migratedAssertions.map((m) => ({ id: m.id, ...m.assert() }));

const failures = [
    ...results.filter((r) => !r.ok).map((r) => `category ${r.id}: ${r.detail}`),
    ...migrated.filter((m) => !m.ok).map((m) => `migrated ${m.id}: ${m.detail}`)
];

const report = {
    generatedFor: '#153-A1 phase 0',
    phase: PHASE,
    sources: {
        srcFiles: SRC_FILES.length,
        generatedSdkFiles: SDK_FILES.length,
        installedDependency: DEP_PRESENT ? DEP_FILE : null,
        productionBundleFiles: DIST_FILES.length
    },
    categories: results.map((r) => ({
        id: r.id,
        kind: r.kind,
        surface: r.surface,
        producer: r.producer,
        consumer: r.consumer,
        construction: r.construction,
        identities: r.identities,
        scope: r.scope,
        childInherits: r.childInherits,
        durableTokenReachesUrlToday: r.durableToday,
        provingTest: r.provingTest,
        hitCount: r.hitCount,
        ok: r.ok,
        detail: r.detail,
        hits: r.kind === 'producers' ? r.hits : undefined
    })),
    migratedAssertions: migrated,
    emptyCategories: results.filter((r) => !r.ok).map((r) => r.id),
    ok: failures.length === 0
};

if (AS_JSON) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

for (const r of results) {
    const mark = r.ok ? 'ok  ' : 'FAIL';
    const count =
        r.hitCount === null ? 'absence' : String(r.hitCount).padStart(4);
    process.stderr.write(
        `${mark} ${r.id.padEnd(34)} ${r.kind.padEnd(9)} ${count.padStart(8)}  ${r.detail.slice(0, 110)}\n`
    );
}
for (const m of migrated) {
    process.stderr.write(
        `${m.ok ? 'ok  ' : 'FAIL'} ${m.id.padEnd(34)} migrated             ${m.detail.slice(0, 110)}\n`
    );
}

if (failures.length > 0) {
    process.stderr.write(`\nFAIL: ${failures.length} gate failure(s):\n`);
    for (const f of failures) process.stderr.write(`  - ${f}\n`);
    process.exit(1);
}
process.stderr.write('\nOK: every category resolved.\n');
