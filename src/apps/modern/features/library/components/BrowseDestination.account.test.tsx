import { BaseItemKind } from 'lib/tesserafin-sdk';
import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    libraryOwner,
    libraryReturnKey,
    readLibraryPosition,
    rememberLibraryPosition
} from '../utils/libraryReturnPosition';
import { BrowseDestination } from './BrowseDestination';

const session = vi.hoisted(() => ({
    user: { Id: 'alice', ServerId: 'server' },
    mounts: [] as string[]
}));

vi.mock('hooks/useApi', () => ({ useApi: () => ({ user: session.user }) }));
vi.mock('hooks/useUserSettings', () => ({
    useUserSettings: () => ({ libraryPageSize: 100 })
}));
vi.mock('lib/globalize', () => ({
    default: { translate: (key: string) => key }
}));
vi.mock('../api/useLibraryFilters', () => ({
    useLibraryFilters: () => ({ data: undefined, isPending: false })
}));
vi.mock('../api/useLibraryDestinations', () => ({
    useLibraryStudios: () => ({ data: undefined, isPending: false })
}));
vi.mock('../api/useLibraryItems', () => ({
    useLibraryItems: () => ({ data: undefined, isPending: true })
}));
vi.mock('./ContinuousLibraryGrid', () => ({
    default: ({ context }: { context: string }) => {
        const [mountedFor] = useState(context);
        useEffect(() => {
            session.mounts.push(mountedFor);
        }, [mountedFor]);
        return <div data-testid='grid'>{mountedFor}</div>;
    }
}));

const browse = () => (
    <MemoryRouter>
        <BrowseDestination
            libraryId='view'
            libraryName='Films'
            collectionType='movies'
            primaryItemType={BaseItemKind.Movie}
            density='comfortable'
            apiClient={undefined}
            recipe={
                {
                    layout: 'grid',
                    filters: 'inline',
                    cardAspect: 'poster'
                } as never
            }
        />
    </MemoryRouter>
);

describe('BrowseDestination across an account change', () => {
    beforeEach(() => {
        session.user = { Id: 'alice', ServerId: 'server' };
        session.mounts.length = 0;
    });

    it('starts a new grid, which can read nothing the previous account left', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        const shown = () =>
            host.querySelector('[data-testid="grid"]')?.textContent ?? '';
        await act(async () => root.render(browse()));
        const alice = shown();
        expect(alice).toContain('alice');
        const key = libraryReturnKey(alice, 'entry');
        rememberLibraryPosition(libraryOwner('server', 'alice'), key, {
            index: 5_000,
            href: '#/details?id=a',
            offset: 10,
            total: 12_000
        });

        session.user = { Id: 'bob', ServerId: 'server' };
        await act(async () => root.render(browse()));
        const bob = shown();
        expect(bob).not.toBe(alice);
        expect(session.mounts).toEqual([alice, bob]);
        expect(bob).toContain('bob');
        expect(bob).not.toContain('alice');

        // What the new grid would read, under its own key and under the old one.
        const bobOwner = libraryOwner('server', 'bob');
        expect(
            readLibraryPosition(bobOwner, libraryReturnKey(bob, 'entry'))
        ).toBeUndefined();
        expect(readLibraryPosition(bobOwner, key)).toBeUndefined();
        // And Alice's return is gone too, rather than waiting for her.
        expect(
            readLibraryPosition(libraryOwner('server', 'alice'), key)
        ).toBeUndefined();
        await act(async () => root.unmount());
    });
});
