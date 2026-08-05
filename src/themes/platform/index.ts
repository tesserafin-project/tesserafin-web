/**
 * Theme Platform v2 public surface (RFC-0007).
 *
 * Everything a caller needs to read a theme manifest, decide whether the active renderer can honour
 * it, and know what it will actually apply. Nothing here touches the DOM, MUI or the network.
 */

export type {
    HomeRecipe,
    HomeSection,
    HomeShelfDensity,
    ItemDetailsSection,
    MediaCardPresentation,
    NavigationPresentation,
    PageRecipes,
    SurfacePresentation,
    ThemeAssetRole,
    ThemeCapability,
    ThemeLineage,
    ThemeManifest,
    ThemeMode,
    ThemePresentation,
    ThemeProfileName,
    ThemeRendererDeclaration,
    ThemeTokensPartial,
    WebRendererDeclaration
} from './contract';
export {
    HOME_SECTIONS,
    HOME_SHELF_DENSITIES,
    THEME_CAPABILITIES,
    THEME_CONTRACT_VERSION,
    WEB_RENDERER_CAPABILITIES
} from './contract';

export type {
    CapabilityFallback,
    PresentationResolution,
    ResolvedPresentation
} from './resolvePresentation';
export {
    PLATFORM_DEFAULT_PRESENTATION,
    resolvePresentation
} from './resolvePresentation';

export { getManifestForThemeId, MANIFEST_THEME_IDS } from './manifests';

export {
    clearAppliedPresentation,
    loadAppliedPresentation,
    saveAppliedPresentation
} from './localPresentation';

export type {
    ThemeValidationCode,
    ThemeValidationIssue,
    ThemeValidationResult
} from './validateManifest';
export {
    assertNoExecutableSurface,
    satisfiesLooseRange,
    validateManifest,
    validateThemePackage
} from './validateManifest';
