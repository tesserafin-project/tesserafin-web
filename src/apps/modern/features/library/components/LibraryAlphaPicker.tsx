import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import {
    ALPHA_PICKER_LETTERS,
    isAlphaPickerEnabled,
    type LibraryGranularity
} from '../constants/librarySections';

export interface LibraryAlphaPickerProps {
    /** Currently selected letter, or `undefined` for "no letter filter". */
    value: string | undefined;
    sortBy: string;
    granularity: LibraryGranularity;
    onSelect: (letter: string) => void;
}

/**
 * The ported AlphaPicker (design §4.1). `constants/views/defaults.ts` sets
 * `isAlphabetPickerEnabled: true` and neither `moviesTabContent` nor `seriesTabContent` overrides
 * it, so this control is live on exactly the two legacy tabs Browse takes over — which is why it is
 * non-negotiable in the target rather than a nice-to-have.
 *
 * Two behaviours are policy, not styling, and both live in `constants/librarySections.ts` so they
 * have one definition each:
 *
 * - **Disabled, not hidden, off `SortName`** (`isAlphaPickerEnabled`). An alphabet jump under a
 *   date sort would scroll to an arbitrary place — a lying control. Hiding it instead would reflow
 *   the whole control bar on every sort change.
 * - **`#` is not a `nameStartsWith` value.** The caller's `selectLetter` maps it to
 *   `nameLessThan: 'A'`, the same translation `utils/items.ts` applies for the legacy pages, so the
 *   ported picker returns the *same set* as the legacy one.
 */
export const LibraryAlphaPicker: FC<LibraryAlphaPickerProps> = ({
    value,
    sortBy,
    granularity,
    onSelect
}) => {
    const enabled = isAlphaPickerEnabled(sortBy, granularity);

    return (
        <div
            className='rf-library-view__alpha-picker'
            data-rf-slot='alpha-picker'
            role='group'
            aria-label={globalize.translate('LabelAlphabetPicker')}
            aria-disabled={!enabled}
        >
            {ALPHA_PICKER_LETTERS.map((letter) => (
                <button
                    key={letter}
                    type='button'
                    className='rf-library-view__alpha-picker-letter'
                    // `aria-pressed` (not `aria-selected`) because each letter is an independent
                    // toggle: re-selecting the active letter clears the filter (`toggleLetter`).
                    aria-pressed={value === letter}
                    disabled={!enabled}
                    onClick={() => onSelect(letter)}
                >
                    {letter}
                </button>
            ))}
        </div>
    );
};

export default LibraryAlphaPicker;
