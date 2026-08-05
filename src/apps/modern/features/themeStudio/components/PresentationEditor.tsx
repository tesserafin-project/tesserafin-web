import Alert from '@mui/material/Alert';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { type FC } from 'react';

import {
    WEB_RENDERER_CAPABILITIES,
    type ThemeCapability,
    type ThemePresentation
} from 'themes/platform';

export interface PresentationEditorProps {
    presentation: ThemePresentation;
    onChange: (presentation: ThemePresentation) => void;
}

/**
 * The first bounded set of semantic presentation choices.
 *
 * Every option here is a value from the published `theme.schema.json` vocabulary — not a free-text
 * field, not a class name, not a selector. That is the contract's boundary made visible: an author
 * picks among variants the renderer has agreed to implement, and cannot reach past them into the
 * DOM or into generated MUI classes.
 *
 * Groups whose capability the Web renderer does not implement yet are shown, disabled, with the
 * reason. Hiding them would misrepresent the contract as smaller than it is; showing them enabled
 * would misrepresent the renderer as more capable than it is.
 */
export const PresentationEditor: FC<PresentationEditorProps> = ({
    presentation,
    onChange
}) => {
    const supports = (capability: ThemeCapability) =>
        WEB_RENDERER_CAPABILITIES.includes(capability);

    const setSurface = (key: string, value: string) =>
        onChange({
            ...presentation,
            surface: { ...presentation.surface, [key]: value }
        });

    const setMediaCard = (key: string, value: string) =>
        onChange({
            ...presentation,
            mediaCard: { ...presentation.mediaCard, [key]: value }
        });

    const setNavigation = (key: string, value: string) =>
        onChange({
            ...presentation,
            navigation: { ...presentation.navigation, [key]: value }
        });

    return (
        <Stack spacing={3} data-testid='theme-studio-presentation-editor'>
            <Section title='Surfaces'>
                <Choice
                    label='Treatment'
                    value={presentation.surface?.variant ?? 'opaque'}
                    options={['opaque', 'glass']}
                    onChange={(value) => setSurface('variant', value)}
                />
                <Choice
                    label='Border'
                    value={presentation.surface?.border ?? 'none'}
                    options={['none', 'hairline']}
                    onChange={(value) => setSurface('border', value)}
                />
                <Choice
                    label='Elevation'
                    value={presentation.surface?.elevation ?? 'level1'}
                    options={['level0', 'level1', 'level2', 'level3']}
                    onChange={(value) => setSurface('elevation', value)}
                />
            </Section>

            <Section title='Media cards'>
                <Choice
                    label='Image aspect'
                    value={presentation.mediaCard?.imageAspect ?? 'poster'}
                    options={['poster', 'backdrop', 'square']}
                    onChange={(value) => setMediaCard('imageAspect', value)}
                />
                <Choice
                    label='Title placement'
                    value={presentation.mediaCard?.titlePlacement ?? 'below'}
                    options={['below', 'overlay']}
                    onChange={(value) => setMediaCard('titlePlacement', value)}
                />
                <Choice
                    label='Hover effect'
                    value={presentation.mediaCard?.hoverEffect ?? 'lift'}
                    options={['none', 'lift', 'zoom']}
                    onChange={(value) => setMediaCard('hoverEffect', value)}
                />
                <Choice
                    label='Progress'
                    value={presentation.mediaCard?.progressStyle ?? 'bar'}
                    options={['bar', 'none']}
                    onChange={(value) => setMediaCard('progressStyle', value)}
                />
            </Section>

            <Section title='Navigation'>
                <Choice
                    label='Shell'
                    value={presentation.navigation?.shell ?? 'sidebar'}
                    options={['sidebar', 'rail', 'topbar']}
                    onChange={(value) => setNavigation('shell', value)}
                />
                <Choice
                    label='Labels'
                    value={presentation.navigation?.labels ?? 'always'}
                    options={['always', 'active', 'never']}
                    onChange={(value) => setNavigation('labels', value)}
                />
                <Choice
                    label='Position'
                    value={presentation.navigation?.position ?? 'start'}
                    options={['start', 'end']}
                    onChange={(value) => setNavigation('position', value)}
                />
                <Alert severity='info' variant='outlined'>
                    Navigation presentation changes how navigation looks, never
                    what it contains. Which destinations exist is authorization
                    and library state, and no theme can reach it.
                </Alert>
            </Section>

            <Section title='Page composition'>
                <Alert severity='warning' variant='outlined'>
                    Home, Library and Item Details composition recipes are
                    defined by the contract and <strong>not yet bound</strong>{' '}
                    by the Web renderer. A theme may declare them today; this
                    renderer falls back to the platform default and reports the
                    fallback. Editing them here is disabled until the binding
                    lands, so the Studio does not offer a control that would do
                    nothing.
                </Alert>
                <Choice
                    label='Home sections'
                    value='platform default'
                    options={['platform default']}
                    disabled={!supports('presentation.page.home')}
                    onChange={() => undefined}
                />
            </Section>
        </Stack>
    );
};

const Section: FC<{ title: string; children: React.ReactNode }> = ({
    title,
    children
}) => (
    <Stack spacing={2}>
        <Typography variant='h3' component='h3'>
            {title}
        </Typography>
        {children}
    </Stack>
);

interface ChoiceProps {
    label: string;
    value: string;
    options: readonly string[];
    disabled?: boolean;
    onChange: (value: string) => void;
}

const Choice: FC<ChoiceProps> = ({
    label,
    value,
    options,
    disabled,
    onChange
}) => (
    <FormControl fullWidth size='small' disabled={disabled}>
        <InputLabel id={`presentation-${label}`}>{label}</InputLabel>
        <Select
            labelId={`presentation-${label}`}
            label={label}
            value={value}
            onChange={(event) => onChange(String(event.target.value))}
        >
            {options.map((option) => (
                <MenuItem key={option} value={option}>
                    {option}
                </MenuItem>
            ))}
        </Select>
    </FormControl>
);

export default PresentationEditor;
