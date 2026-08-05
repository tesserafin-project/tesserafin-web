/**
 * Theme Platform v2 — TypeScript mirror of `tesserafin-design/schema/theme.schema.json`
 * (RFC-0007 §4/§5).
 *
 * Hand-written, like `src/ui/tokens/types.ts` is for `tokens.schema.json`, and for the same reason:
 * the schema is the published contract and this file is the in-app view of it, not a build output.
 * `contract.parity.test.ts` fails if the two drift on the parts a mismatch would actually break —
 * the capability enum and the presentation vocabularies.
 *
 * The split this file encodes is the whole point of v2:
 *
 *   - the UNIVERSAL layer (`ThemeManifest` minus `renderers`) is platform-neutral. It names
 *     semantic colour, type, spacing, shape, elevation, blur, density, motion, asset roles,
 *     component variants and page composition — concepts every renderer can honour;
 *   - the PLATFORM RENDERER layer (`renderers`) is where anything platform-specific lives. Adding
 *     the Android or Apple renderer adds a key there and changes nothing above it, which is what
 *     stops the universal contract from quietly becoming Web-only.
 */

import type { TesserafinTokens } from 'ui/tokens/types';

/** A deep-partial of the token set — the shape of every `profiles.<name>` override. */
export type ThemeTokensPartial = {
    [K in keyof TesserafinTokens]?: NonNullable<
        TesserafinTokens[K]
    > extends object
        ? { [P in keyof TesserafinTokens[K]]?: unknown }
        : TesserafinTokens[K];
};

/**
 * The closed capability vocabulary (RFC-0007 §5.2).
 *
 * Closed, not open, on purpose: a theme that could claim an undefined capability would be asking
 * a renderer to guarantee something nobody has specified. An unknown name is a validation error.
 */
export const THEME_CAPABILITIES = [
    'tokens.core',
    'tokens.profiles',
    'assets.roles',
    'presentation.surface',
    'presentation.mediaCard',
    'presentation.navigation',
    'presentation.page.home',
    'presentation.page.library',
    'presentation.page.itemDetails',
    'source.web.css'
] as const;

export type ThemeCapability = (typeof THEME_CAPABILITIES)[number];

/**
 * What the WEB renderer implements today.
 *
 * Deliberately narrower than {@link THEME_CAPABILITIES}. The four capabilities absent here —
 * `presentation.page.*` and `source.web.css` — are DEFINED by the contract and NOT YET BOUND by
 * this renderer, and the honest way to say that is to leave them out of this list and let
 * {@link resolveCapability} fall back, rather than to omit them from the contract and pretend the
 * vocabulary is smaller than the product direction requires.
 *
 * `source.web.css` in particular is the advanced CSS/SCSS/LESS/Sass authoring layer: the manifest
 * reserves its shape (`renderers.web.source`) so the package format is already right, while the
 * schema accepts only `kind: "none"` until an isolated compiler boundary exists (RFC-0007 §7).
 */
export const WEB_RENDERER_CAPABILITIES: readonly ThemeCapability[] = [
    'tokens.core',
    'tokens.profiles',
    'assets.roles',
    'presentation.surface',
    'presentation.mediaCard',
    'presentation.navigation'
] as const;

export type ThemeMode = 'light' | 'dark';

export type ThemeProfileName =
    | 'pointer'
    | 'touch'
    | 'remote'
    | 'compact'
    | 'medium'
    | 'expanded'
    | 'reducedMotion'
    | 'reducedTransparency'
    | 'lowPower';

export type ThemeAssetRole =
    | 'logo'
    | 'wordmark'
    | 'monogram'
    | 'favicon'
    | 'backdrop'
    | 'loginBackdrop'
    | 'placeholderPoster'
    | 'placeholderBackdrop';

export interface SurfacePresentation {
    variant?: 'glass' | 'opaque';
    border?: 'none' | 'hairline';
    elevation?: 'level0' | 'level1' | 'level2' | 'level3';
}

export interface MediaCardPresentation {
    imageAspect?: 'poster' | 'backdrop' | 'square';
    titlePlacement?: 'below' | 'overlay';
    hoverEffect?: 'none' | 'lift' | 'zoom';
    progressStyle?: 'bar' | 'none';
}

/**
 * How navigation LOOKS. Never what it CONTAINS: which destinations exist is authorization and
 * library state, and a theme has no say in it (RFC-0007 §6.1).
 */
export interface NavigationPresentation {
    shell?: 'sidebar' | 'rail' | 'topbar';
    labels?: 'always' | 'active' | 'never';
    position?: 'start' | 'end';
}

export type HomeSection =
    | 'hero'
    | 'continueWatching'
    | 'nextUp'
    | 'latestMedia'
    | 'libraries'
    | 'recommendations';

export type ItemDetailsSection =
    | 'overview'
    | 'cast'
    | 'episodes'
    | 'related'
    | 'mediaInfo';

export interface PageRecipes {
    home?: {
        sections?: readonly HomeSection[];
        shelfDensity?: 'compact' | 'comfortable' | 'spacious';
    };
    library?: {
        layout?: 'grid' | 'shelf';
        cardAspect?: 'poster' | 'backdrop' | 'square';
        filters?: 'inline' | 'drawer';
    };
    itemDetails?: {
        hero?: 'backdrop' | 'poster' | 'minimal';
        sections?: readonly ItemDetailsSection[];
    };
}

export interface ThemePresentation {
    surface?: SurfacePresentation;
    mediaCard?: MediaCardPresentation;
    navigation?: NavigationPresentation;
    page?: PageRecipes;
}

export interface ThemeRendererDeclaration {
    supports?: readonly ThemeCapability[];
}

export interface WebRendererDeclaration extends ThemeRendererDeclaration {
    /**
     * RESERVED extension point for the advanced Web authoring layer (RFC-0007 §7). `kind: 'none'`
     * is the only accepted value today; widening it is the one schema change that opens the layer.
     */
    source?: { kind: 'none' };
}

export interface ThemeLineage {
    basedOn?: { id: string; version: string };
    /** Declared authoring intent. Recorded, not enforced — signing and source protection are out of scope. */
    remixable: boolean;
    attribution?: string;
}

/** A complete v2 manifest, exactly as `theme.schema.json` accepts it. */
export interface ThemeManifest {
    contractVersion: 2;
    id: string;
    version: string;
    name: string;
    description?: string;
    author: string;
    license: string;
    compatibility: {
        web?: string;
        android?: string;
        ios?: string;
        tv?: string;
    };
    modes: readonly ThemeMode[];
    profiles?: Partial<Record<ThemeProfileName, ThemeTokensPartial>>;
    assets?: Partial<Record<ThemeAssetRole, string>>;
    presentation?: ThemePresentation;
    capabilities?: {
        required?: readonly ThemeCapability[];
        optional?: readonly ThemeCapability[];
    };
    renderers?: {
        web?: WebRendererDeclaration;
        android?: ThemeRendererDeclaration;
        ios?: ThemeRendererDeclaration;
        tv?: ThemeRendererDeclaration;
    };
    lineage?: ThemeLineage;
}

/** The contract version this build of Tesserafin Web speaks. */
export const THEME_CONTRACT_VERSION = 2 as const;
