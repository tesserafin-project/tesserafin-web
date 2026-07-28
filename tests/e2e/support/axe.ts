import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * B2 (#55) — the accessibility engine.
 *
 * #55's gate says "an a11y check (axe or equivalent) reports no critical violations on onboarding,
 * library, and player". This module is how axe gets onto the page.
 *
 * WHY THE ENGINE IS VENDORED rather than installed: see `tests/e2e/vendor/README.md`. In short, it
 * is injected into an already-built page and never reaches a shipped bundle, and the release-pair
 * gate treats any lockfile change as a production build input — so declaring it would put a 559 KB
 * browser library into the graph every build installs and permanently disqualify this commit from
 * being validated against an image built before it.
 *
 * PINNED BY CONTENT, NOT BY TRUST. The file is hashed before every injection and refused unless it
 * matches {@link AXE_SHA256}. Substituting or editing the engine is a test failure, not something a
 * reviewer has to spot in a 559 KB minified diff.
 *
 * NO BLANKET EXCLUSIONS. {@link scanPage} takes no `exclude` argument and sets no
 * `rules: { …: { enabled: false } }`. Anything a caller wants to leave out has to be expressed as a
 * narrowed `include` selector at the call site, where it is visible and has to be justified in the
 * test's own text. That is deliberate: #55 forbids unexplained waivers, and an option that makes
 * them convenient is how they arrive.
 */

/**
 * Resolved from the repository root rather than from this module's own location: the suite is
 * transpiled to CommonJS, where `import.meta` does not exist, and `ci/verify-release-pair.sh`
 * always runs Playwright with the web checkout as the working directory.
 */
const AXE_PATH = resolve(process.cwd(), 'tests', 'e2e', 'vendor', 'axe.min.js');

/** axe-core 4.12.1, `package/axe.min.js` from the official npm tarball. */
export const AXE_SHA256 =
    '66a8aaa95a8b044a7fd74a5435873bf04ff65a1ca75567c921b7509742085a14';
export const AXE_VERSION = '4.12.1';

export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface AxeViolation {
    id: string;
    impact: AxeImpact | null;
    help: string;
    nodes: string[];
}

export interface AxeResult {
    /** The engine version axe itself reports, cross-checked against {@link AXE_VERSION}. */
    engineVersion: string;
    violations: AxeViolation[];
    /** Violation counts keyed by impact, including impacts with zero occurrences. */
    bySeverity: Record<AxeImpact, number>;
    /** Rules that ran and found nothing wrong — proof the scan was not a no-op. */
    passCount: number;
    /** Rules axe could not decide, reported rather than dropped. */
    incompleteCount: number;
}

let cachedSource: string | null = null;

/** Reads the vendored engine and refuses it unless the content hash is the pinned one. */
function axeSource(): string {
    if (cachedSource !== null) return cachedSource;
    const source = readFileSync(AXE_PATH, 'utf8');
    const actual = createHash('sha256')
        .update(readFileSync(AXE_PATH))
        .digest('hex');
    if (actual !== AXE_SHA256) {
        throw new Error(
            `tests/e2e/vendor/axe.min.js does not match its pinned SHA-256.\n` +
                `  expected ${AXE_SHA256}\n` +
                `  actual   ${actual}\n` +
                'The accessibility engine is pinned by content. If the update is intended, ' +
                'change AXE_SHA256 and tests/e2e/vendor/README.md in the same commit.'
        );
    }
    cachedSource = source;
    return source;
}

/**
 * Injects axe into the live page and scans it.
 *
 * @param include Optional CSS selectors to scan instead of the whole document. Omit it for a full
 *   page scan; pass one only when the test's own comment says why a narrower scope is the honest
 *   scope for that state.
 */
export async function scanPage(
    page: Page,
    include?: string[]
): Promise<AxeResult> {
    await page.addScriptTag({ content: axeSource() });

    const raw = await page.evaluate(async (includeSelectors) => {
        // biome-ignore lint/suspicious/noExplicitAny: axe attaches itself to window at runtime.
        const axe = (window as any).axe;
        if (!axe) {
            throw new Error(
                'axe did not attach to window — the engine was not injected'
            );
        }
        const context =
            includeSelectors && includeSelectors.length > 0
                ? { include: includeSelectors.map((s) => [s]) }
                : undefined;
        // `runOnly` restricts to the WCAG 2.0/2.1 A and AA rule sets plus axe's own
        // best-practice set. It is a scope statement, not an exclusion: every rule inside those
        // sets runs, and nothing is individually disabled.
        const options = {
            runOnly: {
                type: 'tag',
                values: [
                    'wcag2a',
                    'wcag2aa',
                    'wcag21a',
                    'wcag21aa',
                    'best-practice'
                ]
            },
            resultTypes: ['violations', 'incomplete']
        };
        const results = context
            ? await axe.run(context, options)
            : await axe.run(options);
        return {
            engineVersion: String(results.testEngine?.version ?? 'unknown'),
            passCount: Array.isArray(results.passes)
                ? results.passes.length
                : 0,
            incompleteCount: Array.isArray(results.incomplete)
                ? results.incomplete.length
                : 0,
            violations: (results.violations ?? []).map(
                // biome-ignore lint/suspicious/noExplicitAny: axe's own result shape.
                (v: any) => ({
                    id: String(v.id),
                    impact: v.impact ?? null,
                    help: String(v.help),
                    // `target` is a selector array; joining keeps the record readable and
                    // carries no user data, no token and no media path.
                    nodes: (v.nodes ?? [])
                        // biome-ignore lint/suspicious/noExplicitAny: axe's own node shape.
                        .map((n: any) => (n.target ?? []).join(' '))
                        .slice(0, 8)
                })
            )
        };
    }, include);

    const bySeverity: Record<AxeImpact, number> = {
        minor: 0,
        moderate: 0,
        serious: 0,
        critical: 0
    };
    for (const violation of raw.violations) {
        if (violation.impact && violation.impact in bySeverity) {
            bySeverity[violation.impact as AxeImpact] += 1;
        }
    }

    return { ...raw, bySeverity } as AxeResult;
}

/** A one-line-per-violation rendering, safe to paste into an issue comment. */
export function formatViolations(result: AxeResult): string {
    if (result.violations.length === 0) return 'none';
    return result.violations
        .map(
            (v) =>
                `${v.impact ?? 'unknown'} · ${v.id} · ${v.help} · ${v.nodes.length} node(s): ${v.nodes.join(', ')}`
        )
        .join('\n');
}
