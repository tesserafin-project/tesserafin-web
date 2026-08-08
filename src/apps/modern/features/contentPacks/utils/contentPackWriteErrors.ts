/**
 * The one status a write surface treats differently from "there was an error".
 *
 * `createContentPack` and `updateContentPack` answer `409` when the name is already taken. That is
 * the only failure a viewer can act on without being told anything else — every other rejection
 * (an invalid length, a refused permission, a dropped connection) resolves to the generic message,
 * because guessing at a reason the server did not give is how a form starts lying.
 */
const CONFLICT = 409;

export const isNameConflictError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
        response?: { status?: unknown };
        status?: unknown;
    };
    return (candidate.response?.status ?? candidate.status) === CONFLICT;
};
