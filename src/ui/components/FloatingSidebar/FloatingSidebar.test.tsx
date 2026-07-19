// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FloatingSidebar, type FloatingSidebarItem } from './FloatingSidebar';

const ITEMS: FloatingSidebarItem[] = [
    { id: 'nav-home', label: 'Home' },
    { id: 'nav-library', label: 'Library' },
    { id: 'nav-settings', label: 'Settings' }
];

let container: HTMLDivElement;
let root: Root;

const buttons = (): HTMLButtonElement[] =>
    Array.from(
        container.querySelectorAll<HTMLButtonElement>(
            '[data-rf-slot="floating-sidebar-item"]'
        )
    );

/**
 * Dispatches a real `keydown` through the DOM so React's synthetic handler runs, rather than
 * invoking the handler directly — the roving tabindex is only correct if the event reaches the
 * focused button.
 *
 * `cancelable` matters: `preventDefault()` is a silent no-op on a non-cancelable event, so without
 * it `defaultPrevented` would read `false` for *every* key and the bubbling assertion below would
 * pass whether or not the component consumed anything.
 */
const pressKey = (element: HTMLElement, key: string) => {
    act(() => {
        element.dispatchEvent(
            new KeyboardEvent('keydown', {
                key,
                bubbles: true,
                cancelable: true
            })
        );
    });
};

const render = (props: Partial<Parameters<typeof FloatingSidebar>[0]> = {}) => {
    act(() => {
        root.render(
            <FloatingSidebar
                items={ITEMS}
                value={0}
                onChange={() => undefined}
                aria-label='Primary'
                {...props}
            />
        );
    });
};

beforeEach(() => {
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

describe('FloatingSidebar', () => {
    it('renders a labelled navigation landmark with one entry per item', () => {
        render();

        const nav = container.querySelector('nav[data-rf-slot="floating-sidebar"]');
        expect(nav).not.toBeNull();
        expect(nav?.getAttribute('aria-label')).toBe('Primary');
        expect(buttons()).toHaveLength(ITEMS.length);
    });

    it('marks the active entry with aria-current="page" and no other', () => {
        render({ value: 1 });

        const current = buttons().filter(
            (button) => button.getAttribute('aria-current') === 'page'
        );
        expect(current).toHaveLength(1);
        expect(current[0].id).toBe('nav-library');
    });

    it('keeps exactly one entry in the tab order (roving tabindex)', () => {
        render({ value: 2 });

        const focusable = buttons().filter(
            (button) => button.tabIndex === 0
        );
        expect(focusable).toHaveLength(1);
        expect(focusable[0].id).toBe('nav-settings');
    });

    it('moves focus with ArrowDown/ArrowUp without activating — the D-pad contract', () => {
        const onChange = vi.fn();
        render({ onChange });

        act(() => buttons()[0].focus());
        pressKey(buttons()[0], 'ArrowDown');

        expect(document.activeElement).toBe(buttons()[1]);
        // A directional pad press must never commit a navigation on its own.
        expect(onChange).not.toHaveBeenCalled();

        pressKey(buttons()[1], 'ArrowUp');
        expect(document.activeElement).toBe(buttons()[0]);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('wraps around at both ends', () => {
        render();

        act(() => buttons()[0].focus());
        pressKey(buttons()[0], 'ArrowUp');
        expect(document.activeElement).toBe(buttons()[2]);

        pressKey(buttons()[2], 'ArrowDown');
        expect(document.activeElement).toBe(buttons()[0]);
    });

    it('jumps to the ends with Home and End', () => {
        render();

        act(() => buttons()[0].focus());
        pressKey(buttons()[0], 'End');
        expect(document.activeElement).toBe(buttons()[2]);

        pressKey(buttons()[2], 'Home');
        expect(document.activeElement).toBe(buttons()[0]);
    });

    it('activates the focused entry with Enter and with Space', () => {
        const onChange = vi.fn();
        render({ onChange });

        act(() => buttons()[0].focus());
        pressKey(buttons()[0], 'ArrowDown');
        pressKey(buttons()[1], 'Enter');

        expect(onChange).toHaveBeenCalledWith(1, ITEMS[1]);

        pressKey(buttons()[1], ' ');
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('lets ArrowLeft and ArrowRight bubble so the D-pad can leave the rail', () => {
        render();

        const escaped: string[] = [];
        container.addEventListener('keydown', (event) => {
            if (!event.defaultPrevented) escaped.push(event.key);
        });

        act(() => buttons()[0].focus());
        pressKey(buttons()[0], 'ArrowRight');
        pressKey(buttons()[0], 'ArrowLeft');
        // Contrast: a handled key is consumed rather than escaping.
        pressKey(buttons()[0], 'ArrowDown');

        expect(escaped).toEqual(['ArrowRight', 'ArrowLeft']);
    });

    it('skips disabled entries when moving focus, and never activates them', () => {
        const onChange = vi.fn();
        render({
            items: [
                ITEMS[0],
                { ...ITEMS[1], disabled: true },
                ITEMS[2]
            ],
            onChange
        });

        act(() => buttons()[0].focus());
        pressKey(buttons()[0], 'ArrowDown');

        expect(document.activeElement).toBe(buttons()[2]);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps the label in the accessibility tree when collapsed', () => {
        render({ collapsed: true });

        const nav = container.querySelector('[data-rf-slot="floating-sidebar"]');
        expect(nav?.className).toContain('rf-floating-sidebar--collapsed');
        // Visually hidden by CSS, but still present as text — `display: none` would strip the
        // button's accessible name along with the visual label.
        expect(buttons()[0].textContent).toBe('Home');
    });

    it('renders an icon as decorative, leaving the label as the accessible name', () => {
        render({
            items: [{ id: 'nav-home', label: 'Home', icon: <svg /> }]
        });

        const icon = container.querySelector('.rf-floating-sidebar__icon');
        expect(icon?.getAttribute('aria-hidden')).toBe('true');
        expect(buttons()[0].textContent).toBe('Home');
    });

    it('carries no theme selector or theme name in its markup', () => {
        // The component must never branch on the active theme (RFC-0005 §6): its frosted treatment
        // arrives entirely through `--rf-*` tokens and the shared mixin.
        render();

        expect(container.innerHTML).not.toContain('official.');
        expect(container.innerHTML).not.toContain('data-rf-theme');
        expect(container.innerHTML).not.toContain('glass');
    });
});
