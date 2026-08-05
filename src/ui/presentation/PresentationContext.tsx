import React, {
    createContext,
    useContext,
    useMemo,
    useSyncExternalStore,
    type FC,
    type ReactNode
} from 'react';

/*
 * Imported from the specific modules rather than from `themes/platform`'s barrel. The barrel also
 * re-exports `validateManifest`, which imports `theme.schema.json` and the schema validator — real
 * dependencies of the Theme Studio's lazy chunk, and ~24 KB the MAIN bundle has no use for. A
 * barrel import here would have dragged all of it in for two functions.
 */
import {
    loadAppliedPresentation,
    subscribeAppliedPresentation
} from 'themes/platform/localPresentation';
import { getManifestForThemeId } from 'themes/platform/manifests';
import {
    PLATFORM_DEFAULT_PRESENTATION,
    resolvePresentation,
    type CapabilityFallback,
    type ResolvedPresentation
} from 'themes/platform/resolvePresentation';

/**
 * Makes the active theme's resolved presentation available to `src/ui` primitives (RFC-0007 §4.6).
 *
 * ## Why the default is the platform default, not "undefined"
 *
 * Every primitive must render correctly with no provider above it — a unit test, a Storybook-style
 * harness, or a legacy view mounted outside the modern tree. Defaulting to
 * {@link PLATFORM_DEFAULT_PRESENTATION} means "no provider" and "a theme that declares nothing"
 * produce the same, complete presentation, so a primitive never has to branch on whether it is
 * inside the app.
 *
 * ## Why the primitives read a context rather than the theme id
 *
 * A component that looked up the active theme and branched on it would be exactly the coupling
 * RFC-0007 §4.6 forbids: presentation would be decided per component, by name, and a new theme
 * would mean editing every component. Reading a resolved value means the components know the
 * *vocabulary* and never the *themes*.
 */
export interface PresentationContextValue {
    presentation: ResolvedPresentation;
    /** Capabilities the theme used that this renderer does not implement. Empty in the normal case. */
    fallbacks: readonly CapabilityFallback[];
    /** `false` when the active theme requires a capability the renderer lacks; it must not be applied. */
    activatable: boolean;
}

const DEFAULT_VALUE: PresentationContextValue = {
    presentation: PLATFORM_DEFAULT_PRESENTATION,
    fallbacks: [],
    activatable: true
};

const PresentationContext =
    createContext<PresentationContextValue>(DEFAULT_VALUE);

export interface PresentationProviderProps {
    /** Registry theme id, e.g. `official.classic`. A theme with no manifest yields the default. */
    themeId?: string;
    /** Escape hatch for previews and tests that resolve a presentation themselves. */
    value?: PresentationContextValue;
    children?: ReactNode;
}

export const PresentationProvider: FC<PresentationProviderProps> = ({
    themeId,
    value,
    children
}) => {
    /*
     * Subscribed, not read once. Apply is imperative — it mutates `document.head` and
     * `localStorage`, and it deliberately leaves the user's saved theme preference alone, so
     * `themeId` does not change either. Reading at mount would mean the tokens changed instantly
     * and the presentation only on the next full page load, which is the preview-only state this
     * binding exists to remove.
     *
     * `getServerSnapshot` returns `null` because there is no applied draft during SSR/prerender:
     * it is a purely local, per-browser choice.
     */
    const localPresentation = useSyncExternalStore(
        subscribeAppliedPresentation,
        loadAppliedPresentation,
        () => null
    );

    const resolved = useMemo<PresentationContextValue>(() => {
        if (value) return value;

        // A locally applied Theme Studio draft wins over the official theme's manifest, because
        // that is what "Apply" means. It is a presentation-only record rather than the whole draft
        // (see `themes/platform/localPresentation.ts`), so reading it here costs no bundle.
        const manifest = themeId ? getManifestForThemeId(themeId) : undefined;

        if (localPresentation) {
            const resolution = resolvePresentation({
                presentation: localPresentation,
                capabilities: manifest?.capabilities
            });
            return {
                presentation: resolution.presentation,
                fallbacks: resolution.fallbacks,
                activatable: resolution.activatable
            };
        }

        if (!manifest) return DEFAULT_VALUE;

        const resolution = resolvePresentation(manifest);
        // A theme requiring a capability this renderer lacks must not be half-applied: fall all the
        // way back to the platform default rather than render a presentation nobody designed.
        // `resolvePresentation` reports it; honouring the report is this provider's job.
        if (!resolution.activatable) {
            return { ...DEFAULT_VALUE, activatable: false };
        }
        return {
            presentation: resolution.presentation,
            fallbacks: resolution.fallbacks,
            activatable: true
        };
    }, [themeId, value, localPresentation]);

    return (
        <PresentationContext.Provider value={resolved}>
            {children}
        </PresentationContext.Provider>
    );
};

/** The full context value, including fallback reporting. */
export const usePresentationContext = (): PresentationContextValue =>
    useContext(PresentationContext);

/** Just the resolved presentation — what a primitive almost always wants. */
export const usePresentation = (): ResolvedPresentation =>
    useContext(PresentationContext).presentation;

export default PresentationProvider;
