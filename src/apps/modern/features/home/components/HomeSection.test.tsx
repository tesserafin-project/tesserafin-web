// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HomeSection from './HomeSection';

vi.mock('lib/globalize', () => ({
    default: { translate: (key: string) => key }
}));

/**
 * POLISH-1 — an empty section can say what to do next. The case it exists for: a first run that
 * skipped the library step landed on "Nothing here." with no way forward.
 */

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

const renderEmpty = (
    props: Partial<React.ComponentProps<typeof HomeSection>>
) =>
    act(() => {
        root.render(
            <HomeSection
                title='My Media'
                isLoading={false}
                isError={false}
                onRetry={() => undefined}
                isEmpty
                emptyLabel='Nothing here.'
                {...props}
            />
        );
    });

describe('HomeSection, empty', () => {
    it('offers the action it was given and runs it', () => {
        const onEmptyAction = vi.fn();
        renderEmpty({ emptyActionLabel: 'Add Media Library', onEmptyAction });

        const button = container.querySelector('button');
        expect(button?.textContent).toBe('Add Media Library');
        act(() => button?.click());
        expect(onEmptyAction).toHaveBeenCalledTimes(1);
    });

    it('shows a description and no button when there is nothing the user can do', () => {
        renderEmpty({
            emptyDescription: 'Ask an administrator to create a library.',
            onEmptyAction: () => undefined
        });

        expect(container.textContent).toContain(
            'Ask an administrator to create a library.'
        );
        expect(container.querySelector('button')).toBeNull();
    });
});
