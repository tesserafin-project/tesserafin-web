// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Surface } from './Surface';

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

describe('Surface', () => {
    it('renders its children and the slot attribute', () => {
        act(() => {
            root.render(<Surface>Frosted content</Surface>);
        });

        const surface = container.querySelector('[data-rf-slot="surface"]');
        expect(surface).not.toBeNull();
        expect(surface?.textContent).toContain('Frosted content');
    });

    it('applies the glass modifier by default', () => {
        act(() => {
            root.render(<Surface>content</Surface>);
        });

        const surface = container.querySelector('[data-rf-slot="surface"]');
        expect(surface?.className).toContain('rf-surface--glass');
        expect(surface?.className).not.toContain('rf-surface--opaque');
    });

    it('applies the opaque modifier when variant="opaque"', () => {
        act(() => {
            root.render(<Surface variant='opaque'>content</Surface>);
        });

        const surface = container.querySelector('[data-rf-slot="surface"]');
        expect(surface?.className).toContain('rf-surface--opaque');
        expect(surface?.className).not.toContain('rf-surface--glass');
    });

    it('forwards className and standard div props', () => {
        act(() => {
            root.render(
                <Surface className='custom' id='panel'>
                    content
                </Surface>
            );
        });

        const surface = container.querySelector('[data-rf-slot="surface"]');
        expect(surface?.className).toContain('custom');
        expect(surface?.id).toBe('panel');
    });
});
