/**
 * The capability gate, and the only expression of it in the Web (#138 §7).
 *
 * The gate is exactly `UserPolicy.EnableContentPackManagement === true`. It is NOT
 * `IsAdministrator`: the server publishes a dedicated capability precisely so that a deployment can
 * grant pack management to someone who is not an administrator, and substituting the role here
 * would silently re-impose a policy the server does not have.
 *
 * ## What this gate is for, and what it is not
 *
 * It decides which affordances are DRAWN. It is not authorization: the server refuses an
 * unauthorized write whether or not a button existed, every management call goes through the
 * generated client either way, and no surface in this slice treats a hidden control as a
 * permission check. Hiding is a courtesy to the user, not a boundary.
 *
 * ## Why the cast
 *
 * `useApi().user` is `@jellyfin/sdk`'s `UserDto`, whose `Policy` is Jellyfin's `UserPolicy` — a
 * type that predates this capability and does not declare it. The runtime object is the Tesserafin
 * server's response and does carry the field. Reading it through Tesserafin's OWN generated
 * `UserPolicy` is therefore the narrowest honest way to type it: a type-only import (erased at
 * build time, so it costs nothing in any chunk) and one cast at one place, rather than a widened
 * `any` at every call site or an optional field bolted onto the shared context type.
 */
import type { UserPolicy } from 'lib/tesserafin-sdk/generated/models/user-policy';

import { useApi } from 'hooks/useApi';

export const canManageContentPacks = (
    policy: UserPolicy | null | undefined
): boolean => policy?.EnableContentPackManagement === true;

/**
 * Whether the acting user may manage content packs.
 *
 * `false` while the session is still loading, which is the safe direction: an affordance that
 * appears a moment late is a nuisance, one that appears for an unauthorized user and then vanishes
 * is a lie about what they may do.
 */
export const useContentPackManagement = (): boolean => {
    const { user } = useApi();
    return canManageContentPacks(user?.Policy as UserPolicy | undefined);
};
