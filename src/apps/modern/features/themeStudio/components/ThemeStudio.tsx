import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { type FC, useCallback, useRef, useState } from 'react';

import { useThemeStudio } from '../useThemeStudio';

import { PresentationEditor } from './PresentationEditor';
import {
    PreviewCanvas,
    type PreviewProfile,
    type PreviewSurface
} from './PreviewCanvas';
import { TokenEditor, TokenEditorLegend } from './TokenEditor';

import './ThemeStudio.scss';

const PROFILES: { id: PreviewProfile; label: string }[] = [
    { id: 'pointer', label: 'Desktop / pointer' },
    { id: 'touch', label: 'Mobile / touch' },
    { id: 'remote', label: 'TV / remote' }
];

const SURFACES: { id: PreviewSurface; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'library', label: 'Library' },
    { id: 'itemDetails', label: 'Item details' }
];

/**
 * The Theme Studio alpha.
 *
 * The whole path, in one screen: start from an official theme → edit a local draft → see it under
 * three interaction profiles and four accessibility states → validate → export or import → apply
 * explicitly.
 *
 * Two things it deliberately does not do. It does not write to the server or require an account:
 * everything here is `localStorage` and a file the browser hands you. And it does not change the
 * active theme as a side effect of editing — Apply is a button, pressed on purpose, disabled while
 * the draft has a validation issue.
 */
export const ThemeStudio: FC = () => {
    const [mode, setMode] = useState<'light' | 'dark'>('dark');
    const [profile, setProfile] = useState<PreviewProfile>('pointer');
    const [surface, setSurface] = useState<PreviewSurface>('home');
    const [reducedMotion, setReducedMotion] = useState(false);
    const [reducedTransparency, setReducedTransparency] = useState(false);
    const [newName, setNewName] = useState('My theme');

    const fileInput = useRef<HTMLInputElement>(null);

    const {
        sources,
        state,
        dispatch,
        start,
        importDraft,
        exportDraft,
        apply,
        revert,
        discard
    } = useThemeStudio(mode);

    const handleExport = useCallback(() => {
        const text = exportDraft();
        if (!text) return;
        // A Blob and an object URL: no server round-trip, so export works with no connection at all.
        const url = URL.createObjectURL(
            new Blob([text], { type: 'application/json' })
        );
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${state.draft?.manifest.id ?? 'theme'}.tesserafin-theme.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    }, [exportDraft, state.draft]);

    const handleImportFile = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;
            importDraft(await file.text());
            // Cleared so re-choosing the same file fires `change` again.
            event.target.value = '';
        },
        [importDraft]
    );

    return (
        <Stack spacing={3} className='rf-theme-studio'>
            <Stack spacing={1}>
                <Typography variant='h2'>Theme Studio</Typography>
                <Typography variant='body2' color='text.secondary'>
                    Create a local theme from Tesserafin Classic or Tesserafin
                    Glass. Nothing here needs an account or a server connection,
                    and your active theme does not change until you press Apply.
                </Typography>
            </Stack>

            {state.persistenceFailed && (
                <Alert severity='warning'>
                    This draft cannot be saved locally — browser storage is full
                    or unavailable. Editing still works, but the draft will be
                    lost on reload. Export it to keep it.
                </Alert>
            )}

            {state.importIssues.length > 0 && (
                <Alert
                    severity='error'
                    data-testid='theme-studio-import-errors'
                >
                    <AlertTitle>That file was not imported</AlertTitle>
                    <ul>
                        {state.importIssues.map((issue) => (
                            <li
                                key={`${issue.code}-${issue.path}-${issue.message}`}
                            >
                                {issue.message}
                            </li>
                        ))}
                    </ul>
                    Your current draft is untouched.
                </Alert>
            )}

            {!state.draft ? (
                <Stack spacing={2} className='rf-theme-studio__start'>
                    <Typography variant='h3'>Start a new theme</Typography>
                    <TextField
                        label='Theme name'
                        size='small'
                        value={newName}
                        onChange={(event) => setNewName(event.target.value)}
                    />
                    <Stack direction='row' spacing={2} flexWrap='wrap'>
                        {sources.map((source) => (
                            <Button
                                key={source.id}
                                variant='contained'
                                onClick={() =>
                                    start(source.id, newName, 'Local author')
                                }
                            >
                                Copy {source.name}
                            </Button>
                        ))}
                        <Button
                            variant='outlined'
                            onClick={() => fileInput.current?.click()}
                        >
                            Import a draft
                        </Button>
                    </Stack>
                    <Typography variant='body2' color='text.secondary'>
                        The official theme is copied, never modified.
                    </Typography>
                </Stack>
            ) : (
                <div className='rf-theme-studio__layout'>
                    <section
                        className='rf-theme-studio__editor'
                        aria-label='Theme editor'
                    >
                        <Stack spacing={2}>
                            <Stack direction='row' spacing={1} flexWrap='wrap'>
                                <Button
                                    onClick={() => dispatch({ type: 'undo' })}
                                    disabled={!state.canUndo}
                                >
                                    Undo
                                </Button>
                                <Button
                                    onClick={() => dispatch({ type: 'redo' })}
                                    disabled={!state.canRedo}
                                >
                                    Redo
                                </Button>
                                <Button
                                    onClick={() => dispatch({ type: 'reset' })}
                                    disabled={!state.dirty}
                                >
                                    Reset
                                </Button>
                                <Button onClick={handleExport}>Export</Button>
                                <Button
                                    onClick={() => fileInput.current?.click()}
                                >
                                    Import
                                </Button>
                                <Button color='error' onClick={discard}>
                                    Discard draft
                                </Button>
                            </Stack>

                            <Typography variant='body2' color='text.secondary'>
                                Based on {state.draft.basedOn.name}{' '}
                                {state.draft.basedOn.version} · id{' '}
                                <code>{state.draft.manifest.id}</code>
                            </Typography>

                            {state.issues.length > 0 && (
                                <Alert
                                    severity='error'
                                    data-testid='theme-studio-validation'
                                >
                                    <AlertTitle>
                                        {state.issues.length} value
                                        {state.issues.length === 1 ? '' : 's'}{' '}
                                        cannot be applied yet
                                    </AlertTitle>
                                    <ul>
                                        {state.issues
                                            .slice(0, 8)
                                            .map((issue) => (
                                                <li
                                                    key={`${issue.path}-${issue.message}`}
                                                >
                                                    {issue.message}
                                                </li>
                                            ))}
                                    </ul>
                                </Alert>
                            )}

                            {state.resolution &&
                                !state.resolution.activatable && (
                                    <Alert
                                        severity='error'
                                        data-testid='theme-studio-required-unsupported'
                                    >
                                        <AlertTitle>
                                            This theme cannot be applied to the
                                            Web renderer
                                        </AlertTitle>
                                        <p>
                                            {`It lists ${state.resolution.missingRequired
                                                .map(
                                                    (capability) =>
                                                        `"${capability}"`
                                                )
                                                .join(
                                                    ', '
                                                )} under "capabilities.required", and this renderer does not implement it. A required capability is a refusal, not a downgrade — falling back would render a theme its author did not design.`}
                                        </p>
                                        <p>
                                            Move it to{' '}
                                            <code>capabilities.optional</code>{' '}
                                            to let it fall back to the platform
                                            default here while still being
                                            honoured by a renderer that
                                            implements it.
                                        </p>
                                    </Alert>
                                )}

                            {(state.resolution?.fallbacks.length ?? 0) > 0 && (
                                <Alert severity='info'>
                                    <AlertTitle>
                                        Some choices fall back on this renderer
                                    </AlertTitle>
                                    <ul>
                                        {state.resolution?.fallbacks.map(
                                            (fallback) => (
                                                <li key={fallback.capability}>
                                                    <code>
                                                        {fallback.capability}
                                                    </code>{' '}
                                                    is defined by the theme
                                                    contract but not yet
                                                    implemented by the Web
                                                    renderer, so the platform
                                                    default is used.
                                                </li>
                                            )
                                        )}
                                    </ul>
                                </Alert>
                            )}

                            <Divider />
                            <TokenEditorLegend />
                            <TokenEditor
                                tokens={state.draft.tokens}
                                onChange={(path, value) =>
                                    dispatch({ type: 'set-token', path, value })
                                }
                            />
                            <Divider />
                            <PresentationEditor
                                presentation={
                                    state.draft.manifest.presentation ?? {}
                                }
                                onChange={(presentation) =>
                                    dispatch({
                                        type: 'set-presentation',
                                        presentation
                                    })
                                }
                            />
                        </Stack>
                    </section>

                    <section
                        className='rf-theme-studio__preview'
                        aria-label='Theme preview'
                    >
                        <Stack spacing={2}>
                            <Stack direction='row' spacing={2} flexWrap='wrap'>
                                <FormControl
                                    size='small'
                                    sx={{ minWidth: 180 }}
                                >
                                    <InputLabel id='studio-profile'>
                                        Preview profile
                                    </InputLabel>
                                    <Select
                                        labelId='studio-profile'
                                        label='Preview profile'
                                        value={profile}
                                        onChange={(event) =>
                                            setProfile(
                                                event.target
                                                    .value as PreviewProfile
                                            )
                                        }
                                    >
                                        {PROFILES.map((item) => (
                                            <MenuItem
                                                key={item.id}
                                                value={item.id}
                                            >
                                                {item.label}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                <FormControl
                                    size='small'
                                    sx={{ minWidth: 150 }}
                                >
                                    <InputLabel id='studio-surface'>
                                        Screen
                                    </InputLabel>
                                    <Select
                                        labelId='studio-surface'
                                        label='Screen'
                                        value={surface}
                                        onChange={(event) =>
                                            setSurface(
                                                event.target
                                                    .value as PreviewSurface
                                            )
                                        }
                                    >
                                        {SURFACES.map((item) => (
                                            <MenuItem
                                                key={item.id}
                                                value={item.id}
                                            >
                                                {item.label}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                <FormControl
                                    size='small'
                                    sx={{ minWidth: 130 }}
                                >
                                    <InputLabel id='studio-mode'>
                                        Mode
                                    </InputLabel>
                                    <Select
                                        labelId='studio-mode'
                                        label='Mode'
                                        value={mode}
                                        onChange={(event) =>
                                            setMode(
                                                event.target.value as
                                                    | 'light'
                                                    | 'dark'
                                            )
                                        }
                                    >
                                        <MenuItem value='dark'>Dark</MenuItem>
                                        <MenuItem value='light'>Light</MenuItem>
                                    </Select>
                                </FormControl>
                            </Stack>

                            <Stack direction='row' spacing={2} flexWrap='wrap'>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={reducedMotion}
                                            onChange={(event) =>
                                                setReducedMotion(
                                                    event.target.checked
                                                )
                                            }
                                        />
                                    }
                                    label='Reduced motion'
                                />
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={reducedTransparency}
                                            onChange={(event) =>
                                                setReducedTransparency(
                                                    event.target.checked
                                                )
                                            }
                                        />
                                    }
                                    label='Reduced transparency'
                                />
                            </Stack>

                            {state.resolution && (
                                <PreviewCanvas
                                    draft={state.draft}
                                    presentation={state.resolution.presentation}
                                    profile={profile}
                                    mode={mode}
                                    reducedMotion={reducedMotion}
                                    reducedTransparency={reducedTransparency}
                                    surface={surface}
                                />
                            )}

                            <Stack
                                direction='row'
                                spacing={2}
                                alignItems='center'
                            >
                                <Button
                                    variant='contained'
                                    onClick={apply}
                                    disabled={
                                        state.issues.length > 0 ||
                                        state.resolution?.activatable === false
                                    }
                                    data-testid='theme-studio-apply'
                                >
                                    Apply to Tesserafin
                                </Button>
                                {state.appliedThemeId && (
                                    <Button onClick={revert}>
                                        Stop using this theme
                                    </Button>
                                )}
                                <Typography
                                    variant='body2'
                                    color='text.secondary'
                                >
                                    {state.appliedThemeId
                                        ? `Applied: ${state.appliedThemeId}`
                                        : 'Not applied — the preview above is the only place this draft is visible.'}
                                </Typography>
                            </Stack>
                        </Stack>
                    </section>
                </div>
            )}

            <input
                ref={fileInput}
                type='file'
                accept='application/json,.json'
                hidden
                onChange={handleImportFile}
                data-testid='theme-studio-import-input'
            />
        </Stack>
    );
};

export default ThemeStudio;
