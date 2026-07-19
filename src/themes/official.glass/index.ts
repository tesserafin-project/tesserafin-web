import { buildCustomColorScheme } from 'themes/utils';

// Glass's `--rf-*` tokens ride this lazy module so they land in the same `theme-colorscheme-
// official-glass` webpack chunk as the color scheme below (RFC-0005 §9.1): the frosted
// `[data-rf-theme="official.glass"]` rules are injected only once a user actually selects Glass,
// never weighing on the default (Classic) bundle. Classic imports its own tokens statically in
// `src/themes/index.ts` instead, because it is the no-flash default.
import 'ui/tokens/official.glass.css';

/**
 * Reefin Glass (RFC-0005 §8.2) — a frosted-glass identity: a deep tinted dark background with
 * translucent, layered surfaces and cool cyan/indigo accents.
 *
 * The translucency itself (the `rgba()` surface/surfaceVariant colors, `backdrop-filter` blur)
 * lives entirely in the `--rf-*` design-token layer (`src/ui/tokens/official.glass.css`,
 * generated from `reefin-design/themes/glass/tokens.json`) and is applied by `src/ui/` component
 * CSS. This MUI `ColorSystemOptions` intentionally keeps `background.paper` OPAQUE: MUI-driven
 * legacy surfaces (dialogs, menus, the classic card grid, etc.) do not read `--rf-*` tokens and
 * have no backdrop to blur, so giving them a translucent paper color would just make their text
 * illegible. Glass's visual identity is delivered on the `src/ui/` component surface; MUI here
 * only needs to stay coherent and legible standing on its own (RFC-0005 §8.2).
 *
 * v1 is dark-only (`modes: ["dark"]` in theme.json) — a light frosted mode is a documented
 * follow-up, not part of this tranche.
 *
 * Built with `buildCustomColorScheme` (like every other custom lazy theme: appletv, blueradiance,
 * purplehaze, wmc), NOT the raw `merge(DEFAULT_COLOR_SCHEME, …)` shape that `dark`/`light` use.
 * `dark`/`light` are native MUI color-scheme names, so MUI auto-merges them with its built-in
 * palette; a custom id like `official.glass` gets no such merge, so it must fold in MUI's full
 * default dark scheme itself — otherwise the lazily-registered scheme is missing palette fields
 * MUI's CSS-var generation dereferences (e.g. `palette.background`), and selecting Glass throws
 * `Cannot read properties of undefined (reading 'background')` at render.
 */
const theme = buildCustomColorScheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#4fd1ff'
        },
        secondary: {
            main: '#8a7dff'
        },
        background: {
            default: '#0b0e14',
            paper: '#161b26'
        },
        AppBar: {
            defaultBg: '#161b26'
        }
    }
});

export default theme;
