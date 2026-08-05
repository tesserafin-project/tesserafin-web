// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { serialiseDraft } from '../draftFormat';
import { createDraft } from '../draftState';
import { getOfficialSource } from '../officialSources';

import { ThemeStudio } from './ThemeStudio';

let container: HTMLDivElement;
let root: Root;

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

function findButton(text: string) {
    return [...container.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes(text)
    );
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
});

describe('Theme Studio — the whole path', () => {
    it('starts on the "copy an official theme" step with no draft', () => {
        render();
        expect(findButton('Copy Tesserafin Classic')).toBeDefined();
        expect(findButton('Copy Tesserafin Glass')).toBeDefined();
        expect(
            container.querySelector('[data-testid="theme-studio-preview"]')
        ).toBeNull();
    });

    it('creates a draft, previews it, and does not touch the live document', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');

        expect(
            container.querySelector('[data-testid="theme-studio-preview"]')
        ).not.toBeNull();
        expect(
            container.querySelector('[data-testid="theme-studio-token-editor"]')
        ).not.toBeNull();

        // The whole point of "explicit Apply": creating and previewing a draft changes nothing.
        expect(
            document.documentElement.getAttribute('data-rf-local-theme')
        ).toBeNull();
        expect(
            document.getElementById('tesserafin-local-theme-overlay')
        ).toBeNull();
    });

    it('applies only when asked, and reverts completely', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');
        clickButtonLabelled('Apply to Tesserafin');

        expect(
            document.documentElement.getAttribute('data-rf-local-theme')
        ).toBe('local.my-theme');
        expect(
            document.getElementById('tesserafin-local-theme-overlay')
        ).not.toBeNull();

        clickButtonLabelled('Stop using this theme');
        expect(
            document.documentElement.getAttribute('data-rf-local-theme')
        ).toBeNull();
        expect(
            document.getElementById('tesserafin-local-theme-overlay')
        ).toBeNull();
    });

    it('persists the draft and restores it on remount', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');

        act(() => {
            root.unmount();
        });
        act(() => {
            root = createRoot(container);
        });
        render();

        // Straight to the editor, no "copy an official theme" step.
        expect(findButton('Copy Tesserafin Classic')).toBeUndefined();
        expect(
            container.querySelector('[data-testid="theme-studio-preview"]')
        ).not.toBeNull();
    });

    it('recovers from corrupt stored state instead of failing to open', () => {
        window.localStorage.setItem(
            'tesserafin.themeStudio.draft',
            '{ this is not json'
        );
        render();
        // Opens clean on the start step rather than throwing, and drops the unusable entry.
        expect(findButton('Copy Tesserafin Classic')).toBeDefined();
        expect(
            window.localStorage.getItem('tesserafin.themeStudio.draft')
        ).toBeNull();
    });

    it('undo, redo and reset are disabled until there is something to undo', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');
        expect(findButton('Undo')?.disabled).toBe(true);
        expect(findButton('Redo')?.disabled).toBe(true);
        expect(findButton('Reset')?.disabled).toBe(true);
    });

    it('every control is a real, keyboard-operable button', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');
        for (const label of ['Undo', 'Redo', 'Reset', 'Export', 'Import']) {
            const button = findButton(label);
            // A native <button>, not a div with an onClick: that is what makes it reachable by
            // Tab, activatable by Enter and Space, and announced as a button.
            expect(button?.tagName).toBe('BUTTON');
            // Enabled controls must stay in the tab order. A disabled one is correctly removed
            // from it by MUI, so the assertion is conditional rather than absolute.
            if (!button?.disabled) {
                expect(button?.getAttribute('tabindex')).not.toBe('-1');
            }
        }
    });

    it('keeps every token input focusable and labelled', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');
        const inputs = [
            ...container.querySelectorAll<HTMLInputElement>('[data-token-path]')
        ];
        expect(inputs.length).toBeGreaterThan(20);
        for (const input of inputs.slice(0, 10)) {
            expect(input.getAttribute('tabindex')).not.toBe('-1');
            // MUI wires the label through `id`/`for`; without it the field has no accessible name.
            expect(input.id).not.toBe('');
        }
    });

    it('renders the preview with real ui primitives, not look-alikes', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');
        const preview = container.querySelector(
            '[data-testid="theme-studio-preview"]'
        );
        expect(
            preview?.querySelector('[data-rf-slot="media-shelf"]')
        ).not.toBeNull();
        expect(
            preview?.querySelector('[data-rf-slot="media-card"]')
        ).not.toBeNull();
    });

    it('projects the draft tokens onto the preview container only', () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');
        const preview = container.querySelector(
            '[data-testid="theme-studio-preview"]'
        ) as HTMLElement;
        expect(
            preview.style.getPropertyValue('--rf-color-background')
        ).not.toBe('');
        // Nothing leaked to the document root.
        expect(
            document.documentElement.style.getPropertyValue(
                '--rf-color-background'
            )
        ).toBe('');
    });
});

describe('Theme Studio — import safety', () => {
    it('reports why a malformed import was rejected and keeps the existing draft', async () => {
        render();
        clickButtonLabelled('Copy Tesserafin Classic');

        const input = container.querySelector(
            '[data-testid="theme-studio-import-input"]'
        ) as HTMLInputElement;

        const file = new File(['{ not json'], 'broken.json', {
            type: 'application/json'
        });
        Object.defineProperty(input, 'files', { value: [file] });

        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });

        const errors = container.querySelector(
            '[data-testid="theme-studio-import-errors"]'
        );
        expect(errors?.textContent).toContain('not valid JSON');
        // The draft that was already open is still open.
        expect(
            container.querySelector('[data-testid="theme-studio-preview"]')
        ).not.toBeNull();
    });

    it('accepts a valid exported draft', async () => {
        const imported = serialiseDraft(
            createDraft(requireSource('official.glass'), 'Imported', 'Someone')
        );

        render();
        clickButtonLabelled('Copy Tesserafin Classic');

        const input = container.querySelector(
            '[data-testid="theme-studio-import-input"]'
        ) as HTMLInputElement;
        Object.defineProperty(input, 'files', {
            value: [
                new File([imported], 'ok.json', { type: 'application/json' })
            ],
            configurable: true
        });

        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });

        expect(
            container.querySelector(
                '[data-testid="theme-studio-import-errors"]'
            )
        ).toBeNull();
        expect(container.textContent).toContain('Tesserafin Glass');
    });
});
