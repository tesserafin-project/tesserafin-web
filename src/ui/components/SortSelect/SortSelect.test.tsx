// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SortSelect, type SortSelectOption } from './SortSelect';

const OPTIONS: SortSelectOption[] = [
    { value: 'name', label: 'Name' },
    { value: 'year', label: 'Release year' },
    { value: 'rating', label: 'Rating' }
];

let container: HTMLDivElement;
let root: Root;

const setSelectValue = (select: HTMLSelectElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value'
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
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

describe('SortSelect', () => {
    it('renders the label, options and slot attribute', () => {
        act(() => {
            root.render(
                <SortSelect
                    label='Sort by'
                    options={OPTIONS}
                    value='name'
                    onChange={() => undefined}
                />
            );
        });

        const wrapper = container.querySelector('[data-rf-slot="sort-select"]');
        expect(wrapper).not.toBeNull();
        expect(container.textContent).toContain('Sort by');

        const select = container.querySelector('select') as HTMLSelectElement;
        expect(select.options).toHaveLength(3);
        expect(select.options[1]?.textContent).toBe('Release year');
    });

    it('wires the label to the select via htmlFor/id', () => {
        act(() => {
            root.render(
                <SortSelect
                    label='Sort by'
                    options={OPTIONS}
                    value='name'
                    onChange={() => undefined}
                    id='library-sort'
                />
            );
        });

        const label = container.querySelector('label') as HTMLLabelElement;
        const select = container.querySelector('select') as HTMLSelectElement;
        expect(label.getAttribute('for')).toBe('library-sort');
        expect(select.id).toBe('library-sort');
    });

    it('reflects the controlled value', () => {
        act(() => {
            root.render(
                <SortSelect
                    label='Sort by'
                    options={OPTIONS}
                    value='rating'
                    onChange={() => undefined}
                />
            );
        });

        const select = container.querySelector('select') as HTMLSelectElement;
        expect(select.value).toBe('rating');
    });

    it('fires onChange with the selected value', () => {
        const onChange = vi.fn();
        act(() => {
            root.render(
                <SortSelect
                    label='Sort by'
                    options={OPTIONS}
                    value='name'
                    onChange={onChange}
                />
            );
        });

        const select = container.querySelector('select') as HTMLSelectElement;
        act(() => {
            setSelectValue(select, 'year');
        });

        expect(onChange).toHaveBeenCalledWith('year');
    });

    it('disables the control when disabled is set', () => {
        act(() => {
            root.render(
                <SortSelect
                    label='Sort by'
                    options={OPTIONS}
                    value='name'
                    onChange={() => undefined}
                    disabled
                />
            );
        });

        const select = container.querySelector('select') as HTMLSelectElement;
        expect(select.disabled).toBe(true);
    });
});
