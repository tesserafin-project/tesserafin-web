import Alert from '@mui/material/Alert';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { type FC, useMemo } from 'react';

import { explainTokenValue } from 'themes/platform/validateTokens';
import type { TesserafinTokens } from 'ui/tokens/types';

import { toTokenFields, type TokenField } from '../tokenModel';

export interface TokenEditorProps {
    tokens: TesserafinTokens;
    onChange: (path: string, value: string | number) => void;
}

/**
 * Edits every token family, generated from the token document rather than hand-listed.
 *
 * A hand-written form would be a second, silent definition of "which tokens exist": add a token to
 * `tokens.schema.json` and the theme would carry it while the editor pretended it did not. Deriving
 * the fields means the editor is complete by construction — which is also why there is no "advanced
 * / raw JSON" escape hatch here. There is nothing it could reach that the fields do not.
 *
 * Validation is per field and explains the constraint, because "invalid" on its own tells an author
 * nothing: a length needs a unit, a duration needs ms or s, a colour needs a recognised notation.
 * The message names which.
 */
export const TokenEditor: FC<TokenEditorProps> = ({ tokens, onChange }) => {
    const groups = useMemo(() => {
        const byGroup = new Map<string, TokenField[]>();
        for (const field of toTokenFields(tokens)) {
            const bucket = byGroup.get(field.group) ?? [];
            bucket.push(field);
            byGroup.set(field.group, bucket);
        }
        return [...byGroup.entries()];
    }, [tokens]);

    return (
        <Stack spacing={1} data-testid='theme-studio-token-editor'>
            {groups.map(([group, fields], index) => {
                const invalidCount = fields.filter(
                    (field) =>
                        explainTokenValue(field.kind, field.value) !== null
                ).length;

                return (
                    <Accordion key={group} defaultExpanded={index === 0}>
                        <AccordionSummary>
                            <Typography component='span'>
                                {group}
                                {invalidCount > 0 &&
                                    ` — ${invalidCount} invalid`}
                            </Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Stack spacing={2}>
                                {fields.map((field) => (
                                    <TokenInput
                                        key={field.path}
                                        field={field}
                                        onChange={onChange}
                                    />
                                ))}
                            </Stack>
                        </AccordionDetails>
                    </Accordion>
                );
            })}
        </Stack>
    );
};

interface TokenInputProps {
    field: TokenField;
    onChange: (path: string, value: string | number) => void;
}

const TokenInput: FC<TokenInputProps> = ({ field, onChange }) => {
    const error = explainTokenValue(field.kind, field.value);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value;
        // An out-of-range or non-numeric weight is kept as typed rather than coerced, so the field
        // can explain the constraint instead of silently substituting a value nobody asked for.
        const next =
            field.kind === 'weight' &&
            raw.trim() !== '' &&
            !Number.isNaN(Number(raw))
                ? Number(raw)
                : raw;
        onChange(field.path, next);
    };

    return (
        <Stack direction='row' spacing={1} alignItems='flex-start'>
            {field.kind === 'color' && (
                <input
                    type='color'
                    aria-label={`${field.label} colour picker`}
                    // A native colour input only understands #rrggbb, so it shows black for an
                    // rgba() token. It is an accelerator beside the text field, never the source of
                    // truth — the text field below is what holds the token's real value.
                    value={
                        /^#[0-9a-fA-F]{6}$/.test(String(field.value))
                            ? String(field.value)
                            : '#000000'
                    }
                    onChange={handleChange}
                    style={{
                        width: 44,
                        height: 44,
                        marginTop: 8,
                        border: 'none',
                        background: 'none'
                    }}
                />
            )}
            <TextField
                fullWidth
                size='small'
                label={field.label}
                name={field.path}
                value={String(field.value)}
                onChange={handleChange}
                error={error !== null}
                helperText={error ?? field.path}
                slotProps={{ htmlInput: { 'data-token-path': field.path } }}
            />
        </Stack>
    );
};

export const TokenEditorLegend: FC = () => (
    <Alert severity='info' variant='outlined'>
        Every field is a token from the published contract. A theme cannot set
        anything that is not here — that closure is what makes an imported theme
        safe to apply.
    </Alert>
);

export default TokenEditor;
