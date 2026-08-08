import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
    type FC
} from 'react';

import globalize from 'lib/globalize';

import type { ContentPackDto } from '../adapters/contentPacksApi';
import {
    useCreateContentPack,
    useDeleteContentPack,
    useReorderContentPacks,
    useUpdateContentPack
} from '../api/useContentPackMutations';
import { useContentPackManagement } from '../hooks/useContentPackManagement';
import { moveDown, moveUp } from '../utils/reorder';
import ContentPackDeleteDialog from './ContentPackDeleteDialog';
import ContentPackFormDialog, {
    type ContentPackFormValues
} from './ContentPackFormDialog';

import './contentPackControls.scss';

/**
 * The manager-only surface of `/contentpacks` (#138 §7).
 *
 * Renders **nothing at all** without `UserPolicy.EnableContentPackManagement`. Not a disabled
 * control, not a hidden one — the component returns `null`, so an ordinary viewer's DOM contains no
 * create, rename, reorder or delete affordance to find. That is a courtesy, not a boundary: the
 * server refuses an unauthorized write whether or not a button existed, and nothing in this slice
 * treats an absent control as a permission check.
 *
 * ## Why the ordering controls are buttons in a list rather than drag handles
 *
 * Move-up/move-down works with a pointer, with a keyboard and with a TV remote, which is the whole
 * requirement. Drag-and-drop satisfies only the first, so it could at best be added ALONGSIDE these
 * — never instead of them. The list is a `<ol>` so the order is exposed to assistive technology as
 * an order rather than as a coincidence of layout.
 *
 * Focus follows the pack that moved, not the position it moved into: the viewer's attention is on
 * the pack, and leaving focus on a button that now belongs to a different pack is how a second
 * keypress moves the wrong one.
 */
const ContentPackManagerBar: FC<{ packs: ContentPackDto[] }> = ({ packs }) => {
    const canManage = useContentPackManagement();

    const createMutation = useCreateContentPack();
    const updateMutation = useUpdateContentPack();
    const reorderMutation = useReorderContentPacks();
    const deleteMutation = useDeleteContentPack();

    const [isCreateOpen, setCreateOpen] = useState(false);
    const [renaming, setRenaming] = useState<ContentPackDto | null>(null);
    const [deleting, setDeleting] = useState<ContentPackDto | null>(null);

    /** Where focus must return once a dialog closes. */
    const restoreFocusTo = useRef<HTMLElement | null>(null);
    /**
     * Which pack's move control should hold focus after a reorder, and where it started.
     *
     * `fromIndex` is not decoration. A reorder is not optimistic: the request goes out, the list is
     * re-read, and only then does the pack occupy its new position. Without the index, the effect
     * below fires on the render that merely SET this state — before the list has changed — reads
     * the control's `disabled` from the OLD position, decides it is still enabled, focuses it and
     * clears itself. When the new list then arrives and that control becomes disabled, the browser
     * drops focus to the document body and nothing is left to catch it. Measured, not theorised:
     * moving a pack to the last position lost focus entirely.
     */
    const [focusMoved, setFocusMoved] = useState<{
        packId: string;
        direction: 'up' | 'down';
        fromIndex: number;
    } | null>(null);
    const moveButtons = useRef(new Map<string, HTMLButtonElement>());

    useEffect(() => {
        if (!focusMoved) return;

        const index = packs.findIndex((pack) => pack.Id === focusMoved.packId);
        // The pack is gone (deleted underneath us): there is nothing to follow.
        if (index === -1) {
            setFocusMoved(null);
            return;
        }
        // The server's answer has not arrived yet. Wait for the list that actually moved it,
        // rather than acting on the positions this render still shows.
        if (index === focusMoved.fromIndex) return;

        const button = moveButtons.current.get(
            `${focusMoved.packId}:${focusMoved.direction}`
        );
        /*
         * A pack that moved to the first or last position loses the control that moved it — it is
         * disabled there. Focus then goes to its sibling control, which is the one that can undo
         * the move, rather than being dropped to the document body.
         */
        const fallback = moveButtons.current.get(
            `${focusMoved.packId}:${focusMoved.direction === 'up' ? 'down' : 'up'}`
        );
        const target = button?.disabled ? fallback : button;
        target?.focus();
        setFocusMoved(null);
    }, [focusMoved, packs]);

    /*
     * A reorder that FAILED never moves the pack, so the effect above would wait forever. The
     * pending intent is dropped instead: focus stays on the control the viewer pressed, which is
     * the truthful place for it when nothing happened.
     */
    useEffect(() => {
        if (reorderMutation.isError) setFocusMoved(null);
    }, [reorderMutation.isError]);

    const closeDialogs = useCallback(() => {
        setCreateOpen(false);
        setRenaming(null);
        setDeleting(null);
        createMutation.reset();
        updateMutation.reset();
        deleteMutation.reset();
        restoreFocusTo.current?.focus();
    }, [createMutation, updateMutation, deleteMutation]);

    const onCreate = useCallback(
        (values: ContentPackFormValues) =>
            createMutation.mutate(values, { onSuccess: closeDialogs }),
        [createMutation, closeDialogs]
    );

    const onRename = useCallback(
        (values: ContentPackFormValues) => {
            if (!renaming?.Id) return;
            updateMutation.mutate(
                { packId: renaming.Id, body: values },
                { onSuccess: closeDialogs }
            );
        },
        [renaming, updateMutation, closeDialogs]
    );

    const onDelete = useCallback(() => {
        if (!deleting?.Id) return;
        deleteMutation.mutate(deleting.Id, { onSuccess: closeDialogs });
    }, [deleting, deleteMutation, closeDialogs]);

    const onMove = useCallback(
        (index: number, direction: 'up' | 'down') => {
            const ids = packs.map((pack) => pack.Id ?? '');
            const next =
                direction === 'up' ? moveUp(ids, index) : moveDown(ids, index);
            if (next === ids) return;
            setFocusMoved({ packId: ids[index], direction, fromIndex: index });
            // The WHOLE ordering, every id exactly once. There is no per-pack move endpoint.
            reorderMutation.mutate(next);
        },
        [packs, reorderMutation]
    );

    if (!canManage) return null;

    return (
        <div className='rf-content-pack-controls' data-content-packs='manager'>
            <button
                type='button'
                className='rf-content-pack-control'
                data-content-packs='create'
                onClick={(event) => {
                    restoreFocusTo.current = event.currentTarget;
                    setCreateOpen(true);
                }}
            >
                {globalize.translate('HeaderNewContentPack')}
            </button>

            {packs.length > 0 && (
                <ol
                    className='rf-content-pack-manage-list'
                    data-content-packs='manage-list'
                    aria-label={globalize.translate('HeaderManageContentPacks')}
                >
                    {packs.map((pack, index) => {
                        const packId = pack.Id ?? '';
                        return (
                            <li
                                key={packId}
                                className='rf-content-pack-manage-item'
                                data-content-packs='manage-item'
                            >
                                <span
                                    className='rf-content-pack-manage-name'
                                    data-content-packs='manage-name'
                                >
                                    {pack.Name}
                                </span>
                                <button
                                    type='button'
                                    className='rf-content-pack-control'
                                    data-content-packs='move-up'
                                    aria-label={`${globalize.translate('ContentPackMoveUp')}: ${pack.Name}`}
                                    disabled={index === 0}
                                    ref={(node) => {
                                        if (node) {
                                            moveButtons.current.set(
                                                `${packId}:up`,
                                                node
                                            );
                                        } else {
                                            moveButtons.current.delete(
                                                `${packId}:up`
                                            );
                                        }
                                    }}
                                    onClick={() => onMove(index, 'up')}
                                >
                                    {globalize.translate('ContentPackMoveUp')}
                                </button>
                                <button
                                    type='button'
                                    className='rf-content-pack-control'
                                    data-content-packs='move-down'
                                    aria-label={`${globalize.translate('ContentPackMoveDown')}: ${pack.Name}`}
                                    disabled={index === packs.length - 1}
                                    ref={(node) => {
                                        if (node) {
                                            moveButtons.current.set(
                                                `${packId}:down`,
                                                node
                                            );
                                        } else {
                                            moveButtons.current.delete(
                                                `${packId}:down`
                                            );
                                        }
                                    }}
                                    onClick={() => onMove(index, 'down')}
                                >
                                    {globalize.translate('ContentPackMoveDown')}
                                </button>
                                <button
                                    type='button'
                                    className='rf-content-pack-control'
                                    data-content-packs='rename'
                                    aria-label={`${globalize.translate('ButtonRename')}: ${pack.Name}`}
                                    onClick={(event) => {
                                        restoreFocusTo.current =
                                            event.currentTarget;
                                        setRenaming(pack);
                                    }}
                                >
                                    {globalize.translate('ButtonRename')}
                                </button>
                                <button
                                    type='button'
                                    className='rf-content-pack-control'
                                    data-content-packs='delete'
                                    aria-label={`${globalize.translate('Delete')}: ${pack.Name}`}
                                    onClick={(event) => {
                                        restoreFocusTo.current =
                                            event.currentTarget;
                                        setDeleting(pack);
                                    }}
                                >
                                    {globalize.translate('Delete')}
                                </button>
                            </li>
                        );
                    })}
                </ol>
            )}

            {reorderMutation.isError && (
                <p role='alert' data-content-packs='reorder-error'>
                    {globalize.translate('ErrorDefault')}
                </p>
            )}

            <ContentPackFormDialog
                open={isCreateOpen}
                title={globalize.translate('HeaderNewContentPack')}
                submitLabel={globalize.translate('Add')}
                isPending={createMutation.isPending}
                error={createMutation.error}
                onSubmit={onCreate}
                onClose={closeDialogs}
            />

            <ContentPackFormDialog
                open={renaming !== null}
                title={globalize.translate('HeaderRenameContentPack')}
                submitLabel={globalize.translate('Save')}
                initialName={renaming?.Name ?? ''}
                initialDescription={renaming?.Description ?? ''}
                isPending={updateMutation.isPending}
                error={updateMutation.error}
                onSubmit={onRename}
                onClose={closeDialogs}
            />

            <ContentPackDeleteDialog
                open={deleting !== null}
                packName={deleting?.Name ?? ''}
                isPending={deleteMutation.isPending}
                isError={deleteMutation.isError}
                onConfirm={onDelete}
                onClose={closeDialogs}
            />
        </div>
    );
};

export default ContentPackManagerBar;
