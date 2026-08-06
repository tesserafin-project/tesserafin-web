// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAppliedPresentation } from 'themes/platform/localPresentation';
import { resolvePresentation } from 'themes/platform/resolvePresentation';

import { serialiseDraft, parseDraft } from '../draftFormat';
import { createDraft } from '../draftState';
import { getOfficialSource } from '../officialSources';

import { ThemeStudio } from './ThemeStudio';

/**
 * The Home composition control, asserted as a REAL control.
 *
 * The requirement it exists to satisfy is negative and easy to fake: "there must be no control that
 * appears functional but only changes PreviewCanvas". So the assertions here deliberately reach
 * past the preview — they check the record the LIVE renderer reads
 * (`themes/platform/localPresentation`), the exported document, and the same resolver the app uses.
 * A control that only moved the preview would pass none of them.
 */

let container: HTMLDivElement;
let root: Root;

const APPLIED_KEY = 'tesserafin.themeStudio.appliedPresentation';

function requireSource(id: string) {
    const source = getOfficialSource(id);
    if (!source) throw new Error(`${id} must be a startable source`);
    return source;
}

function render() {
    act(() => {
        root.render(<ThemeStudio />);
    });
}

function clickButtonLabelled(text: string) {
    const button = [...container.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes(text)
    );
    if (!button) throw new Error(`No button labelled "${text}"`);
    act(() => {
        button.click();
    });
    return button;
}

/** The Home composition editor's per-section rows, in the order it lists them. */
function sectionRows() {
    return [
        ...container.querySelectorAll(
            '[data-testid="theme-studio-home-composition"] li'
        )
    ];
}

/** The section name a row is for, without the Move up/Move down button labels around it. */
function rowLabel(row: Element): string {
    return (
        row.querySelector('.MuiFormControlLabel-label')?.textContent ?? ''
    ).trim();
}

function rowLabelled(text: string) {
    const row = sectionRows().find((candidate) =>
        rowLabel(candidate).startsWith(text)
    );
    if (!row) throw new Error(`No composition row for "${text}"`);
    return row;
}

/** Include or exclude a section — the checkbox, never a button whose label contains the name. */
function toggleSection(text: string) {
    const checkbox = rowLabelled(text).querySelector(
        'input[type="checkbox"]'
    ) as HTMLInputElement;
    act(() => {
        checkbox.click();
    });
}

function clickInRow(text: string, buttonText: string) {
    const button = [...rowLabelled(text).querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.includes(buttonText)
    );
    if (!button) throw new Error(`No "${buttonText}" in the "${text}" row`);
    act(() => {
        button.click();
    });
}

/** The order the control currently shows for the SELECTED sections. */
function selectedOrder(): string[] {
    return sectionRows()
        .filter((row) => row.querySelector('input:checked'))
        .map((row) => rowLabel(row).split('—')[0].trim());
}

beforeEach(() => {
    window.localStorage.clear();
    document.getElementById('tesserafin-local-theme-overlay')?.remove();
    document.documentElement.removeAttribute('data-rf-local-theme');
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
    window.localStorage.clear();
});

describe('Theme Studio — the Home composition control is real', () => {
    it('offers the control enabled, because the renderer implements the capability', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');

        const editor = container.querySelector(
            '[data-testid="theme-studio-home-composition"]'
        );
        expect(editor).not.toBeNull();
        expect(
            [...(editor?.querySelectorAll('input') ?? [])].every(
                (input) => !input.disabled || input.checked
            )
        ).toBe(true);
    });

    it('starts from the theme it copied, not from an invented default', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Glass');
        // Glass declares hero-first with libraries last; the control must show that, not Classic's.
        expect(selectedOrder()[0]).toBe('Hero');
        expect(selectedOrder().at(-1)).toBe('My media');
    });

    it('reorders the recipe, and the order it shows is the order it stored', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');
        expect(selectedOrder()).toEqual([
            'My media',
            'Continue watching',
            'Next up',
            'Latest from each library'
        ]);

        clickInRow('Next up', 'Move Next up up');
        expect(selectedOrder()).toEqual([
            'My media',
            'Next up',
            'Continue watching',
            'Latest from each library'
        ]);
    });

    it('writes the edited composition where the LIVE renderer reads it, on Apply and only on Apply', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');
        toggleSection('Hero');

        // Nothing applied yet: editing must not touch the live record.
        expect(window.localStorage.getItem(APPLIED_KEY)).toBeNull();

        clickButtonLabelled('Apply to Tesserafin');

        const applied = loadAppliedPresentation();
        expect(applied?.page?.home?.sections).toContain('hero');
        // And the live renderer resolves it — the same call `PresentationProvider` makes.
        const resolved = resolvePresentation({ presentation: applied ?? {} });
        expect(resolved.presentation.page.home.sections).toContain('hero');
        expect(resolved.fallbacks).toEqual([]);
    });

    it('clears the composition again on reset, so tokens and composition cannot disagree', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');
        clickButtonLabelled('Apply to Tesserafin');
        expect(window.localStorage.getItem(APPLIED_KEY)).not.toBeNull();

        clickButtonLabelled('Stop using this theme');
        expect(loadAppliedPresentation()).toBeNull();
    });

    it('refuses to empty the recipe, because the schema requires at least one section', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');

        toggleSection('My media');
        toggleSection('Continue watching');
        toggleSection('Next up');
        expect(selectedOrder()).toEqual(['Latest from each library']);

        const lastCheckbox = rowLabelled(
            'Latest from each library'
        ).querySelector('input') as HTMLInputElement;
        expect(lastCheckbox.disabled).toBe(true);
    });

    it('says which sections it declares but does not render, rather than hiding them', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');
        expect(rowLabelled('Recommendations').textContent).toContain(
            'not rendered by this renderer'
        );
    });
});

describe('Theme Studio — composition survives export and import', () => {
    it('round-trips the Home recipe through the exported document', async () => {
        render();
        clickButtonLabelled('Copy Tesserafin Glass');
        clickInRow('My media', 'Move My media up');

        // Exporting and re-parsing is the same path the export button and the file input use.
        const source = requireSource('official.glass');
        const draft = createDraft(source, 'Round trip', 'Someone');
        draft.manifest.presentation = {
            ...draft.manifest.presentation,
            page: {
                home: { sections: ['nextUp', 'hero'], shelfDensity: 'compact' }
            }
        };

        const parsed = parseDraft(serialiseDraft(draft));
        expect(parsed.valid).toBe(true);
        if (!parsed.valid) return;
        expect(parsed.draft.manifest.presentation?.page?.home).toEqual({
            sections: ['nextUp', 'hero'],
            shelfDensity: 'compact'
        });
    });
});

describe('Theme Studio — a required capability this renderer lacks', () => {
    /**
     * The other half of capability negotiation. An OPTIONAL unsupported capability falls back and
     * says so; a REQUIRED one must stop activation outright, with a message that names the
     * capability and says what to do — a disabled button with no explanation is not an actionable
     * error.
     */
    function startDraftRequiring(capability: string) {
        const draft = createDraft(
            requireSource('official.classic'),
            'Needs more',
            'Someone'
        );
        draft.manifest.capabilities = {
            required: [
                ...(draft.manifest.capabilities?.required ?? []),
                capability as 'presentation.page.itemDetails'
            ]
        };
        window.localStorage.setItem(
            'tesserafin.themeStudio.draft',
            serialiseDraft(draft)
        );
    }

    it('refuses to apply, and names the capability and the fix', () => {
        // A capability the Web renderer still does not implement. It was
        // `presentation.page.library` until that route read a recipe; using a bound capability
        // here would have made this test assert nothing.
        startDraftRequiring('presentation.page.itemDetails');
        render();

        const alert = container.querySelector(
            '[data-testid="theme-studio-required-unsupported"]'
        );
        expect(alert?.textContent).toContain('presentation.page.itemDetails');
        expect(alert?.textContent).toContain('capabilities.optional');

        const apply = [...container.querySelectorAll('button')].find((button) =>
            button.textContent?.includes('Apply to Tesserafin')
        ) as HTMLButtonElement;
        expect(apply.disabled).toBe(true);

        // And even if the button were reachable, nothing is written.
        expect(window.localStorage.getItem(APPLIED_KEY)).toBeNull();
        expect(
            document.documentElement.getAttribute('data-rf-local-theme')
        ).toBeNull();
    });

    it('applies normally when the same capability is optional instead', () => {
        const draft = createDraft(
            requireSource('official.classic'),
            'Optional only',
            'Someone'
        );
        draft.manifest.capabilities = {
            required: ['tokens.core'],
            optional: ['presentation.page.itemDetails']
        };
        window.localStorage.setItem(
            'tesserafin.themeStudio.draft',
            serialiseDraft(draft)
        );
        render();

        expect(
            container.querySelector(
                '[data-testid="theme-studio-required-unsupported"]'
            )
        ).toBeNull();
        clickButtonLabelled('Apply to Tesserafin');
        expect(
            document.documentElement.getAttribute('data-rf-local-theme')
        ).not.toBeNull();
    });
});
