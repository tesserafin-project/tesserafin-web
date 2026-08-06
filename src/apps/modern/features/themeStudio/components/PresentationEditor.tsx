import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { type FC } from 'react';

import {
    WEB_RENDERED_HOME_SECTIONS,
    WEB_UNRENDERED_HOME_SECTIONS
} from 'apps/modern/features/home/utils/homeRecipe';
/*
 * The Library value lists come from the LIVE ROUTE's recipe module, not from a second copy typed
 * here. That import is the mechanism behind "never offer a value the route silently ignores": the
 * Studio can only offer what `apps/modern/features/library` composes from, and a value added or
 * removed there changes this control in the same commit.
 */
import {
    LIBRARY_CARD_ASPECTS,
    LIBRARY_FILTER_PRESENTATIONS,
    LIBRARY_LAYOUTS
} from 'apps/modern/features/library/utils/libraryRecipe';
import {
    HOME_SECTIONS,
    HOME_SHELF_DENSITIES,
    PLATFORM_DEFAULT_PRESENTATION,
    WEB_RENDERER_CAPABILITIES,
    type HomeRecipe,
    type HomeSection,
    type LibraryRecipe,
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

    const setHome = (home: HomeRecipe) =>
        onChange({
            ...presentation,
            page: { ...presentation.page, home }
        });

    const setLibrary = (key: keyof LibraryRecipe, value: string) =>
        onChange({
            ...presentation,
            page: {
                ...presentation.page,
                library: { ...presentation.page?.library, [key]: value }
            }
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

            <Section title='Home composition'>
                {supports('presentation.page.home') ? (
                    <HomeCompositionEditor
                        recipe={presentation.page?.home}
                        onChange={setHome}
                    />
                ) : (
                    <Alert severity='warning' variant='outlined'>
                        The Home composition recipe is defined by the contract
                        and <strong>not bound</strong> by this renderer, so
                        editing it here is disabled.
                    </Alert>
                )}
            </Section>

            <Section title='Library composition'>
                {supports('presentation.page.library') ? (
                    <LibraryCompositionEditor
                        recipe={presentation.page?.library}
                        onChange={setLibrary}
                    />
                ) : (
                    <Alert severity='warning' variant='outlined'>
                        The Library composition recipe is defined by the
                        contract and <strong>not bound</strong> by this
                        renderer, so editing it here is disabled.
                    </Alert>
                )}
            </Section>

            <Section title='Other page composition'>
                <Alert severity='warning' variant='outlined'>
                    The Item Details composition recipe is defined by the
                    contract and <strong>not yet bound</strong> by the Web
                    renderer — its route is still a legacy view that reads no
                    recipe. A theme may declare it today; this renderer falls
                    back to the platform default and reports the fallback.
                    Editing it here is disabled until that route reads a recipe,
                    so the Studio does not offer a control that would do
                    nothing.
                </Alert>
            </Section>
        </Stack>
    );
};

const DEFAULT_HOME = PLATFORM_DEFAULT_PRESENTATION.page.home;

const RENDERED_BY_WEB: ReadonlySet<string> = new Set(
    WEB_RENDERED_HOME_SECTIONS
);

const SECTION_LABELS: Record<HomeSection, string> = {
    hero: 'Hero',
    continueWatching: 'Continue watching',
    nextUp: 'Next up',
    latestMedia: 'Latest from each library',
    libraries: 'My media',
    recommendations: 'Recommendations'
};

interface HomeCompositionEditorProps {
    recipe: HomeRecipe | undefined;
    onChange: (recipe: HomeRecipe) => void;
}

/**
 * The Home composition control — a REAL one.
 *
 * It edits the same `presentation.page.home` object the live renderer resolves, through the same
 * `themes/platform` contract, and it lists exactly the sections
 * `apps/modern/features/home/utils/homeRecipe.ts` renders — imported from that module rather than
 * re-typed here, so the Studio cannot offer a section the Home route would silently drop. Applying
 * a draft changes the live route, not only `PreviewCanvas`.
 *
 * Three states are shown distinctly, because a contract with a capability mechanism is only honest
 * if the author can see which of the three they are in:
 *
 *   - **rendered** — the section appears on Home when included;
 *   - **declared, not rendered by this renderer** (`recommendations`) — selectable, because it is
 *     valid universal vocabulary another renderer may honour, and labelled so nobody expects it to
 *     appear here;
 *   - **capability unsupported** — the whole editor is replaced by the notice above, which is what
 *     Library and Item Details still get.
 *
 * Ordering is expressed with explicit Move up/Move down buttons rather than drag-and-drop: drag is
 * not operable by keyboard or by a remote, and both are gates rather than follow-ups here.
 */
const HomeCompositionEditor: FC<HomeCompositionEditorProps> = ({
    recipe,
    onChange
}) => {
    const selected: readonly HomeSection[] =
        recipe?.sections ?? DEFAULT_HOME.sections;
    const density = recipe?.shelfDensity ?? DEFAULT_HOME.shelfDensity;

    // Selected first, in recipe order; then everything still available, in contract order. Derived
    // rather than stored, so the control has no state of its own that could disagree with the draft.
    const rows = [
        ...selected,
        ...HOME_SECTIONS.filter((section) => !selected.includes(section))
    ];

    const setSections = (sections: readonly HomeSection[]) =>
        onChange({ sections, shelfDensity: density });

    const toggle = (section: HomeSection) => {
        if (selected.includes(section)) {
            // `theme.schema.json` requires `minItems: 1`; the last one is disabled below, so this
            // cannot empty the recipe.
            setSections(selected.filter((entry) => entry !== section));
        } else {
            setSections([...selected, section]);
        }
    };

    const move = (section: HomeSection, delta: -1 | 1) => {
        const from = selected.indexOf(section);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= selected.length) return;
        const next = [...selected];
        next.splice(from, 1);
        next.splice(to, 0, section);
        setSections(next);
    };

    return (
        <Stack spacing={2} data-testid='theme-studio-home-composition'>
            <Typography variant='body2'>
                A recipe orders and selects Home sections. It never changes what
                a section contains, and Home issues the same requests under
                every recipe — composition is presentation, not data access.
            </Typography>

            <ul className='rf-theme-studio__home-sections'>
                {rows.map((section) => {
                    const index = selected.indexOf(section);
                    const isSelected = index >= 0;
                    const rendered = RENDERED_BY_WEB.has(section);

                    return (
                        <li key={section}>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={isSelected}
                                        disabled={
                                            isSelected && selected.length === 1
                                        }
                                        onChange={() => toggle(section)}
                                    />
                                }
                                label={
                                    rendered
                                        ? SECTION_LABELS[section]
                                        : `${SECTION_LABELS[section]} — declared, not rendered by this renderer`
                                }
                            />
                            <Button
                                size='small'
                                disabled={!isSelected || index === 0}
                                onClick={() => move(section, -1)}
                            >
                                {`Move ${SECTION_LABELS[section]} up`}
                            </Button>
                            <Button
                                size='small'
                                disabled={
                                    !isSelected || index === selected.length - 1
                                }
                                onClick={() => move(section, 1)}
                            >
                                {`Move ${SECTION_LABELS[section]} down`}
                            </Button>
                        </li>
                    );
                })}
            </ul>

            <Choice
                label='Shelf density'
                value={density}
                options={HOME_SHELF_DENSITIES}
                onChange={(value) =>
                    onChange({
                        sections: selected,
                        shelfDensity: value as HomeRecipe['shelfDensity']
                    })
                }
            />

            <Alert severity='info' variant='outlined'>
                {`Declared by the contract and not rendered by the Web renderer: ${WEB_UNRENDERED_HOME_SECTIONS.join(', ')}. Including one is valid — another renderer may honour it — but it will not appear on Home here.`}
            </Alert>
        </Stack>
    );
};

const DEFAULT_LIBRARY = PLATFORM_DEFAULT_PRESENTATION.page.library;

interface LibraryCompositionEditorProps {
    recipe: LibraryRecipe | undefined;
    onChange: (key: keyof LibraryRecipe, value: string) => void;
}

/**
 * The Library composition control — a REAL one, on the same terms as Home's.
 *
 * It edits the `presentation.page.library` object the live route resolves, its three value lists
 * are IMPORTED from `apps/modern/features/library/utils/libraryRecipe.ts` rather than re-typed, and
 * applying a draft changes `/library/:libraryId` itself, not only `PreviewCanvas`.
 *
 * The notes below are not decoration. Each records a place where a value is valid vocabulary and
 * inert, which is the one thing a capability-based contract has to say out loud — the precedent
 * Home set by labelling `recommendations` rather than quietly dropping it.
 */
const LibraryCompositionEditor: FC<LibraryCompositionEditorProps> = ({
    recipe,
    onChange
}) => (
    <Stack spacing={2} data-testid='theme-studio-library-composition'>
        <Typography variant='body2'>
            A recipe composes the library. It never changes the catalogue query:
            the same items, in the same order, with the same sort, filters, page
            and page size are requested under every recipe below.
        </Typography>

        <Choice
            label='Layout'
            value={recipe?.layout ?? DEFAULT_LIBRARY.layout}
            options={LIBRARY_LAYOUTS}
            onChange={(value) => onChange('layout', value)}
        />
        <Choice
            label='Card aspect'
            value={recipe?.cardAspect ?? DEFAULT_LIBRARY.cardAspect}
            options={LIBRARY_CARD_ASPECTS}
            onChange={(value) => onChange('cardAspect', value)}
        />
        <Choice
            label='Filter controls'
            value={recipe?.filters ?? DEFAULT_LIBRARY.filters}
            options={LIBRARY_FILTER_PRESENTATIONS}
            onChange={(value) => onChange('filters', value)}
        />

        <Alert severity='info' variant='outlined'>
            Layout composes the library&apos;s item list — Browse and
            Collections. Genres lists aggregates and Suggestions is editorial,
            so both keep their own composition. Card aspect shapes every
            media-item card the route draws, and takes precedence over the
            app-wide media-card image aspect above. Under a shelf layout the
            list/grid view-mode toggle does not apply, and the reader&apos;s own
            saved choice is left untouched.
        </Alert>
    </Stack>
);

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
}) => {
    /*
     * Slugified, because these labels contain spaces ("Image aspect") and an id with a space is
     * two id tokens to `aria-labelledby` — neither of which exists. MUI wires the label through
     * `labelId`, so the combobox was left with no accessible name at all: WCAG 4.1.2, and exactly
     * the class of defect the automated scan exists to catch and the hand-written assertions did
     * not.
     */
    const labelId = `presentation-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    return (
        <FormControl fullWidth size='small' disabled={disabled}>
            <InputLabel id={labelId}>{label}</InputLabel>
            <Select
                labelId={labelId}
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
};

export default PresentationEditor;
