import React, {
    type FC,
    type KeyboardEvent,
    type ReactNode,
    useState
} from 'react';

import './Tabs.scss';

/** One tab entry rendered by {@link Tabs}. */
export interface TabItem {
    /** Stable identifier, also used to derive the DOM `id` of the tab button. */
    id: string;
    label: ReactNode;
    /** `id` of the associated tabpanel element, wired to `aria-controls`. */
    panelId?: string;
    disabled?: boolean;
}

export interface TabsProps {
    items: TabItem[];
    /** Index of the currently selected tab (controlled). */
    value: number;
    onChange: (index: number, item: TabItem) => void;
    /**
     * `underline` mirrors the familiar Jellyfin/Classic tab strip; `pills` is the rounded,
     * floating-chip treatment prepared for the Glass theme (RFC-0005 §8.2) - both read the same
     * `--rf-*` tokens, only the shape/emphasis differs.
     */
    variant?: 'underline' | 'pills';
    className?: string;
    /** Accessible name for the `tablist` when no visible heading already labels it. */
    'aria-label'?: string;
}

const nextEnabledIndex = (
    items: TabItem[],
    from: number,
    direction: 1 | -1
): number => {
    const count = items.length;

    for (let step = 1; step <= count; step++) {
        const candidate = (from + direction * step + count) % count;
        if (!items[candidate]?.disabled) {
            return candidate;
        }
    }

    return from;
};

/**
 * Accessible tab strip (`role="tablist"`/`role="tab"`, roving tabindex, manual activation) —
 * RFC-0005 §6 `Tabs`. Arrow keys move focus between tabs without selecting them; Enter/Space
 * activates the focused tab, matching the native `role="tab"` authoring practice the existing
 * `/home` E2E journey (`tests/e2e/home.spec.ts`) already exercises against the MUI tab strip it
 * replaces. Public slot: `data-rf-slot="tabs"`.
 */
export const Tabs: FC<TabsProps> = ({
    items,
    value,
    onChange,
    variant = 'underline',
    className,
    'aria-label': ariaLabel
}) => {
    const [focusedIndex, setFocusedIndex] = useState(value);
    const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

    const activeIndex = items[focusedIndex]?.disabled ? value : focusedIndex;

    const focusTab = (index: number) => {
        setFocusedIndex(index);
        tabRefs.current[index]?.focus();
    };

    const activate = (index: number) => {
        const item = items[index];
        if (!item || item.disabled) return;
        setFocusedIndex(index);
        onChange(index, item);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        switch (event.key) {
            case 'ArrowRight':
                event.preventDefault();
                focusTab(nextEnabledIndex(items, activeIndex, 1));
                break;
            case 'ArrowLeft':
                event.preventDefault();
                focusTab(nextEnabledIndex(items, activeIndex, -1));
                break;
            case 'Home':
                event.preventDefault();
                focusTab(nextEnabledIndex(items, -1, 1));
                break;
            case 'End':
                event.preventDefault();
                focusTab(nextEnabledIndex(items, items.length, -1));
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                activate(activeIndex);
                break;
            default:
                break;
        }
    };

    const classes = ['rf-tabs', `rf-tabs--${variant}`, className]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            className={classes}
            data-rf-slot='tabs'
            role='tablist'
            aria-label={ariaLabel}
        >
            {items.map((item, index) => {
                const selected = index === value;
                const focusable = index === activeIndex;

                return (
                    <button
                        key={item.id}
                        ref={(el) => {
                            tabRefs.current[index] = el;
                        }}
                        type='button'
                        id={item.id}
                        role='tab'
                        className='rf-tabs__tab'
                        data-rf-slot='tab'
                        aria-selected={selected}
                        aria-controls={item.panelId}
                        disabled={item.disabled}
                        tabIndex={focusable ? 0 : -1}
                        onClick={() => activate(index)}
                        onKeyDown={onKeyDown}
                        onFocus={() => setFocusedIndex(index)}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
};

export default Tabs;
