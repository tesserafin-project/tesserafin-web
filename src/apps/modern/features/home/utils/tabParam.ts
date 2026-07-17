/** Number of tabs rendered by `apps/modern/routes/home.tsx` (Accueil, Favoris). */
export const HOME_TAB_COUNT = 2;

/**
 * Parses the `?tab=` search param into a valid tab index, defaulting to `0` (Accueil) for
 * anything missing, non-numeric or out of range - mirrors the legacy `parseInt(..., 10)` fallback
 * in the previous `home.tsx`, but also guards against out-of-range values since MUI `Tabs` renders
 * nothing selected if `value` doesn't match any `Tab`.
 */
export const parseHomeTabIndex = (rawValue: string | null): number => {
    const parsed =
        rawValue === null ? Number.NaN : Number.parseInt(rawValue, 10);

    return Number.isInteger(parsed) && parsed >= 0 && parsed < HOME_TAB_COUNT
        ? parsed
        : 0;
};

/** Serializes a tab index back to the `?tab=` search param string form. */
export const homeTabIndexToParam = (index: number): string => String(index);
