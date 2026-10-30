export interface LibraryReturnPosition {
    /** The opened item's index in the server's result set. */
    index: number;
    href: string;
    /** Distance from the top of the viewport to the card when it was opened. */
    offset: number;
    total: number;
}

// Session-local and bounded, like Home's. One owner at a time: an account switch keeps nothing.
const positions = new Map<string, LibraryReturnPosition>();
const MAX_POSITIONS = 20;
let positionsOwner: string | undefined;

const ownedBy = (owner: string) => {
    if (owner !== positionsOwner) {
        positions.clear();
        positionsOwner = owner;
    }
};

export const libraryOwner = (server: string, user: string) =>
    JSON.stringify([server, user]);

/** `context` holds the library, filters and sort; `entry` is the history entry. */
export const libraryReturnKey = (context: string, entry: string) =>
    JSON.stringify([context, entry]);

export function rememberLibraryPosition(
    owner: string,
    key: string,
    position: LibraryReturnPosition
) {
    ownedBy(owner);
    positions.delete(key);
    positions.set(key, position);
    if (positions.size > MAX_POSITIONS)
        positions.delete(positions.keys().next().value!);
}

export function readLibraryPosition(owner: string, key: string) {
    ownedBy(owner);
    return positions.get(key);
}

export const forgetLibraryPosition = (key: string) => positions.delete(key);
