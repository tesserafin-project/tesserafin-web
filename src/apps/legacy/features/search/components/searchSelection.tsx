import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { useQueryClient } from '@tanstack/react-query';
import React, { type FC, type MouseEvent, useCallback, useState } from 'react';

import itemHelper from 'components/itemHelper';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import globalize from 'lib/globalize';

/**
 * Multi-select for search results (DEBT-WEB-1), the behaviour `components/multiSelect` gave the old
 * rows, rebuilt on React state because that module finds its cards by the old `.card` markup:
 * select, deselect (deselecting the last item ends it), cancel, and the grouped actions of its
 * menu, with the same permission gates. Entered by a long press, as before, or by the "Select"
 * button above the results, which a keyboard reaches.
 */

const PLAYABLE_VIDEO_TYPES: string[] = [
    BaseItemKind.Movie,
    BaseItemKind.Episode,
    BaseItemKind.MusicVideo,
    BaseItemKind.Video
];

export const useSearchSelection = () => {
    const [selected, setSelected] = useState<string[] | null>(null);

    const start = useCallback((id?: string) => setSelected(id ? [id] : []), []);
    const cancel = useCallback(() => setSelected(null), []);
    const toggle = useCallback(
        (id: string) =>
            setSelected((current) => {
                if (!current) return [id];
                const next = current.includes(id)
                    ? current.filter((x) => x !== id)
                    : [...current, id];
                // As before: removing the last selected item leaves selection mode.
                return next.length ? next : null;
            }),
        []
    );
    const selectAll = useCallback((ids: string[]) => setSelected(ids), []);

    return { selected, start, cancel, toggle, selectAll };
};

interface SearchSelectionBarProps {
    selected: string[];
    allIds: string[];
    onCancel: () => void;
    onSelectAll: (ids: string[]) => void;
}

/** The selection header: close, count, and the grouped-actions menu. */
export const SearchSelectionBar: FC<SearchSelectionBarProps> = ({
    selected,
    allIds,
    onCancel,
    onSelectAll
}) => {
    const queryClient = useQueryClient();

    const done = useCallback(() => {
        onCancel();
        void queryClient.invalidateQueries({ queryKey: ['Search'] });
    }, [onCancel, queryClient]);

    const showMenu = useCallback(
        (event: MouseEvent<HTMLButtonElement>) => {
            const anchor = event.currentTarget;
            const apiClient = ServerConnections.currentApiClient();
            if (!apiClient || !selected.length) return;
            const items = selected.slice();
            const serverId = apiClient.serverId();

            void Promise.all([
                apiClient.getCurrentUser(),
                apiClient.getItem(apiClient.getCurrentUserId(), items[0]),
                import('components/actionSheet/actionSheet')
            ]).then(([user, firstItem, actionSheet]) => {
                const policy = (user.Policy ?? {}) as {
                    IsAdministrator?: boolean;
                    EnableCollectionManagement?: boolean;
                    EnableContentDeletion?: boolean;
                };
                const menu = [
                    { name: globalize.translate('SelectAll'), id: 'selectall' }
                ];
                if (
                    policy.IsAdministrator ||
                    policy.EnableCollectionManagement
                ) {
                    menu.push({
                        name: globalize.translate('AddToCollection'),
                        id: 'addtocollection'
                    });
                }
                menu.push({
                    name: globalize.translate('AddToPlaylist'),
                    id: 'playlist'
                });
                if (policy.EnableContentDeletion) {
                    menu.push({
                        name: globalize.translate('Delete'),
                        id: 'delete'
                    });
                }
                if (
                    policy.IsAdministrator &&
                    PLAYABLE_VIDEO_TYPES.includes(firstItem.Type ?? '')
                ) {
                    menu.push({
                        name: globalize.translate('GroupVersions'),
                        id: 'groupvideos'
                    });
                }
                menu.push(
                    {
                        name: globalize.translate('MarkPlayed'),
                        id: 'markplayed'
                    },
                    {
                        name: globalize.translate('MarkUnplayed'),
                        id: 'markunplayed'
                    }
                );
                // As before: the first item's permission stands for all of them.
                if (itemHelper.canRefreshMetadata(firstItem, user)) {
                    menu.push({
                        name: globalize.translate('RefreshMetadata'),
                        id: 'refresh'
                    });
                }

                return actionSheet
                    .show({ items: menu, positionTo: anchor })
                    .then((id) => runCommand(String(id), items, serverId))
                    .catch(() => {
                        /* dismissed */
                    });
            });

            const runCommand = async (
                id: string,
                ids: string[],
                server: string
            ) => {
                switch (id) {
                    case 'selectall':
                        onSelectAll(allIds);
                        return;
                    case 'addtocollection': {
                        const { default: CollectionEditor } = await import(
                            'components/collectionEditor/collectionEditor'
                        );
                        new CollectionEditor().show({
                            items: ids,
                            serverId: server
                        });
                        done();
                        return;
                    }
                    case 'playlist': {
                        const { default: PlaylistEditor } = await import(
                            'components/playlisteditor/playlisteditor'
                        );
                        new PlaylistEditor()
                            .show({ items: ids, serverId: server })
                            .catch(() => {
                                /* dialog closed */
                            });
                        done();
                        return;
                    }
                    case 'delete': {
                        const { default: confirm } = await import(
                            'components/confirm/confirm'
                        );
                        const many = ids.length > 1;
                        try {
                            await confirm(
                                globalize.translate(
                                    many
                                        ? 'ConfirmDeleteItems'
                                        : 'ConfirmDeleteItem'
                                ),
                                globalize.translate(
                                    many
                                        ? 'HeaderDeleteItems'
                                        : 'HeaderDeleteItem'
                                )
                            );
                        } catch {
                            return;
                        }
                        try {
                            await Promise.all(
                                ids.map((itemId) =>
                                    apiClient.deleteItem(itemId)
                                )
                            );
                        } catch {
                            const { default: alert } = await import(
                                'components/alert'
                            );
                            await alert(
                                globalize.translate('ErrorDeletingItem')
                            );
                        }
                        done();
                        return;
                    }
                    case 'groupvideos': {
                        if (ids.length < 2) {
                            const { default: alert } = await import(
                                'components/alert'
                            );
                            await alert(
                                globalize.translate('PleaseSelectTwoItems')
                            );
                            return;
                        }
                        await apiClient.ajax({
                            type: 'POST',
                            url: apiClient.getUrl('Videos/MergeVersions', {
                                Ids: ids.join(',')
                            })
                        });
                        done();
                        return;
                    }
                    case 'markplayed':
                    case 'markunplayed': {
                        const userId = apiClient.getCurrentUserId();
                        await Promise.all(
                            ids.map((itemId) =>
                                id === 'markplayed'
                                    ? apiClient.markPlayed(
                                          userId,
                                          itemId,
                                          new Date()
                                      )
                                    : apiClient.markUnplayed(
                                          userId,
                                          itemId,
                                          new Date()
                                      )
                            )
                        );
                        done();
                        return;
                    }
                    case 'refresh': {
                        const { default: RefreshDialog } = await import(
                            'components/refreshdialog/refreshdialog'
                        );
                        new RefreshDialog({
                            itemIds: ids,
                            serverId: server
                        }).show();
                        done();
                        return;
                    }
                    default:
                }
            };
        },
        [allIds, done, onSelectAll, selected]
    );

    return (
        <div
            className='searchSelectionBar'
            role='toolbar'
            aria-label={globalize.translate('Select')}
        >
            <button
                type='button'
                className='searchSelectionBar-button'
                aria-label={globalize.translate('ButtonCancel')}
                title={globalize.translate('ButtonCancel')}
                onClick={onCancel}
            >
                <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
                    <path d='M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z' />
                </svg>
            </button>
            <span className='searchSelectionBar-count' aria-live='polite'>
                {selected.length}
            </span>
            <button
                type='button'
                className='searchSelectionBar-button'
                aria-label={globalize.translate('ButtonMore')}
                title={globalize.translate('ButtonMore')}
                disabled={!selected.length}
                onClick={showMenu}
            >
                <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
                    <path d='M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z' />
                </svg>
            </button>
        </div>
    );
};
