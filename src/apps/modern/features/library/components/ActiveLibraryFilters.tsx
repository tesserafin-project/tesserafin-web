import React, { type FC, type Ref } from 'react';
import globalize from 'lib/globalize';
import type { ActiveLibraryFilter } from '../utils/activeFilters';
import './ActiveLibraryFilters.scss';

interface Props {
    filters: ActiveLibraryFilter[];
    studios: { Id?: string | null; Name?: string | null }[];
    elementRef: Ref<HTMLElement>;
    onRemove: (filter: ActiveLibraryFilter) => void;
    onReset: () => void;
}

export const ActiveLibraryFilters: FC<Props> = ({
    filters,
    studios,
    elementRef,
    onRemove,
    onReset
}) => {
    if (!filters.length) return null;
    const label = (filter: ActiveLibraryFilter) => {
        if (filter.kind === 'favorite') return globalize.translate('Favorites');
        const title = globalize.translate(
            {
                genre: 'Genre',
                year: 'LabelYear',
                letter: 'LabelInitialLetter',
                studio: 'LabelStudio'
            }[filter.kind]
        );
        const value =
            filter.kind === 'studio'
                ? studios.find((studio) => studio.Id === filter.value)?.Name ||
                  globalize.translate(
                      'SelectedLibraryStudio',
                      filters
                          .filter((item) => item.kind === 'studio')
                          .indexOf(filter) + 1
                  )
                : filter.value;
        return globalize.translate('ActiveLibraryFilterValue', title, value);
    };
    return (
        <section
            ref={elementRef}
            className='rf-active-library-filters'
            aria-label={globalize.translate('HeaderActiveFilters')}
        >
            <h2 className='rf-active-library-filters__title'>
                {globalize.translate('HeaderActiveFilters')}
            </h2>
            <ul className='rf-active-library-filters__list'>
                {filters.map((filter) => (
                    <li key={filter.id}>
                        <button
                            type='button'
                            className='rf-active-library-filters__remove'
                            data-filter-key={filter.id}
                            aria-label={globalize.translate(
                                'RemoveLibraryFilter',
                                label(filter)
                            )}
                            onClick={() => onRemove(filter)}
                        >
                            <span>{label(filter)}</span>
                            <span aria-hidden='true'>×</span>
                        </button>
                    </li>
                ))}
            </ul>
            <button
                type='button'
                className='rf-active-library-filters__reset'
                onClick={onReset}
            >
                {globalize.translate('ResetFilters')}
            </button>
        </section>
    );
};
