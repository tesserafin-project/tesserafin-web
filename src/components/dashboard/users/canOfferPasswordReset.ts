import type { UserDto } from '@jellyfin/sdk/lib/generated-client';

/**
 * Only an administrator may clear another account's credential without proving it.
 * An ordinary user clears their own by saving an empty new password with the current one.
 */
export const canOfferPasswordReset = (
    loggedInUser: UserDto | null | undefined,
    user: UserDto
): boolean =>
    !!user.HasConfiguredPassword &&
    !user.Policy?.IsAdministrator &&
    !!loggedInUser?.Policy?.IsAdministrator;
