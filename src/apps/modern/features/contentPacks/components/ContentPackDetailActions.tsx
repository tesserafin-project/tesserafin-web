import React, { useCallback, useRef, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';

import globalize from 'lib/globalize';

import type { ContentPackDto } from '../adapters/contentPacksApi';
import {
    useDeleteContentPack,
    useUpdateContentPack
} from '../api/useContentPackMutations';
import { useContentPackManagement } from '../hooks/useContentPackManagement';
import ContentPackDeleteDialog from './ContentPackDeleteDialog';
import ContentPackFormDialog, {
    type ContentPackFormValues
} from './ContentPackFormDialog';

import './contentPackControls.scss';

/**
 * The route a delete returns to, and the state it hands over.
 *
 * Spelled here rather than at the call site so the mosaic and this component cannot disagree about
 * either. `contentPackHref()` builds the *hash* form for an anchor; `useNavigate` takes the
 * router path, which is the same location expressed the way the router names it.
 */
export const CONTENT_PACKS_LIST_PATH = '/contentpacks';

/** Handed to the list route so it can put focus somewhere meaningful and say what happened. */
export interface ContentPackDeletedState {
    contentPackDeleted: string;
}

export const isContentPackDeletedState = (
    state: unknown
): state is ContentPackDeletedState =>
    typeof (state as ContentPackDeletedState | null)?.contentPackDeleted ===
    'string';

/**
 * Rename and delete for the pack the detail route is showing (#138 §7).
 *
 * ## Why this is not a second management system
 *
 * It renders the SAME `ContentPackFormDialog` under the same `HeaderRenameContentPack` title, the
 * SAME `ContentPackDeleteDialog` with the same seven-part `ContentPackDeleteScope` sentence, and
 * calls the SAME `useUpdateContentPack` / `useDeleteContentPack` mutations with the same cache
 * frontier as the mosaic's manager bar. What it adds is one thing the mosaic does not need: the
 * surface being managed IS the surface being viewed, so a successful delete has to leave the route.
 *
 * ## Rename leaves identity alone
 *
 * Nothing here navigates on a rename and nothing re-keys anything. `useUpdateContentPack` takes the
 * `packId` from the request and seeds `detail` with the server's response, so the heading and the
 * list both come from that response while the URL, the opaque id, the membership and the ordering
 * are untouched — a rename is a change of one field, not a change of what is being looked at.
 *
 * ## Delete leaves the route, once
 *
 * `replace: true`, so the deleted URL is not left in history for a back gesture to return to. The
 * mutation's own `onSuccess` has already removed that pack's cached `detail` and every cached page
 * of its `items`, so a viewer who types the URL again gets a fresh request and the server's answer
 * — never the copy that was on screen a moment ago.
 *
 * On FAILURE nothing navigates: the pack still exists, the dialog stays open with its error, and
 * the detail route keeps showing the pack it was showing.
 *
 * ## The gate
 *
 * `useContentPackManagement()` — `EnableContentPackManagement === true`, and nothing else. A
 * non-manager's DOM contains neither control, exactly as on the mosaic. That is a courtesy: the
 * server refuses the write either way.
 */
const ContentPackDetailActions: FC<{ pack: ContentPackDto }> = ({ pack }) => {
    const canManage = useContentPackManagement();
    const navigate = useNavigate();

    const updateMutation = useUpdateContentPack();
    const deleteMutation = useDeleteContentPack();

    const [isRenaming, setRenaming] = useState(false);
    const [isDeleting, setDeleting] = useState(false);

    /** Where focus returns when a dialog is dismissed without leaving the route. */
    const restoreFocusTo = useRef<HTMLElement | null>(null);

    const closeDialogs = useCallback(() => {
        setRenaming(false);
        setDeleting(false);
        updateMutation.reset();
        deleteMutation.reset();
        restoreFocusTo.current?.focus();
    }, [updateMutation, deleteMutation]);

    const onRename = useCallback(
        (values: ContentPackFormValues) => {
            if (!pack.Id) return;
            updateMutation.mutate(
                { packId: pack.Id, body: values },
                { onSuccess: closeDialogs }
            );
        },
        [pack.Id, updateMutation, closeDialogs]
    );

    const onDelete = useCallback(() => {
        if (!pack.Id) return;
        deleteMutation.mutate(pack.Id, {
            /*
             * No `closeDialogs()` here. This component unmounts with the route, and setting state
             * on the way out would be a no-op at best. The navigation IS the close.
             */
            onSuccess: () =>
                navigate(CONTENT_PACKS_LIST_PATH, {
                    replace: true,
                    state: {
                        contentPackDeleted: pack.Name ?? ''
                    } satisfies ContentPackDeletedState
                })
        });
    }, [pack.Id, pack.Name, deleteMutation, navigate]);

    if (!canManage) return null;

    return (
        <div
            className='rf-content-pack-controls'
            data-content-packs='detail-manager'
        >
            <button
                type='button'
                className='rf-content-pack-control'
                data-content-packs='detail-rename'
                aria-label={`${globalize.translate('ButtonRename')}: ${pack.Name ?? ''}`}
                onClick={(event) => {
                    restoreFocusTo.current = event.currentTarget;
                    setRenaming(true);
                }}
            >
                {globalize.translate('ButtonRename')}
            </button>
            <button
                type='button'
                className='rf-content-pack-control'
                data-content-packs='detail-delete'
                aria-label={`${globalize.translate('Delete')}: ${pack.Name ?? ''}`}
                onClick={(event) => {
                    restoreFocusTo.current = event.currentTarget;
                    setDeleting(true);
                }}
            >
                {globalize.translate('Delete')}
            </button>

            <ContentPackFormDialog
                open={isRenaming}
                title={globalize.translate('HeaderRenameContentPack')}
                submitLabel={globalize.translate('Save')}
                initialName={pack.Name ?? ''}
                initialDescription={pack.Description ?? ''}
                isPending={updateMutation.isPending}
                error={updateMutation.error}
                onSubmit={onRename}
                onClose={closeDialogs}
            />

            <ContentPackDeleteDialog
                open={isDeleting}
                packName={pack.Name ?? ''}
                isPending={deleteMutation.isPending}
                isError={deleteMutation.isError}
                onConfirm={onDelete}
                onClose={closeDialogs}
            />
        </div>
    );
};

export default ContentPackDetailActions;
