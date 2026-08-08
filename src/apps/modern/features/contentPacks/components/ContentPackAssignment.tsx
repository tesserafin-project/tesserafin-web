import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import React, { type FC, useMemo } from 'react';

import globalize from 'lib/globalize';
import { ErrorState, LoadingState } from 'ui';

import {
    useAddContentPackItem,
    useRemoveContentPackItem
} from '../api/useContentPackMutations';
import {
    useContentPacks,
    useContentPacksForItem
} from '../api/useContentPackQueries';

export interface ContentPackAssignmentProps {
    open: boolean;
    itemId: string;
    onClose: () => void;
}

/**
 * "Which content packs is this item in?" — the one authorized M2 affordance on Item Details
 * (#138 §8).
 *
 * ## Membership across ALL accessible packs, not just the ones it is in
 *
 * The dialog lists every pack the user may see (`getContentPacks`) and marks the ones this item is
 * in (`getContentPacksForItem`). Listing only the memberships would make "add to a pack" impossible
 * without a second surface, and listing only the packs would make the current state invisible.
 *
 * ## One checkbox per pack, and nothing shared between them
 *
 * Each row's toggle sends exactly one add or one remove, for exactly one `(pack, item)` pair. That
 * is what makes "add to several packs" and "remove from one without disturbing the others" true by
 * construction rather than by a diffing algorithm that has to be got right.
 *
 * A repeated add is a successful no-op at the server, so a row that is already a member does not
 * pre-check anything before sending — see the adapter's note on composite uniqueness.
 *
 * ## Nothing here is a permission check
 *
 * The component is only rendered when `EnableContentPackManagement` is true, and the caller does
 * that gating. The server still refuses an unauthorized write either way.
 */
const ContentPackAssignment: FC<ContentPackAssignmentProps> = ({
    open,
    itemId,
    onClose
}) => {
    // Both reads are switched off entirely while the dialog is closed: an affordance that is not on
    // screen must not be issuing requests behind it.
    const packsQuery = useContentPacks({ enabled: open });
    const membershipQuery = useContentPacksForItem(itemId, { enabled: open });
    const addMutation = useAddContentPackItem();
    const removeMutation = useRemoveContentPackItem();

    const memberIds = useMemo(
        () =>
            new Set((membershipQuery.data ?? []).map((pack) => pack.Id ?? '')),
        [membershipQuery.data]
    );

    const isPending =
        (open && membershipQuery.isPending) || packsQuery.isPending;
    const isError = membershipQuery.isError || packsQuery.isError;
    const isWriting = addMutation.isPending || removeMutation.isPending;
    const hasWriteFailed = addMutation.isError || removeMutation.isError;

    const renderBody = () => {
        if (isPending) {
            return (
                <LoadingState
                    variant='block'
                    label={globalize.translate('HeaderContentPackAssign')}
                />
            );
        }

        if (isError) {
            return <ErrorState message={globalize.translate('ErrorDefault')} />;
        }

        const packs = packsQuery.data ?? [];
        if (packs.length === 0) {
            return <p>{globalize.translate('MessageNoContentPacks')}</p>;
        }

        return (
            <ul data-content-packs='assign-list'>
                {packs.map((pack) => {
                    const packId = pack.Id ?? '';
                    const isMember = memberIds.has(packId);
                    return (
                        <li key={packId} data-content-packs='assign-item'>
                            <label>
                                <input
                                    type='checkbox'
                                    data-content-packs='assign-toggle'
                                    data-pack-id={packId}
                                    checked={isMember}
                                    disabled={isWriting}
                                    aria-label={
                                        isMember
                                            ? `${globalize.translate('ContentPackAssignRemove')}: ${pack.Name}`
                                            : `${globalize.translate('ContentPackAssignAdd')}: ${pack.Name}`
                                    }
                                    onChange={() => {
                                        const membership = { packId, itemId };
                                        if (isMember) {
                                            removeMutation.mutate(membership);
                                        } else {
                                            addMutation.mutate(membership);
                                        }
                                    }}
                                />
                                {pack.Name}
                            </label>
                        </li>
                    );
                })}
            </ul>
        );
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
            <DialogTitle>
                {globalize.translate('HeaderContentPackAssign')}
            </DialogTitle>
            <DialogContent>
                {renderBody()}
                {isWriting && (
                    <p role='status' data-content-packs='assign-pending'>
                        {globalize.translate('HeaderContentPackAssign')}
                    </p>
                )}
                {hasWriteFailed && (
                    <p role='alert' data-content-packs='assign-error'>
                        {globalize.translate('ErrorDefault')}
                    </p>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default ContentPackAssignment;
