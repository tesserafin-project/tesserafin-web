/**
 * The official themes a draft can be started from, as **immutable sources**.
 *
 * `Object.freeze` here is not decoration. The Studio's editing model is structural sharing: a new
 * revision reuses every untouched branch of the previous one, and the first revision's branches are
 * the official theme's own objects. Without a freeze, a bug that mutated a token in place would
 * silently rewrite the shipped theme for the rest of the session — the draft would look correct and
 * the official theme would not. Frozen, that bug throws in strict mode instead of corrupting.
 *
 * The manifests are imported from `tesserafin-design/themes/` rather than restated, so "start from
 * Classic" means the real Classic and cannot drift from it.
 */

import classicManifest from '../../../../../tesserafin-design/themes/classic/theme.json';
import glassManifest from '../../../../../tesserafin-design/themes/glass/theme.json';
import type { ThemeManifest } from 'themes/platform';
import classicTokens from 'ui/tokens/official.classic';
import glassTokens from 'ui/tokens/official.glass';
import type { TesserafinTokens } from 'ui/tokens/types';

export interface OfficialThemeSource {
    id: string;
    name: string;
    manifest: ThemeManifest;
    tokens: TesserafinTokens;
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

export const OFFICIAL_SOURCES: readonly OfficialThemeSource[] = deepFreeze([
    {
        id: (classicManifest as ThemeManifest).id,
        name: (classicManifest as ThemeManifest).name,
        manifest: classicManifest as ThemeManifest,
        tokens: classicTokens
    },
    {
        id: (glassManifest as ThemeManifest).id,
        name: (glassManifest as ThemeManifest).name,
        manifest: glassManifest as ThemeManifest,
        tokens: glassTokens
    }
]);

export function getOfficialSource(id: string): OfficialThemeSource | undefined {
    return OFFICIAL_SOURCES.find((source) => source.id === id);
}
