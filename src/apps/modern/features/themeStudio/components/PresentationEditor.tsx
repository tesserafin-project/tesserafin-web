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
/*
 * Same rule for Item Details: the families come from the LIVE ROUTE's composition module. That is
 * what guarantees the Studio can never offer a section the route does not draw — and, just as
 * importantly, that no FIXED surface can appear as an option: `PUBLISHED_FAMILIES` is the public
 * enum, and the action bar, the track selectors, the recording controls and the item's identity
 * are not in it.
 */
import { PUBLISHED_FAMILIES } from 'apps/modern/features/details/utils/itemDetailsRecipe';
import {
    HOME_SECTIONS,
    HOME_SHELF_DENSITIES,
    ITEM_DETAILS_HEROES,
    PLATFORM_DEFAULT_PRESENTATION,
    WEB_RENDERER_CAPABILITIES,
    type HomeRecipe,
    type HomeSection,
    type ItemDetailsRecipe,
    type ItemDetailsSection,
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

    const setItemDetails = (itemDetails: ItemDetailsRecipe) =>
        onChange({
            ...presentation,
            page: { ...presentation.page, itemDetails }
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

            <Section title='Item Details composition'>
                {supports('presentation.page.itemDetails') ? (
                    <ItemDetailsCompositionEditor
                        recipe={presentation.page?.itemDetails}
                        onChange={setItemDetails}
                    />
                ) : (
                    <Alert severity='warning' variant='outlined'>
                        The Item Details composition recipe is defined by the
                        contract and <strong>not bound</strong> by this
                        renderer, so editing it here is disabled.
                    </Alert>
                )}
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

const DEFAULT_ITEM_DETAILS = PLATFORM_DEFAULT_PRESENTATION.page.itemDetails;

/**
 * User-facing names for the published content families.
 *
 * Deliberately NOT the token strings. A token is contract vocabulary; a label is what an author
 * reads. Two of the tokens are wider than their published names — `episodes` covers any contained
 * children and `mediaInfo` covers the whole fact panel — and the labels say what the family
 * actually is, which is the only place that difference can be explained to an author.
 */
const ITEM_DETAILS_LABELS: Record<ItemDetailsSection, string> = {
    overview: 'Overview and tagline',
    mediaInfo: 'Details, tags and links',
    nextUp: 'Next up',
    episodes: 'Contents — episodes, tracks and collection items',
    lyrics: 'Lyrics',
    moreFrom: 'More from this artist or season',
    cast: 'Cast and crew',
    schedule: 'Schedule and programme guide',
    extras: 'Extras and music videos',
    chapters: 'Scenes',
    related: 'Related and collections'
};

interface ItemDetailsCompositionEditorProps {
    recipe: ItemDetailsRecipe | undefined;
    onChange: (recipe: ItemDetailsRecipe) => void;
}

/**
 * The Item Details composition control — a REAL one, on the same terms as Home's and Library's.
 *
 * It edits the `presentation.page.itemDetails` object the live route resolves, its family list is
 * IMPORTED from `apps/modern/features/details/utils/itemDetailsRecipe.ts`, and applying a draft
 * changes `/details` itself rather than only `PreviewCanvas`.
 *
 * What is deliberately NOT here is the point of the control. There is no option for the item's
 * name, the play button, the media-source or subtitle selectors, the played/favourite/rating
 * controls, the recording editor, a permission gate or a warning — those are fixed regions
 * (RFC-0007 §6.1), and the way they are kept out is structural: this list is the published enum,
 * and the enum contains none of them. A theme cannot select what the vocabulary cannot name.
 *
 * Ordering uses explicit Move up/Move down buttons for the reason Home's does: drag is operable by
 * neither keyboard nor remote.
 */
const ItemDetailsCompositionEditor: FC<ItemDetailsCompositionEditorProps> = ({
    recipe,
    onChange
}) => {
    const selected: readonly ItemDetailsSection[] =
        recipe?.sections ?? DEFAULT_ITEM_DETAILS.sections;
    const hero = recipe?.hero ?? DEFAULT_ITEM_DETAILS.hero;

    // Selected first, in recipe order; then everything still available, in contract order. Derived
    // rather than stored, so the control has no state that could disagree with the draft.
    const rows = [
        ...selected,
        ...PUBLISHED_FAMILIES.filter((family) => !selected.includes(family))
    ];

    const setSections = (sections: readonly ItemDetailsSection[]) =>
        onChange({ hero, sections });

    const toggle = (family: ItemDetailsSection) => {
        if (selected.includes(family)) {
            // `theme.schema.json` requires `minItems: 1`; the last one is disabled below.
            setSections(selected.filter((entry) => entry !== family));
        } else {
            setSections([...selected, family]);
        }
    };

    const move = (family: ItemDetailsSection, delta: -1 | 1) => {
        const from = selected.indexOf(family);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= selected.length) return;
        const next = [...selected];
        next.splice(from, 1);
        next.splice(to, 0, family);
        setSections(next);
    };

    return (
        <Stack spacing={2} data-testid='theme-studio-item-details-composition'>
            <Typography variant='body2'>
                A recipe orders and selects Item Details content families. It
                never changes which requests the page issues: a family you hide
                is still fetched, so hiding is a statement about what is shown,
                not about what is loaded.
            </Typography>

            <Choice
                label='Artwork treatment'
                value={hero}
                options={ITEM_DETAILS_HEROES}
                onChange={(value) =>
                    onChange({
                        hero: value as ItemDetailsRecipe['hero'],
                        sections: selected
                    })
                }
            />

            <ul className='rf-theme-studio__home-sections'>
                {rows.map((family) => {
                    const index = selected.indexOf(family);
                    const isSelected = index >= 0;

                    return (
                        <li key={family}>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={isSelected}
                                        disabled={
                                            isSelected && selected.length === 1
                                        }
                                        onChange={() => toggle(family)}
                                    />
                                }
                                label={ITEM_DETAILS_LABELS[family]}
                            />
                            <Button
                                size='small'
                                disabled={!isSelected || index === 0}
                                onClick={() => move(family, -1)}
                            >
                                {`Move ${ITEM_DETAILS_LABELS[family]} up`}
                            </Button>
                            <Button
                                size='small'
                                disabled={
                                    !isSelected || index === selected.length - 1
                                }
                                onClick={() => move(family, 1)}
                            >
                                {`Move ${ITEM_DETAILS_LABELS[family]} down`}
                            </Button>
                        </li>
                    );
                })}
            </ul>

            <Alert severity='info' variant='outlined'>
                The artwork treatment is a layout choice. It never causes an
                extra image request, it never overrides the reader&apos;s own
                backdrop setting, people and books never gain a backdrop, and
                the poster is rendered under all three. The item&apos;s name,
                the playback controls, the media-source, audio and subtitle
                selectors, the played/favourite/rating controls, the recording
                editor and every required warning are fixed: no recipe can
                select, hide, reorder or move them, which is why none of them
                appears above.
            </Alert>
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
