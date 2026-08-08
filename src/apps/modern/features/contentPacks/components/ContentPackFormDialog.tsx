import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import React, {
    useEffect,
    useId,
    useState,
    type FC,
    type FormEvent
} from 'react';

import globalize from 'lib/globalize';

import { isNameConflictError } from '../utils/contentPackWriteErrors';

export interface ContentPackFormValues {
    Name: string;
    Description?: string | null;
}

export interface ContentPackFormDialogProps {
    open: boolean;
    /** Dialog heading. Create and rename are the same form under two titles. */
    title: string;
    submitLabel: string;
    initialName?: string;
    initialDescription?: string | null;
    isPending: boolean;
    error: unknown;
    onSubmit: (values: ContentPackFormValues) => void;
    onClose: () => void;
}

/**
 * The create/rename form (#138 §7).
 *
 * One component for both, because they are the same form: a name, an optional description, and a
 * submit. Splitting them would put the trimming rule, the conflict message and the pending state in
 * two places that could disagree.
 *
 * ## What is validated here, and what is not
 *
 * Exactly one thing: a name that is empty after trimming is not submitted, because sending it would
 * spend a round-trip to be told what the form already knows. LENGTH is deliberately NOT checked
 * here — the server owns that rule, and a client copy of it would be a second, silently divergent
 * limit. A rejected length arrives as a `400` and is shown inline, in the dialog, with the field
 * still focused and the typed value still there.
 *
 * A duplicate name arrives as a `409` and gets its own message, because "that name is taken" is
 * actionable in a way that "there was an error" is not.
 */
const ContentPackFormDialog: FC<ContentPackFormDialogProps> = ({
    open,
    title,
    submitLabel,
    initialName = '',
    initialDescription = '',
    isPending,
    error,
    onSubmit,
    onClose
}) => {
    const nameId = useId();
    const descriptionId = useId();
    const errorId = useId();
    const [name, setName] = useState(initialName);
    const [description, setDescription] = useState(initialDescription ?? '');
    const [touched, setTouched] = useState(false);

    // Re-seed whenever the dialog is opened for a different pack: a rename dialog reused for a
    // second pack must show that pack's name, not the previous one's.
    useEffect(() => {
        if (open) {
            setName(initialName);
            setDescription(initialDescription ?? '');
            setTouched(false);
        }
    }, [open, initialName, initialDescription]);

    const trimmed = name.trim();
    const isEmpty = trimmed.length === 0;

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (isEmpty || isPending) return;
        onSubmit({
            Name: trimmed,
            // An empty description is sent as `null`, not as `''`: "no description" is a value the
            // server understands, and an empty string would be a description that renders as blank.
            Description: description.trim() === '' ? null : description.trim()
        });
    };

    let message: string | null = null;
    if (touched && isEmpty) {
        message = globalize.translate('MessageContentPackNameRequired');
    } else if (isNameConflictError(error)) {
        message = globalize.translate('MessageContentPackNameConflict');
    } else if (error) {
        message = globalize.translate('ErrorDefault');
    }

    return (
        <Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <form onSubmit={handleSubmit} data-content-packs='form'>
                <DialogContent>
                    <label htmlFor={nameId}>
                        {globalize.translate('LabelName')}
                    </label>
                    <input
                        id={nameId}
                        name='contentPackName'
                        type='text'
                        value={name}
                        autoFocus
                        // The one client-side rule, stated to assistive technology as well as
                        // enforced in the submit handler.
                        required
                        aria-invalid={touched && isEmpty}
                        aria-describedby={message ? errorId : undefined}
                        onChange={(event) => setName(event.target.value)}
                    />

                    <label htmlFor={descriptionId}>
                        {globalize.translate('LabelContentPackDescription')}
                    </label>
                    <textarea
                        id={descriptionId}
                        name='contentPackDescription'
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                    />

                    {message && (
                        <p
                            id={errorId}
                            role='alert'
                            data-content-packs='form-error'
                        >
                            {message}
                        </p>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} variant='text' type='button'>
                        {globalize.translate('ButtonCancel')}
                    </Button>
                    <Button type='submit' disabled={isPending}>
                        {submitLabel}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default ContentPackFormDialog;
