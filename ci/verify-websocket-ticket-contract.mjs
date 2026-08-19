#!/usr/bin/env node
/*
 * #153-A1-R2 — the leash on the minimal WebSocket-ticket adapter.
 *
 * WHY THE ADAPTER EXISTS
 *
 *   `scripts/patch-jellyfin-sdk.mjs` makes `Api.subscribe()` supply the socket with an asynchronous
 *   ticket provider. That provider posts `/WebSocket/Tickets` directly instead of importing the
 *   generated `WebSocketTicketsApi`, because pulling a generated client into the boot graph creates
 *   exactly the start-up chunk #153-A1-R2 exists to remove, and no delivery ceiling may be raised
 *   for it.
 *
 * WHY IT NEEDS A GATE
 *
 *   A hand-written call to a generated contract is a second source of truth, and second sources of
 *   truth drift silently: the generator moves the route, and the adapter keeps posting to the old
 *   one until a rig test happens to notice. So the adapter is pinned to the GENERATED client, and
 *   this gate fails `validate:full` the moment the two disagree. It compares:
 *
 *     * the HTTP method                       — from the generated parameter creator
 *     * the path                              — from the generated `localVarPath`
 *     * that no request body is sent          — the generated creator builds none
 *     * that no query parameter is sent       — the generated creator adds none
 *     * that only `Value` is read             — from the generated `WebSocketTicketDto`
 *
 *   It also asserts the three properties the OWNER ruling names, which are about the adapter alone
 *   and have no counterpart in the generated client:
 *
 *     * the `Authorization` header is produced ONLY by the `Api`'s own `authorizationHeader`
 *       getter — the adapter must never assemble a credential itself;
 *     * no parallel DTO is declared beyond extracting `Value`;
 *     * an absent or empty `Value` is a CLOSED refusal (a throw), never a fallback.
 *
 * WHAT IT READS
 *
 *   The adapter is read out of `TARGETS` in the patcher rather than off disk in `node_modules`, so
 *   the gate is checking the transform that WILL be applied on a clean install, not whatever a
 *   local tree happens to contain.
 *
 * OUTPUT SAFETY: no branch prints a credential, a ticket, or a header value.
 *
 * USAGE
 *
 *   node ci/verify-websocket-ticket-contract.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TARGETS } from '../scripts/patch-jellyfin-sdk.mjs';

const TAG = '[verify:websocket-ticket-contract]';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GENERATED_API = join(
    'src',
    'lib',
    'tesserafin-sdk',
    'generated',
    'api',
    'web-socket-tickets-api.ts'
);
const GENERATED_DTO = join(
    'src',
    'lib',
    'tesserafin-sdk',
    'generated',
    'models',
    'web-socket-ticket-dto.ts'
);

const failures = [];
const fail = (message) => failures.push(message);

const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');

// ---------------------------------------------------------------- the generated side
const generated = read(GENERATED_API);
const dto = read(GENERATED_DTO);

const creator = generated.slice(
    generated.indexOf('mintWebSocketTicket: async ('),
    generated.indexOf('WebSocketTicketsApi - functional programming interface')
);
if (creator.length === 0) {
    fail(
        `${GENERATED_API} no longer contains a \`mintWebSocketTicket\` parameter creator; the ` +
            'contract this adapter is pinned to has moved.'
    );
}

const pathMatch = creator.match(/const localVarPath = `([^`]+)`/);
if (!pathMatch) {
    fail(
        `${GENERATED_API}: could not read \`localVarPath\` for mintWebSocketTicket.`
    );
}
const generatedPath = pathMatch?.[1];
if (generatedPath && /\$\{/.test(generatedPath)) {
    fail(
        `${GENERATED_API}: the ticket route is now parameterised (${generatedPath}). The adapter ` +
            'posts a constant path and cannot express that; it must import the generated client.'
    );
}

const methodMatch = creator.match(/method:\s*'([A-Z]+)'/);
if (!methodMatch) {
    fail(
        `${GENERATED_API}: could not read the HTTP method for mintWebSocketTicket.`
    );
}
const generatedMethod = methodMatch?.[1];

// The generated creator serialises a body only via `serializeDataIfNeeded`, and adds query
// parameters only by assigning into `localVarQueryParameter`. Either appearing means the route
// grew an input the adapter does not send.
if (/serializeDataIfNeeded\(/.test(creator)) {
    fail(
        `${GENERATED_API}: mintWebSocketTicket now sends a request body. The adapter posts ` +
            '`undefined` and would silently send nothing.'
    );
}
if (
    /localVarQueryParameter\[/.test(creator) ||
    /localVarQueryParameter\./.test(creator)
) {
    fail(
        `${GENERATED_API}: mintWebSocketTicket now sends query parameters. The adapter sends none.`
    );
}
if (
    !/setApiKeyToObject\(localVarHeaderParameter, "Authorization", configuration\)/.test(
        creator
    )
) {
    fail(
        `${GENERATED_API}: mintWebSocketTicket is no longer authenticated by the \`Authorization\` ` +
            'header. The adapter sends exactly that header and nothing else.'
    );
}

if (!/'Value'\?:\s*string;/.test(dto)) {
    fail(
        `${GENERATED_DTO}: \`Value\` is no longer a string field on WebSocketTicketDto; the ` +
            'adapter reads exactly that field.'
    );
}

// ---------------------------------------------------------------- the adapter side
const apiTarget = TARGETS.find((target) => target.id === 'api');
const replacement = apiTarget?.fragments.find((fragment) =>
    fragment.safe.includes('WebSocket/Tickets')
)?.safe;
/*
 * Only the CLOSURE is the adapter.
 *
 * The surrounding replacement is the `new WebSocketService(...)` call, whose first argument is the
 * ternary `this.accessToken ? getUri(...) : undefined` — "is there a session yet?", not a url
 * credential. Scoping to the closure is what lets the credential assertions below be blunt: inside
 * the adapter, naming an access token at all is a defect.
 */
const adapterStart = replacement?.indexOf('async () => {') ?? -1;
const adapter = adapterStart >= 0 ? replacement.slice(adapterStart) : undefined;

if (!adapter) {
    fail(
        'scripts/patch-jellyfin-sdk.mjs no longer contains a replacement that reaches ' +
            '/WebSocket/Tickets; the ticket adapter is gone.'
    );
} else {
    if (
        generatedMethod &&
        !adapter.includes(`.${generatedMethod.toLowerCase()}(`)
    ) {
        fail(
            `the adapter does not use the generated method (${generatedMethod}). Method and ` +
                'contract must move together.'
        );
    }
    if (generatedPath && !adapter.includes(`${generatedPath}\``)) {
        fail(
            `the adapter does not post the generated path (${generatedPath}). Path and contract ` +
                'must move together.'
        );
    }
    // No body: the second positional argument to `.post()` is `undefined`, spelled out.
    if (!/\.post\([^,]+,\s*undefined,/.test(adapter)) {
        fail(
            'the adapter does not pass an explicit `undefined` body. The generated client sends ' +
                'no body and the adapter must say so rather than omitting the argument.'
        );
    }
    // No query: nothing may append a search string to the posted url.
    if (
        /[?&]/.test(
            adapter.split('\n').find((line) => line.includes('.post(')) ?? ''
        )
    ) {
        fail(
            'the adapter appends a query string to the ticket url; the route takes none.'
        );
    }
    // The header is the Api's own, and the adapter builds none of its own.
    if (
        !/headers:\s*\{\s*Authorization:\s*this\.authorizationHeader\s*\}/.test(
            adapter
        )
    ) {
        fail(
            'the adapter does not take its `Authorization` header from `this.authorizationHeader`. ' +
                'It must never assemble a credential itself.'
        );
    }
    if (/MediaBrowser |Token=|accessToken/.test(adapter)) {
        fail(
            'the adapter names a credential or assembles an authorization value itself; only the ' +
                "Api's own getter may produce one."
        );
    }
    if (/ApiKey|api_key/.test(adapter)) {
        fail('the adapter names a durable-token url parameter.');
    }
    // Only `Value` is read: no parallel DTO.
    const readFields = [
        ...adapter.matchAll(/\bdata\??\.([A-Za-z_$][\w$]*)/g)
    ].map((match) => match[1]);
    const extra = [...new Set(readFields)].filter((name) => name !== 'Value');
    if (extra.length > 0) {
        fail(
            `the adapter reads ${extra.join(', ')} from the response. It may extract \`Value\` ` +
                'and nothing else; anything more is a parallel DTO.'
        );
    }
    if (!readFields.includes('Value')) {
        fail('the adapter never reads `Value` from the response.');
    }
    // Closed refusal.
    if (!/if\s*\(!value\)\s*\{[\s\S]*?throw new Error\(/.test(adapter)) {
        fail(
            'an absent or empty `Value` is not a closed refusal. It must throw, so the socket is ' +
                'never opened without a ticket.'
        );
    }
}

if (failures.length > 0) {
    console.error(`${TAG} FAIL:`);
    for (const message of failures) console.error(`  - ${message}`);
    process.exit(1);
}

console.log(
    `${TAG} PASS: the ticket adapter matches the generated contract ` +
        `(${generatedMethod} ${generatedPath}, no body, no query, Authorization header, reads Value only, ` +
        'closed refusal on an empty ticket).'
);
