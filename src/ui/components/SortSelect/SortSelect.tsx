import React, { type ChangeEvent, type FC, useId } from 'react';

import './SortSelect.scss';

export interface SortSelectOption {
    value: string;
    label: string;
}

export interface SortSelectProps {
    /** Visible label for the control (also wired to the native `<select>` via `htmlFor`/`id`). */
    label: string;
    options: SortSelectOption[];
    /** Currently selected option value (controlled). */
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
    id?: string;
}

/**
 * Accessible sort control (RFC-0005 §6) — a labelled, controlled native `<select>`. Deliberately a
 * plain `<select>` rather than a MUI wrapper: every other `src/ui` component (`Tabs`, `MediaCard`,
 * the `states` family) is plain semantic HTML styled with `--rf-*` tokens and no MUI class ever
 * leaks through the public API, so this keeps the same contract while getting native keyboard/
 * screen-reader support for free. Public slot: `data-rf-slot="sort-select"`.
 */
export const SortSelect: FC<SortSelectProps> = ({
    label,
    options,
    value,
    onChange,
    disabled,
    className,
    id
}) => {
    const generatedId = useId();
    const controlId = id ?? generatedId;

    const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
        onChange(event.target.value);
    };

    const classes = ['rf-sort-select', className].filter(Boolean).join(' ');

    return (
        <div className={classes} data-rf-slot='sort-select'>
            <label className='rf-sort-select__label' htmlFor={controlId}>
                {label}
            </label>
            <select
                className='rf-sort-select__control'
                id={controlId}
                value={value}
                disabled={disabled}
                onChange={handleChange}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default SortSelect;
