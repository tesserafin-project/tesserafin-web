// @vitest-environment jsdom
/**
 * Automated accessibility scan of the Theme Studio (web#113).
 *
 * ## What this covers that the other tests do not
 *
 * `ThemeStudio.test.tsx` asserts the things a human thought to check: every control is a real
 * `<button>`, enabled controls stay in the tab order, token inputs are labelled. Those are narrow by
 * construction — they test the failures someone anticipated.
 *
 * axe checks the ones nobody did: landmark structure, heading order, ARIA attribute misuse,
 * name/role/value on MUI composites, duplicate ids, form-label association. It is a different kind
 * of coverage, not more of the same, which is why the manual assertions were not allowed to stand
 * in for it.
 *
 * ## What it cannot cover here, and where that is covered instead
 *
 * jsdom computes no layout and no used colour values, so axe's rules that need real rendering
 * cannot run and are disabled explicitly below rather than left to fail silently:
 *
 *   - `color-contrast` — covered for real by `tesserafin-design/__tests__/palette-contrast.test.ts`,
 *     which measures every shipped palette against WCAG 2.2 SC 1.4.3 and 1.4.11 with alpha
 *     composited. That gate is stronger than an axe pass would be, because it checks the tokens
 *     rather than one rendering of them.
 *   - `scrollable-region-focusable` — needs a scroll box, which jsdom never produces.
 *
 * Disabling a rule that CAN run here would be hiding a defect; disabling one that structurally
 * cannot is stating a limit. The distinction is the whole reason each exclusion is named.
 */
import axe, { type Result, type RunOptions } from 'axe-core';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeStudio } from './ThemeStudio';

let container: HTMLDivElement;
let root: Root;

/** Rules that structurally cannot run under jsdom. Each one names where it is covered instead. */
const RULES_JSDOM_CANNOT_RUN: RunOptions['rules'] = {
    // Covered by tesserafin-design/__tests__/palette-contrast.test.ts, on the tokens themselves.
    'color-contrast': { enabled: false },
    // Needs a real scroll box; jsdom reports every element as zero-sized.
    'scrollable-region-focusable': { enabled: false }
};

function describeViolations(violations: Result[]): string[] {
    return violations.map(
        (violation) =>
            `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes
                .map((node) => node.html)
                .slice(0, 3)
                .join(' | ')}`
    );
}

async function scan(): Promise<Result[]> {
    const results = await axe.run(container, {
        rules: RULES_JSDOM_CANNOT_RUN,
        // WCAG 2.0/2.1/2.2 A and AA. Not "best-practice", which mixes in opinions that are not
        // conformance requirements — a gate that fails on an opinion gets disabled, and then the
        // conformance failures stop being caught too.
        runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
        }
    });
    return results.violations;
}

function clickButtonLabelled(text: string) {
    const button = [...container.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes(text)
    );
    if (!button) throw new Error(`No button labelled "${text}"`);
    act(() => {
        button.click();
    });
}

beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
        root = createRoot(container);
    });
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    document.getElementById('tesserafin-local-theme-overlay')?.remove();
    document.documentElement.removeAttribute('data-rf-local-theme');
});

describe('Theme Studio — automated accessibility scan', () => {
    it('has no WCAG A/AA violation on the start step', async () => {
        act(() => {
            root.render(<ThemeStudio />);
        });
        expect(describeViolations(await scan())).toEqual([]);
    });

    /*
     * Longer than vitest's 5s default on purpose. This scan walks the whole editor — around fifty
     * token fields, the accordions, every select and switch, the preview — and axe in jsdom is
     * slow because jsdom is. Trimming the tree to fit the default would mean scanning less than the
     * user sees, which is the opposite of what this test is for.
     */
    it('has no WCAG A/AA violation with a draft open', {
        timeout: 30_000
    }, async () => {
        act(() => {
            root.render(<ThemeStudio />);
        });
        clickButtonLabelled('Copy Tesserafin Classic');
        // The editor is where the density is: ~50 token fields, accordions, selects, switches, the
        // preview, and the alerts. If anything in the Studio has an ARIA problem, it is here.
        expect(describeViolations(await scan())).toEqual([]);
    });

    it('has no WCAG A/AA violation while showing a validation error', {
        timeout: 30_000
    }, async () => {
        act(() => {
            root.render(<ThemeStudio />);
        });
        clickButtonLabelled('Copy Tesserafin Classic');

        const input = container.querySelector<HTMLInputElement>(
            '[data-token-path="spacing.md"]'
        );
        if (!input) throw new Error('spacing.md field not rendered');

        // An error state is its own accessibility surface — `aria-invalid`, the helper text's
        // association with the field, the alert's role. Scanning only the happy path would miss it.
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )?.set;
            setter?.call(input, '16');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });

        expect(
            container.querySelector('[data-testid="theme-studio-validation"]')
        ).not.toBeNull();
        expect(describeViolations(await scan())).toEqual([]);
    });

    it('detects a real violation, so a clean pass above means something', async () => {
        // The scan is only evidence if it can fail. An unlabelled button is an unambiguous WCAG
        // 4.1.2 failure, so a run that reports nothing here would mean the harness is not scanning.
        act(() => {
            root.render(
                <div>
                    <button type='button' />
                </div>
            );
        });
        const violations = await scan();
        expect(violations.map((violation) => violation.id)).toContain(
            'button-name'
        );
    });
});
