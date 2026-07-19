/**
 * Hand-written TypeScript mirror of `reefin-design/schema/tokens.schema.json` (RFC-0005 §7.1,
 * §7.3). This is the type consumed by `src/ui/` components and by MUI theme wiring; the generated
 * per-theme token files under this directory (e.g. `official.classic.ts`) are typed against it.
 *
 * Keep this in sync by hand when `tokens.schema.json` changes — it is not generated, since it is
 * the hand-authored contract the generator (`reefin-design/scripts/generate-web-tokens.mjs`)
 * targets, not an output of it.
 */

/** Semantic color tokens for a single mode (light or dark). */
export interface ReefinColorGroup {
    background: string;
    surface: string;
    surfaceVariant: string;
    text: string;
    textMuted: string;
    primary: string;
    onPrimary: string;
    accent: string;
    error: string;
    warning: string;
    success: string;
    focus: string;
    divider: string;
}

export interface ReefinColorTokens {
    /**
     * Optional: only present for a theme whose `theme.json#modes` includes `"light"`. A theme
     * declared dark-only (e.g. Reefin Glass) omits it rather than carrying an unused duplicate
     * palette — see `reefin-design/schema/tokens.schema.json`'s `color` definition.
     */
    light?: ReefinColorGroup;
    dark: ReefinColorGroup;
}

export interface ReefinTypographyTokens {
    fontFamily: {
        base: string;
        mono?: string;
    };
    fontSize: {
        xs: string;
        sm: string;
        md: string;
        lg: string;
        xl: string;
        xxl: string;
    };
    fontWeight: {
        regular: number;
        medium: number;
        bold: number;
    };
}

export interface ReefinShapeTokens {
    radius: {
        sm: string;
        md: string;
        lg: string;
        full: string;
    };
}

export interface ReefinSpacingTokens {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
}

/** CSS box-shadow values on Web; other renderers translate levels to their own primitive. */
export interface ReefinElevationTokens {
    level0: string;
    level1: string;
    level2: string;
    level3: string;
}

export interface ReefinMotionTokens {
    duration: {
        fast: string;
        normal: string;
        slow: string;
    };
    easing: {
        standard: string;
        decelerate: string;
        accelerate: string;
    };
}

export type ReefinDensity = 'compact' | 'comfortable' | 'spacious';

export interface ReefinBlurTokens {
    sm: string;
    md: string;
    lg: string;
}

/** Full token set for one theme, matching `reefin-design/schema/tokens.schema.json`. */
export interface ReefinTokens {
    color: ReefinColorTokens;
    typography: ReefinTypographyTokens;
    shape: ReefinShapeTokens;
    spacing: ReefinSpacingTokens;
    elevation: ReefinElevationTokens;
    motion: ReefinMotionTokens;
    density: ReefinDensity;
    blur: ReefinBlurTokens;
}
