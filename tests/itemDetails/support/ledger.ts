/**
 * The migrated Item Details request/action ledger: loader, resolver and exact comparator.
 *
 * `tests/fixtures/item-details/migrated-request-action-ledger.json` is the authoritative record.
 * This module is the only thing that reads it, so the JSON's meaning lives in one place: what a
 * `$role` resolves to, what an `@path:` marker means, and what "this observation matches that row"
 * means.
 *
 * The comparator ({@link compareLedgerRuns}) is written to be reused by #129 Step 2: the recipe
 * binding must leave the ledger byte-identical, and the cheapest way to prove that is to run the
 * same comparison against the bound route. Nothing here reads, resolves or simulates a presentation
 * recipe.
 */
import ledgerFixture from '../../fixtures/item-details/migrated-request-action-ledger.json';

export interface LedgerRequestRow {
    id: string;
    surface: string;
    member: string;
    kind: 'REQUEST' | 'URL_BUILDER' | 'LOCAL_ACCESSOR' | 'SUBSCRIPTION';
    phase: string;
    group: string;
    trigger: string;
    guard: string;
    dependsOn: string[];
    args: unknown[];
    identity: Record<string, string>;
    cardinality: number | string;
    source: string;
}

export interface LedgerActionRow {
    id: string;
    control: Record<string, string>;
    trigger: string;
    state: string;
    preconditions: string;
    service: string;
    member: string;
    payload: unknown;
    target: string;
    multiplicity: number;
    followUp: string;
    refetch?: string[];
    confirmation?: string[];
}

export interface LedgerClass {
    id: string;
    routeParams: Record<string, string>;
    itemType: string;
    identity: Record<string, string>;
    roleCollisions: { role: string; value: string }[];
    listContainer: string | null;
    variants: LedgerVariant[];
    requests: LedgerRequestRow[];
    absentRequests: { signature: string; reason: string }[];
    actions: LedgerActionRow[];
    absentActions: { id: string; reason: string }[];
    localOnly: {
        id: string;
        control: Record<string, string>;
        reason: string;
    }[];
    disabledControls: {
        id: string;
        control: Record<string, string>;
        reason: string;
    }[];
    delegatedControls: {
        id: string;
        control: Record<string, string>;
        owner: string;
        reason: string;
    }[];
    navigation: {
        id: string;
        section: string;
        hrefShape: string;
        targetRole: string;
        note: string;
    }[];
}

export interface LedgerVariant {
    id: string;
    description: string;
    setup?: { control: string; value: string }[];
    itemOverride?: Record<string, string>;
    expectations: {
        action: string;
        member: string;
        payload?: unknown;
        payloadItem?: string;
        requires?: string[];
        proves: string;
    }[];
}

export interface Ledger {
    $comment: string;
    version: number;
    status: string;
    step: string;
    historicalContract: Record<string, string>;
    route: Record<string, unknown>;
    presentationBinding: Record<string, unknown>;
    causality: { phases: { id: string; description: string }[]; note: string };
    surfaces: { id: string; description: string }[];
    effectFrontier: {
        module: string;
        classification: string;
        surface: string | null;
        note: string | null;
    }[];
    identityRoles: { role: string; description: string }[];
    classes: LedgerClass[];
}

export const LEDGER = ledgerFixture as unknown as Ledger;

export function ledgerClass(id: string): LedgerClass {
    const found = LEDGER.classes.find((entry) => entry.id === id);
    if (!found) {
        throw new Error(
            `[item-details ledger] no class "${id}" in migrated-request-action-ledger.json. ` +
                'Every equivalence class must have a ledger entry.'
        );
    }
    return found;
}

/** One recorded outward call, from either API surface or from a service. */
export interface Observation {
    surface: string;
    member: string;
    args: unknown[];
}

/**
 * Resolve the identity roles a ledger value is written in.
 *
 * `"$itemId"` is the WHOLE value and resolves to the concrete id. `"…${itemId}…"` is an
 * interpolation inside a larger string (a URL path, mostly). An unknown role throws rather than
 * resolving to `undefined`: a ledger that names a role the class does not declare is a defect in
 * the ledger, not a passing test.
 */
export function resolveValue(
    value: unknown,
    identity: Record<string, string>
): unknown {
    if (typeof value === 'string') {
        if (value.startsWith('$') && !value.startsWith('${')) {
            const role = value.slice(1);
            if (!(role in identity)) {
                throw new Error(
                    `[item-details ledger] unknown identity role "${role}". ` +
                        `The class declares: ${Object.keys(identity).join(', ')}.`
                );
            }
            return identity[role];
        }
        return value.replace(/\$\{([^}]+)\}/g, (_match, role: string) => {
            if (!(role in identity)) {
                throw new Error(
                    `[item-details ledger] unknown identity role "${role}".`
                );
            }
            return identity[role];
        });
    }
    if (Array.isArray(value))
        return value.map((entry) => resolveValue(entry, identity));
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value))
            out[key] = resolveValue(entry, identity);
        return out;
    }
    return value;
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Does one observed value satisfy one resolved ledger value?
 *
 * Exact, with three declared relaxations and nothing else:
 *
 *   `@path:X`   — the observed value is an absolute URL whose path ends with `X`. The ledger never
 *                 records an origin, because an origin is environment-specific data.
 *   `@opaque:X` — the observed value is some non-empty string the route did not compose itself
 *                 (a download URL handed back by the SDK). `X` says what it is.
 *   `<X>`       — the observed value is a live object the ledger cannot serialise (a DOM element,
 *                 an api client). `X` says what it is.
 */
export function valueMatches(expected: unknown, observed: unknown): boolean {
    if (typeof expected === 'string') {
        if (expected.startsWith('@path:')) {
            const path = expected.slice('@path:'.length);
            return typeof observed === 'string' && observed.endsWith(path);
        }
        if (expected.startsWith('@opaque:')) {
            return typeof observed === 'string' && observed.length > 0;
        }
        if (expected.startsWith('<') && expected.endsWith('>')) {
            return observed !== undefined && observed !== null;
        }
    }
    if (Array.isArray(expected)) {
        if (!Array.isArray(observed) || observed.length !== expected.length)
            return false;
        return expected.every((entry, index) =>
            valueMatches(entry, observed[index])
        );
    }
    if (isPlain(expected)) {
        if (!isPlain(observed)) return false;
        const expectedKeys = Object.keys(expected).sort();
        const observedKeys = Object.keys(observed).sort();
        if (expectedKeys.join(',') !== observedKeys.join(',')) return false;
        return expectedKeys.every((key) =>
            valueMatches(expected[key], observed[key])
        );
    }
    return Object.is(expected, observed);
}

/**
 * Does one observation satisfy one request row?
 *
 * Two row kinds carry a SET of accepted argument shapes rather than one:
 *
 *   `getScaledImageUrl` — the ledger freezes the distinct option sets a class draws, not the order
 *     or the number of times React draws them. `arg[1]` is therefore a list of accepted shapes.
 *   `subscribe` on the delegated widget — four independent subscriptions, one row.
 *
 * A subscription's second argument is the caller's handler function, which no fixture can express;
 * only the message list is compared.
 */
export function requestMatches(
    row: LedgerRequestRow,
    observation: Observation,
    identity: Record<string, string>
): boolean {
    if (
        row.surface !== observation.surface ||
        row.member !== observation.member
    )
        return false;

    const resolved = resolveValue(row.args, identity) as unknown[];

    if (row.kind === 'SUBSCRIPTION') {
        return resolved.some((messages) =>
            valueMatches(messages, observation.args[0])
        );
    }

    if (row.member === 'getScaledImageUrl') {
        const [target, optionSets] = resolved as [unknown, unknown[]];
        return (
            valueMatches(target, observation.args[0]) &&
            optionSets.some((options) =>
                valueMatches(options, observation.args[1])
            )
        );
    }

    return valueMatches(resolved, observation.args);
}

export interface LedgerRunResult {
    /** Observations that matched no row at all. Non-empty is a contract breach. */
    unknown: Observation[];
    /** Observations that matched more than one row. Non-empty means the ledger is ambiguous. */
    ambiguous: { observation: Observation; rows: string[] }[];
    /** Row id -> how many observations matched it. */
    hits: Record<string, number>;
    /** Rows the ledger declares for this phase set that nothing exercised. */
    unexercised: string[];
    /** Rows whose observed count differs from the frozen cardinality. */
    multiplicity: { row: string; expected: number; observed: number }[];
}

/**
 * Compare an observed run against the rows the ledger declares for it — both directions at once.
 *
 * `phases` scopes the comparison: a render-phase run must not be judged against action rows that
 * only a click can reach, and vice versa.
 */
export function compareLedgerRuns(
    cls: LedgerClass,
    observations: Observation[],
    phases: string[]
): LedgerRunResult {
    const rows = cls.requests.filter((row) => phases.includes(row.phase));
    const hits: Record<string, number> = Object.fromEntries(
        rows.map((row) => [row.id, 0])
    );
    const unknown: Observation[] = [];
    const ambiguous: { observation: Observation; rows: string[] }[] = [];

    for (const observation of observations) {
        const matched = rows.filter((row) =>
            requestMatches(row, observation, cls.identity)
        );
        if (matched.length === 0) {
            unknown.push(observation);
            continue;
        }
        if (matched.length > 1) {
            ambiguous.push({ observation, rows: matched.map((row) => row.id) });
        }
        hits[matched[0].id] += 1;
    }

    const unexercised = rows
        .filter((row) => hits[row.id] === 0)
        .map((row) => row.id);
    const multiplicity = rows
        .filter(
            (row) =>
                typeof row.cardinality === 'number' &&
                hits[row.id] !== row.cardinality
        )
        .map((row) => ({
            row: row.id,
            expected: row.cardinality as number,
            observed: hits[row.id]
        }));

    return { unknown, ambiguous, hits, unexercised, multiplicity };
}

/** A readable failure message. The class and the trigger are always in it. */
export function describeBreach(
    cls: LedgerClass,
    trigger: string,
    result: LedgerRunResult
): string {
    const lines: string[] = [
        `[item-details ledger] class "${cls.id}", trigger "${trigger}"`
    ];
    for (const observation of result.unknown) {
        lines.push(
            `  UNKNOWN ${observation.surface}.${observation.member}(${JSON.stringify(observation.args)}) ` +
                '— no ledger row accepts this call. Add it to ' +
                'tests/fixtures/item-details/migrated-request-action-ledger.json first.'
        );
    }
    for (const entry of result.ambiguous) {
        lines.push(
            `  AMBIGUOUS ${entry.observation.surface}.${entry.observation.member} matches ${entry.rows.join(', ')}`
        );
    }
    for (const row of result.unexercised) {
        lines.push(
            `  ORPHANED ledger row "${row}" — declared but never issued.`
        );
    }
    for (const entry of result.multiplicity) {
        lines.push(
            `  MULTIPLICITY row "${entry.row}" expected ${entry.expected}, observed ${entry.observed}.`
        );
    }
    return lines.join('\n');
}

/**
 * Every node a viewer can act on.
 *
 * Deliberately NOT `[data-detail-action]`: that attribute is on the action bar and nowhere else, so
 * an affordance sweep built on it would be vacuously complete. This is the whole interactive
 * surface of the mounted tree — cards, metadata links, parent links, external links, the overview
 * toggle and whatever the delegated recording widget draws.
 */
export const INTERACTIVE_SELECTOR = [
    'button',
    'a[href]',
    'select',
    'input',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="menuitem"]',
    'summary',
    '[tabindex]:not([tabindex="-1"])'
].join(', ');

export type AffordanceVerdict =
    | { kind: 'ACTION'; id: string }
    | { kind: 'LOCAL_ONLY'; id: string; reason: string }
    | { kind: 'DISABLED'; id: string; reason: string }
    | { kind: 'DELEGATED'; id: string; reason: string }
    | { kind: 'NAVIGATION'; id: string }
    | { kind: 'UNCLASSIFIED'; description: string };

const describeNode = (node: Element): string => {
    const section =
        node
            .closest('[data-detail-section]')
            ?.getAttribute('data-detail-section') ?? '(none)';
    const name =
        node.getAttribute('aria-label') ??
        node.getAttribute('title') ??
        (node.textContent ?? '').trim();
    return `<${node.tagName.toLowerCase()}> in section "${section}" named "${name.slice(0, 60)}"`;
};

/**
 * Classify one interactive node against the ledger.
 *
 * The identifier is COMPUTED from what the node already carries — its enclosing section, its
 * `data-detail-*` attribute where it has one, its role. Nothing here needs a new attribute in
 * production, which matters: adding one to make the audit pass would be the production change P7
 * is forbidden to make.
 */
export function classifyAffordance(
    node: Element,
    cls: LedgerClass
): AffordanceVerdict {
    const section =
        node
            .closest('[data-detail-section]')
            ?.getAttribute('data-detail-section') ?? null;

    const actionName = node
        .closest('[data-detail-action]')
        ?.getAttribute('data-detail-action');
    if (actionName) {
        const action = cls.actions.find((entry) => entry.id === actionName);
        if (action) return { kind: 'ACTION', id: action.id };
        return {
            kind: 'UNCLASSIFIED',
            description: `${describeNode(node)} carries data-detail-action="${actionName}", which the ledger does not declare for class "${cls.id}"`
        };
    }

    const selectName = node.getAttribute('data-detail-select');
    if (selectName) {
        const disabled = cls.disabledControls.find(
            (entry) => entry.id === selectName
        );
        if (disabled && (node as HTMLSelectElement).disabled) {
            return {
                kind: 'DISABLED',
                id: disabled.id,
                reason: disabled.reason
            };
        }
        const local = cls.localOnly.find((entry) => entry.id === selectName);
        if (local)
            return { kind: 'LOCAL_ONLY', id: local.id, reason: local.reason };
        return {
            kind: 'UNCLASSIFIED',
            description: `${describeNode(node)} is a track selector the ledger does not declare`
        };
    }

    if (
        section &&
        cls.delegatedControls.some((entry) => entry.control.section === section)
    ) {
        const delegated = cls.delegatedControls.find(
            (entry) => entry.control.section === section
        )!;
        return {
            kind: 'DELEGATED',
            id: delegated.id,
            reason: delegated.reason
        };
    }

    if (node.tagName === 'A' && node.getAttribute('href')) {
        const rule =
            cls.navigation.find((entry) => entry.section === section) ??
            cls.navigation.find((entry) => entry.id === 'cards.itemLinks');
        if (rule) return { kind: 'NAVIGATION', id: rule.id };
    }

    const local = cls.localOnly.find(
        (entry) =>
            entry.control.section === section &&
            entry.control.selector &&
            node.matches(entry.control.selector)
    );
    if (local)
        return { kind: 'LOCAL_ONLY', id: local.id, reason: local.reason };

    return { kind: 'UNCLASSIFIED', description: describeNode(node) };
}
