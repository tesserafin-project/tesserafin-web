import globalize from 'lib/globalize';
import { type RecommendationDto, RecommendationType } from 'lib/reefin-sdk';

/**
 * Heading for one `MovieRecommendations` category ("Because you watched X", "Directed by Y", …).
 *
 * Mirrors `apps/modern/features/libraries/components/SuggestionsSectionView.tsx`'s
 * `getRecommendationTittle` [sic] exactly — same `RecommendationType` branches, same four
 * `Recommendation*` strings — so the Suggestions destination labels its shelves with the wording
 * users already know. It is re-expressed here against `lib/reefin-sdk`'s `RecommendationType`
 * rather than imported, because the legacy component types it against `@jellyfin/sdk`'s enum and
 * this slice is kept free of that import (issue #15's migration rule). The two enums are
 * `openapi-generator` output over the same contract, so the string values are identical.
 */
export const getRecommendationTitle = (
    recommendation: RecommendationDto
): string => {
    const baseline = recommendation.BaselineItemName ?? '';

    switch (recommendation.RecommendationType) {
        case RecommendationType.SimilarToRecentlyPlayed:
            return globalize.translate(
                'RecommendationBecauseYouWatched',
                baseline
            );
        case RecommendationType.SimilarToLikedItem:
            return globalize.translate('RecommendationBecauseYouLike', baseline);
        case RecommendationType.HasDirectorFromRecentlyPlayed:
        case RecommendationType.HasLikedDirector:
            return globalize.translate('RecommendationDirectedBy', baseline);
        case RecommendationType.HasActorFromRecentlyPlayed:
        case RecommendationType.HasLikedActor:
            return globalize.translate('RecommendationStarring', baseline);
        default:
            // An unknown/absent `RecommendationType` still has a baseline item worth naming; falling
            // back to it beats rendering an untitled shelf.
            return baseline;
    }
};
