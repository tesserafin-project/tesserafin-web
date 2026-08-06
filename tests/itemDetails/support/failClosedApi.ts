/**
 * The fail-closed API pair, unchanged from the P5 harness it was written for.
 *
 * Moved out of `support/harness.ts` when the legacy controller was retired: the mechanism is what
 * makes the read inventory an ASSERTION rather than a description, and it judges the migrated route
 * exactly as it judged the legacy one. Touching a member the class did not declare throws.
 */

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
 * Property ACCESS on an undeclared member throws — not just invocation — because a caller
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

/** Narrow a responder menu to the members an equivalence class declares. */
export function pick<T extends Record<string, unknown>>(
    menu: T,
    allowed: readonly string[]
): Record<string, unknown> {
    const picked: Record<string, unknown> = {};
    for (const name of allowed) {
        if (!(name in menu)) {
            throw new Error(
                `[item-details characterization] "${name}" is declared in the read inventory but ` +
                    'has no responder. Add it to tests/itemDetails/support/responders.ts.'
            );
        }
        picked[name] = menu[name];
    }
    return picked;
}
