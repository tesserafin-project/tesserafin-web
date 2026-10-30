import { describe, expect, it } from 'vitest';

import {
    forgetLibraryPosition,
    libraryOwner,
    libraryReturnKey,
    readLibraryPosition,
    rememberLibraryPosition
} from './libraryReturnPosition';

const position = { index: 7, href: '#/details?id=a', offset: 10, total: 100 };
const alice = libraryOwner('server', 'alice');
const bob = libraryOwner('server', 'bob');

describe('libraryReturnPosition', () => {
    it('answers only the exact result set and history entry', () => {
        const key = libraryReturnKey('movies|drama', 'entry-1');
        rememberLibraryPosition(alice, key, position);
        expect(readLibraryPosition(alice, key)).toEqual(position);
        expect(
            readLibraryPosition(
                alice,
                libraryReturnKey('movies|comedy', 'entry-1')
            )
        ).toBeUndefined();
        expect(
            readLibraryPosition(
                alice,
                libraryReturnKey('movies|drama', 'entry-2')
            )
        ).toBeUndefined();
    });

    it('keeps nothing of the previous account, even under the same key', () => {
        const key = libraryReturnKey('movies', 'entry-1');
        rememberLibraryPosition(alice, key, position);
        expect(readLibraryPosition(bob, key)).toBeUndefined();
        // Switching back does not resurrect it.
        expect(readLibraryPosition(alice, key)).toBeUndefined();
    });

    it('stays bounded and forgets on request', () => {
        for (let entry = 0; entry < 25; entry++) {
            rememberLibraryPosition(
                alice,
                libraryReturnKey('movies', `entry-${entry}`),
                position
            );
        }
        expect(
            readLibraryPosition(alice, libraryReturnKey('movies', 'entry-0'))
        ).toBeUndefined();
        const newest = libraryReturnKey('movies', 'entry-24');
        expect(readLibraryPosition(alice, newest)).toEqual(position);
        forgetLibraryPosition(newest);
        expect(readLibraryPosition(alice, newest)).toBeUndefined();
    });
});
