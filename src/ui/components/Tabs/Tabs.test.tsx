// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Tabs, type TabItem } from './Tabs';

const ITEMS: TabItem[] = [
    { id: 'tab-home', label: 'Home', panelId: 'panel-home' },
    { id: 'tab-favorites', label: 'Favorites', panelId: 'panel-favorites' }
];

let container: HTMLDivElement;
let root: Root;

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

describe('Tabs', () => {
    it('renders an accessible tablist with the expected roles and selection', () => {
        act(() => {
            root.render(
                <Tabs items={ITEMS} value={0} onChange={() => undefined} />
            );
        });

        const tablist = container.querySelector('[role="tablist"]');
        expect(tablist).not.toBeNull();
        expect(tablist?.getAttribute('data-rf-slot')).toBe('tabs');

        const tabs = container.querySelectorAll('[role="tab"]');
        expect(tabs).toHaveLength(2);
        expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
        expect(tabs[1]?.getAttribute('aria-selected')).toBe('false');
        expect(tabs[0]?.getAttribute('tabindex')).toBe('0');
        expect(tabs[1]?.getAttribute('tabindex')).toBe('-1');
    });

    it('activates a tab on click', () => {
        const onChange = vi.fn();
        act(() => {
            root.render(<Tabs items={ITEMS} value={0} onChange={onChange} />);
        });

        const secondTab = container.querySelectorAll(
            '[role="tab"]'
        )[1] as HTMLButtonElement;

        act(() => {
            secondTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(onChange).toHaveBeenCalledWith(1, ITEMS[1]);
    });

    it('moves focus with ArrowRight and activates with Enter (roving tabindex, manual activation)', () => {
        const onChange = vi.fn();
        act(() => {
            root.render(<Tabs items={ITEMS} value={0} onChange={onChange} />);
        });

        const [firstTab, secondTab] = Array.from(
            container.querySelectorAll('[role="tab"]')
        ) as HTMLButtonElement[];

        act(() => {
            firstTab.focus();
        });
        expect(document.activeElement).toBe(firstTab);

        act(() => {
            firstTab.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true
                })
            );
        });
        expect(document.activeElement).toBe(secondTab);
        expect(onChange).not.toHaveBeenCalled();

        act(() => {
            secondTab.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    bubbles: true
                })
            );
        });
        expect(onChange).toHaveBeenCalledWith(1, ITEMS[1]);
    });
});
