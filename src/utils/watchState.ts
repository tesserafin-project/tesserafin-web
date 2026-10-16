interface WatchedData {
    Played?: boolean | null;
    PlayedPercentage?: number | null;
}

/**
 * What a card shows of a viewer's history with an item: a progress bar while it is part-watched, a
 * mark once it is watched. One reading for every card, so the library, home and detail pages cannot
 * disagree about the same item.
 */
export function getWatchState(userData: WatchedData | null | undefined): {
    progressPercent?: number;
    played: boolean;
} {
    const percent = userData?.PlayedPercentage ?? 0;
    return {
        progressPercent: percent > 0 && percent < 100 ? percent : undefined,
        played: !!userData?.Played
    };
}
