import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';

import globalize from 'lib/globalize';

import { ContentPackBrowsingPreference } from 'apps/modern/features/contentPacks/adapters/browsingPreference';

import type { DisplaySettingsValues } from '../types/displaySettingsValues';

interface LibraryPreferencesProps {
    // The page's own handler already accepts both shapes — `UserDisplayPreferences` types it as
    // `SelectChangeEvent | React.SyntheticEvent` — so widening it here just stops this file from
    // narrowing it back.
    onChange: (event: SelectChangeEvent | React.SyntheticEvent) => void;
    values: DisplaySettingsValues;
}

export function LibraryPreferences({
    onChange,
    values
}: Readonly<LibraryPreferencesProps>) {
    return (
        <Stack spacing={3}>
            <Typography variant='h2'>
                {globalize.translate('HeaderLibraries')}
            </Typography>

            {/*
             * #139 gate 5 — the same choice the first-run wizard offers, reachable afterwards by
             * anyone, for themselves. No administrator right and no content-pack permission is
             * involved: it is written to the caller's own `UserConfiguration`. The labels describe
             * what the household will see rather than naming the wire values.
             *
             * A `Select`, not a `RadioGroup`, because it is the control every other choice on this
             * form already uses — and because `Radio`/`RadioGroup`/`FormLabel` are not otherwise in
             * the bundle: pulling them in cost 1322 B of initial raw JS and pushed
             * `initial.rawJsBytes` and `startup.rawBytes` over their ceilings, for a control that
             * looks out of place next to its neighbours anyway.
             */}
            <FormControl fullWidth>
                <InputLabel id='display-settings-browsing-arrangement-label'>
                    {globalize.translate('HeaderBrowsingArrangement')}
                </InputLabel>
                <Select
                    aria-describedby='display-settings-browsing-arrangement-description'
                    inputProps={{ name: 'contentPackBrowsingPreference' }}
                    labelId='display-settings-browsing-arrangement-label'
                    label={globalize.translate('HeaderBrowsingArrangement')}
                    name='contentPackBrowsingPreference'
                    onChange={onChange}
                    value={values.contentPackBrowsingPreference}
                >
                    <MenuItem
                        value={ContentPackBrowsingPreference.MediaFamilyFirst}
                    >
                        {globalize.translate('OptionBrowseByMediaFamily')}
                    </MenuItem>
                    <MenuItem
                        value={ContentPackBrowsingPreference.ContentPackFirst}
                    >
                        {globalize.translate('OptionBrowseByContentPack')}
                    </MenuItem>
                </Select>
                <FormHelperText id='display-settings-browsing-arrangement-description'>
                    {globalize.translate(
                        values.contentPackBrowsingPreference ===
                            ContentPackBrowsingPreference.ContentPackFirst
                            ? 'OptionBrowseByContentPackHelp'
                            : 'OptionBrowseByMediaFamilyHelp'
                    )}
                </FormHelperText>
            </FormControl>

            <FormControl fullWidth>
                <TextField
                    aria-describedby='display-settings-lib-pagesize-description'
                    value={values.libraryPageSize}
                    label={globalize.translate('LabelLibraryPageSize')}
                    name='libraryPageSize'
                    onChange={onChange}
                    slotProps={{
                        htmlInput: {
                            type: 'number',
                            inputMode: 'numeric',
                            max: '1000',
                            min: '0',
                            pattern: '[0-9]',
                            required: true,
                            step: '1'
                        }
                    }}
                />
                <FormHelperText id='display-settings-lib-pagesize-description'>
                    {globalize.translate('LabelLibraryPageSizeHelp')}
                </FormHelperText>
            </FormControl>

            <FormControl fullWidth>
                <FormControlLabel
                    aria-describedby='display-settings-lib-backdrops-description'
                    control={
                        <Checkbox
                            checked={values.enableLibraryBackdrops}
                            onChange={onChange}
                        />
                    }
                    label={globalize.translate('Backdrops')}
                    name='enableLibraryBackdrops'
                />
                <FormHelperText id='display-settings-lib-backdrops-description'>
                    {globalize.translate('EnableBackdropsHelp')}
                </FormHelperText>
            </FormControl>

            <FormControl fullWidth>
                <FormControlLabel
                    aria-describedby='display-settings-lib-theme-songs-description'
                    control={
                        <Checkbox
                            checked={values.enableLibraryThemeSongs}
                            onChange={onChange}
                        />
                    }
                    label={globalize.translate('ThemeSongs')}
                    name='enableLibraryThemeSongs'
                />
                <FormHelperText id='display-settings-lib-theme-songs-description'>
                    {globalize.translate('EnableThemeSongsHelp')}
                </FormHelperText>
            </FormControl>

            <FormControl fullWidth>
                <FormControlLabel
                    aria-describedby='display-settings-lib-theme-videos-description'
                    control={
                        <Checkbox
                            checked={values.enableLibraryThemeVideos}
                            onChange={onChange}
                        />
                    }
                    label={globalize.translate('ThemeVideos')}
                    name='enableLibraryThemeVideos'
                />
                <FormHelperText id='display-settings-lib-theme-videos-description'>
                    {globalize.translate('EnableThemeVideosHelp')}
                </FormHelperText>
            </FormControl>

            <FormControl fullWidth>
                <FormControlLabel
                    aria-describedby='display-settings-show-missing-episodes-description'
                    control={
                        <Checkbox
                            checked={values.displayMissingEpisodes}
                            onChange={onChange}
                        />
                    }
                    label={globalize.translate(
                        'DisplayMissingEpisodesWithinSeasons'
                    )}
                    name='displayMissingEpisodes'
                />
                <FormHelperText id='display-settings-show-missing-episodes-description'>
                    {globalize.translate(
                        'DisplayMissingEpisodesWithinSeasonsHelp'
                    )}
                </FormHelperText>
            </FormControl>
        </Stack>
    );
}
