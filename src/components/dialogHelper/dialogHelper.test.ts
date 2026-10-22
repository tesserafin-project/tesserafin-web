import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ tv: false, animated: false }));
const input = vi.hoisted(
    () => new Map<HTMLElement, (event: CustomEvent) => void>()
);
const focus = vi.hoisted(() =>
    vi.fn((element: HTMLElement) => element.focus())
);

vi.mock('../focusManager', () => ({
    default: {
        focus,
        pushScope: vi.fn(),
        popScope: vi.fn(),
        autoFocus: (dialog: HTMLElement) =>
            dialog.querySelector('button')?.focus()
    }
}));
vi.mock('../../scripts/browser', () => ({
    default: { supportsCssAnimation: () => state.animated }
}));
vi.mock('../layoutManager', () => ({ default: state }));
vi.mock('../../scripts/inputManager', () => ({
    default: {
        on: (dialog: HTMLElement, handler: (event: CustomEvent) => void) =>
            input.set(dialog, handler),
        off: (dialog: HTMLElement) => input.delete(dialog)
    }
}));
vi.mock('../loading/loading.ts', () => ({ hide: vi.fn() }));
vi.mock('../../utils/dom', () => ({
    default: {
        addEventListener: (
            element: HTMLElement,
            event: string,
            listener: EventListener,
            options?: AddEventListenerOptions
        ) => element.addEventListener(event, listener, options),
        removeEventListener: (
            element: HTMLElement,
            event: string,
            listener: EventListener
        ) => element.removeEventListener(event, listener),
        whichAnimationEvent: () => 'animationend'
    }
}));
vi.mock('RootAppRouter', () => ({ history: {} }));

import { close, createDialog, open } from './dialogHelper';

function button(parent = document.body) {
    const element = document.createElement('button');
    parent.append(element);
    return element;
}

function show() {
    const dialog = createDialog({ enableHistory: false, scrollY: false });
    const item = button(dialog);
    const closed = open(dialog);
    return { dialog, item, closed };
}

beforeEach(() => {
    document.body.replaceChildren();
    state.tv = false;
    state.animated = false;
    input.clear();
    focus.mockClear();
});

afterEach(() => {
    document.body.replaceChildren();
});

describe('legacy dialog focus return', () => {
    it.each([false, true])(
        'returns focus after keyboard Back on TV=%s',
        async (tv) => {
            state.tv = tv;
            const opener = button();
            opener.focus();
            const { dialog, item, closed } = show();
            expect(document.activeElement).toBe(item);

            const back = new CustomEvent('command', {
                detail: { command: 'back' },
                cancelable: true
            });
            input.get(dialog)?.(back);
            await closed;

            expect(back.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(opener);
            expect(dialog.isConnected).toBe(false);
        }
    );

    it('returns from a nested dialog to its opener in the parent before returning to the page', async () => {
        const opener = button();
        opener.focus();
        const parent = show();
        const nested = show();
        close(nested.dialog);
        await nested.closed;
        expect(document.activeElement).toBe(parent.item);
        close(parent.dialog);
        await parent.closed;
        expect(document.activeElement).toBe(opener);
    });

    it('does not try to focus an opener removed while the dialog was open', async () => {
        const opener = button();
        opener.focus();
        const { dialog, closed } = show();
        opener.remove();
        focus.mockClear();
        close(dialog);
        await closed;
        expect(focus).not.toHaveBeenCalled();
    });

    it('keeps an intentional new focus destination when closing a dialog', async () => {
        const opener = button();
        opener.focus();
        const { dialog, closed } = show();
        const destination = button();
        destination.focus();
        focus.mockClear();
        close(dialog);
        await closed;
        expect(document.activeElement).toBe(destination);
        expect(focus).not.toHaveBeenCalled();
    });

    it('does not move focus to an opener disabled while the dialog was open', async () => {
        const opener = button();
        opener.focus();
        const { dialog, closed } = show();
        opener.disabled = true;
        close(dialog);
        await closed;
        expect(document.activeElement).toBe(document.body);
    });

    it('waits for the close animation before restoring focus', async () => {
        state.animated = true;
        const opener = button();
        opener.focus();
        const { dialog, item, closed } = show();
        dialog.dispatchEvent(new Event('animationend'));
        expect(document.activeElement).toBe(item);
        close(dialog);
        expect(document.activeElement).toBe(item);
        dialog.dispatchEvent(new Event('animationend'));
        await closed;
        expect(document.activeElement).toBe(opener);
    });
});
