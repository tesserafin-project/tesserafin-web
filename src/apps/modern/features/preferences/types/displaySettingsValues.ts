export interface DisplaySettingsValues {
    /**
     * `MediaFamilyFirst` or `ContentPackFirst`, server-owned on `UserConfiguration` (#139 gate 5).
     * A string rather than the generated enum because every field on this form is the primitive the
     * form control produces; the enum is applied where the value is read and written.
     */
    contentPackBrowsingPreference: string;
    customCss: string;
    dashboardTheme: string;
    dateTimeLocale: string;
    disableCustomCss: boolean;
    displayMissingEpisodes: boolean;
    enableBlurHash: boolean;
    enableFasterAnimation: boolean;
    enableItemDetailsBanner: boolean;
    enableLibraryBackdrops: boolean;
    enableLibraryThemeSongs: boolean;
    enableLibraryThemeVideos: boolean;
    enableRewatchingInNextUp: boolean;
    episodeImagesInNextUp: boolean;
    language: string;
    layout: string;
    libraryPageSize: number;
    maxDaysForNextUp: number;
    screensaver: string;
    screensaverTime: number;
    backdropScreensaverInterval: number;
    slideshowInterval: number;
    theme: string;
}
