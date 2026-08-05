import { createTheme, type Theme } from '@mui/material/styles';

import type { ColorSchemeMap } from './colorSchemeCache';
import { DEFAULT_THEME_OPTIONS } from './_base/theme';

// Tesserafin Classic --rf-* design tokens (RFC-0005 §3.2/§7.1, W13.6 WP1). Loaded statically: it is the
// default theme's token stylesheet and measures ~2.9 KiB, comfortably under the 5 KiB threshold
// past which this RFC asks for a lazy import (RFC-0005 §9.2 budgets a theme's CSS at <=50 KiB).
import 'ui/tokens/official.classic.css';

/**
 * Builds the app's MUI theme from whichever color schemes are currently loaded.
 *
 * Historically this module created one static `DEFAULT_THEME` singleton embedding all six legacy
 * color schemes, imported synchronously by `RootAppRouter.tsx` and `utils/reactUtils.tsx` — the
 * exact coupling RFC-0005 §9.1 calls out as blocking per-theme code splitting. Non-default color
 * schemes are now loaded lazily through the registry (`themes/registry.ts`,
 * `themes/colorSchemeCache.ts`) and the theme is *recreated* here whenever the loaded set changes.
 *
 * This "recreate on load" approach — rather than mutating an existing MUI theme object in place —
 * is a deliberate choice: MUI v6.5's CSS-variables theme (`createTheme`/`extendTheme`) generates
 * `colorSchemes` stylesheets once at creation time (see `@mui/system/cssVars/prepareCssVars.js`),
 * and there is no public, supported API to register an additional color scheme afterwards. MUI's
 * `<ThemeProvider theme>` prop is a plain, ordinary React prop though (re-derived on every render
 * via `@mui/system/cssVars/createCssVarsProvider.js`, including its `generateStyleSheets()` call),
 * so passing a freshly built theme object each time the color scheme cache gains an entry is fully
 * supported and requires no internal MUI hooks. See `themes/useAppTheme.ts` for the hook that
 * drives this from React state.
 */
export const buildAppTheme = (colorSchemes: ColorSchemeMap): Theme =>
    createTheme({
        cssVariables: {
            cssVarPrefix: 'jf',
            colorSchemeSelector: '[data-theme="%s"]',
            disableCssColorScheme: true
        },
        defaultColorScheme: 'official.classic',
        ...DEFAULT_THEME_OPTIONS,
        // MUI types every custom color scheme declared via `ColorSchemeOverrides` (styles.d.ts) as
        // required once any `colorSchemes` map is passed (see createThemeWithVars.d.ts). We build
        // that map incrementally as themes load (RFC-0005 §9.1), so it is legitimately a subset at
        // any point in time — same trade-off as the existing `@ts-expect-error` in themes/utils.ts.
        // @ts-expect-error Not every custom color scheme is guaranteed to be loaded yet.
        colorSchemes
    });

export { DEFAULT_THEME_OPTIONS };
