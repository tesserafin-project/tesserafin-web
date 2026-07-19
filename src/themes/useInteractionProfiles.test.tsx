// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROFILE_THEME_ID } from './applyProfiles';
import { useInteractionProfiles } from './useInteractionProfiles';

/**
 * Coverage for the **theme guard** and the hook's subscribe → project → teardown composition.
 *
 * This is the one assertion that "profiles apply to Glass only, never to Classic" actually rests
 * on. It is easy to write a test that appears to prove it and does not: asserting that Classic is
 * unchanged *while never running the hook* is trivially true and would still pass with the guard
 * deleted. So both directions are exercised here against the same signal — Classic must not
 * project, Glass must — which is what makes the negative case meaningful.
 *
 * `tests/e2e/glass-interaction-profiles.spec.ts` proves what the projected properties do to a real
 * browser's computed styles; this file proves *when* the projection is allowed to happen at all.
 */

const REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)';

let container: HTMLDivElement;
let root: Root;

/** Renders a component whose only job is to run the hook under test. */
const renderWithTheme = (themeId: string) => {
    const Probe = () => {
        useInteractionProfiles(themeId);
        return null;
    };
    act(() => {
        root.render(<Probe />);
    });
};

/** Everything the hook is supposed to have (or not have) put on `<html>`. */
const readRoot = () => {
    const html = document.documentElement;
    return {
        profile: html.getAttribute('data-rf-profile'),
        reducedMotion: html.getAttribute('data-rf-reduced-motion'),
        surface: html.style.getPropertyValue('--rf-color-surface'),
        blurMd: html.style.getPropertyValue('--rf-blur-md'),
        backdropFilterMd: html.style.getPropertyValue(
            '--rf-backdrop-filter-md'
        ),
        inlineStyle: html.style.cssText
    };
};

beforeEach(() => {
    // A matchMedia in which the reduced-transparency signal is ON, so a hook that projects at all
    // will visibly project. Faking the signal *input* is the only way to make a headless run
    // report an OS accessibility preference; nothing about the projection is faked.
    vi.stubGlobal(
        'matchMedia',
        vi.fn((media: string) => ({
            matches: media === REDUCED_TRANSPARENCY_QUERY,
            media,
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        }))
    );

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.removeAttribute('data-rf-profile');
    document.documentElement.removeAttribute('data-rf-reduced-motion');
    document.documentElement.style.cssText = '';
});

describe('useInteractionProfiles', () => {
    it('projects nothing under Reefin Classic, with the signal active', () => {
        const before = readRoot();

        renderWithTheme('official.classic');

        // The guard is the only thing stopping this: the same signal, on Glass, projects (next
        // test), and the partials are not no-ops against Classic — `reducedTransparency` would
        // repaint its `#202020` surface to `#141a22`.
        expect(readRoot()).toEqual(before);
        expect(readRoot().profile).toBeNull();
        expect(readRoot().inlineStyle).toBe('');
    });

    it('projects under Reefin Glass, and restores exactly on unmount', () => {
        const before = readRoot();

        renderWithTheme(PROFILE_THEME_ID);

        const during = readRoot();
        expect(during.profile).toBe('reduced-transparency');
        expect(during.surface).toBe('#141a22');
        expect(during.blurMd).toBe('0');
        // The derived property — the half that used to stay stale — is re-derived, and to `none`
        // rather than `blur(0)`.
        expect(during.backdropFilterMd).toBe('none');

        act(() => root.unmount());

        expect(readRoot()).toEqual(before);
    });

    it('tears down when the active theme moves away from Glass', () => {
        const before = readRoot();

        renderWithTheme(PROFILE_THEME_ID);
        expect(readRoot().profile).toBe('reduced-transparency');

        // Switching themes must unwind the projection, not leave Glass's overrides on `<html>`
        // for Classic to inherit.
        renderWithTheme('official.classic');

        expect(readRoot()).toEqual(before);
    });

    it('re-projects when the active theme moves back to Glass', () => {
        renderWithTheme(PROFILE_THEME_ID);
        const first = readRoot();

        renderWithTheme('official.classic');
        renderWithTheme(PROFILE_THEME_ID);

        expect(readRoot()).toEqual(first);
    });
});
