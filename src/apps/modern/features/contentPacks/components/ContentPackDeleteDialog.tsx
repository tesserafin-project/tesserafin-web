import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

export interface ContentPackDeleteDialogProps {
    open: boolean;
    packName: string;
    isPending: boolean;
    isError: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

/**
 * The delete confirmation (#138 §7).
 *
 * The scope sentence is not decoration. Deleting a *pack* looks, to a viewer who has just organised
 * their library into packs, exactly like deleting the things in it — and the one thing a
 * confirmation must never be is ambiguous about what disappears. So the copy states, in one
 * sentence, every fact the requirement enumerates: the pack goes, its membership links go, and no
 * media, no file, no metadata, no collection and no library is touched.
 *
 * The dialog stays truthful on failure: the pack still exists, so the dialog stays open, the
 * confirm button becomes available again, and the error is shown rather than the dialog closing as
 * though the delete had happened.
 */
const ContentPackDeleteDialog: FC<ContentPackDeleteDialogProps> = ({
    open,
    packName,
    isPending,
    isError,
    onConfirm,
    onClose
}) => (
    <Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
        <DialogTitle>
            {globalize.translate('HeaderDeleteContentPack')}
        </DialogTitle>
        <DialogContent>
            <DialogContentText data-content-packs='delete-target'>
                {packName}
            </DialogContentText>
            <DialogContentText data-content-packs='delete-scope'>
                {globalize.translate('ContentPackDeleteScope')}
            </DialogContentText>
            {isError && (
                <DialogContentText
                    role='alert'
                    data-content-packs='delete-error'
                >
                    {globalize.translate('ErrorDefault')}
                </DialogContentText>
            )}
        </DialogContent>
        <DialogActions>
            <Button onClick={onClose} variant='text'>
                {globalize.translate('ButtonCancel')}
            </Button>
            <Button onClick={onConfirm} disabled={isPending}>
                {globalize.translate('Delete')}
            </Button>
        </DialogActions>
    </Dialog>
);

export default ContentPackDeleteDialog;
