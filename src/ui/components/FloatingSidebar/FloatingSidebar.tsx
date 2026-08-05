import React, {
    type FC,
    type KeyboardEvent,
    type ReactNode,
    useRef,
    useState
} from 'react';

import './FloatingSidebar.scss';

/** One navigation entry rendered by {@link FloatingSidebar}. */
export interface FloatingSidebarItem {
    /** Stable identifier, also used as the DOM `id` of the item's button. */
    id: string;
    label: ReactNode;
    /** Optional leading glyph. Rendered `aria-hidden`, since `label` carries the accessible name. */
    icon?: ReactNode;
    disabled?: boolean;
}

export interface FloatingSidebarProps {
    items: FloatingSidebarItem[];
    /** Index of the currently active entry (controlled). */
    value: number;
    onChange: (index: number, item: FloatingSidebarItem) => void;
    /**
     * Rail mode: labels are visually hidden but stay in the accessibility tree, so the control
     * keeps its accessible name. Intended for narrow viewports and for the TV rail.
     */
    collapsed?: boolean;
    className?: string;
    /** Accessible name for the landmark when no visible heading already labels it. */
    'aria-label'?: string;
}

const nextEnabledIndex = (
    items: FloatingSidebarItem[],
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
 * Floating sidebar (RFC-0005 §8.2 "sidebar flottante", issue #18 / W13.8b).
 *
 * ## Token-driven, with no internal selectors
 *
 * The frosted treatment comes from the shared `rf-glass-surface` mixin, exactly as `Surface` and
 * `MediaCard` take it — so this component contains no `[data-rf-theme]`, no theme name, and no
 * branch on which theme is active. Under Tesserafin Classic the very same CSS resolves
 * `--rf-backdrop-filter-md` to `none` over an opaque `--rf-color-surface` and the sidebar renders
 * flat; under Glass it resolves to `blur(16px)` over a translucent one and the sidebar floats.
 * That is the whole mechanism, and it is why adding this component cannot move Classic.
 *
 * Three behaviors that would normally be hand-written branches also arrive as tokens, from the
 * interaction profiles (`src/ui/tokens/profiles.ts`), and therefore need no code here:
 *
 *   - **D-pad / 3 metres.** The `remote` profile raises `--rf-spacing-*` and
 *     `--rf-typography-font-size-*`, so the hit targets and type grow on TV because the rail reads
 *     those tokens for its padding and font size — not because it detects a TV.
 *   - **Reduced motion.** The `reducedMotion` axis zeroes `--rf-motion-duration-*`, which is the
 *     only duration this stylesheet names, so its transitions collapse to 0ms.
 *   - **Reduced transparency / low power.** Those profiles rewrite `--rf-blur-*` (and with it the
 *     derived `--rf-backdrop-filter-*`) and the surface colors, which the mixin already reads.
 *
 * ## Keyboard and D-pad
 *
 * A vertical roving tabindex: exactly one entry is in the tab order, Arrow Up/Down move focus and
 * activate nothing, Home/End jump to the ends, Enter/Space commit. This is also the D-pad contract
 * — a TV remote's directional pad emits the same `ArrowUp`/`ArrowDown`/`Enter` key events, so the
 * remote is served by the keyboard implementation rather than by a second code path. Arrow Left and
 * Right are deliberately *not* handled: they must bubble, so focus can leave the rail for the
 * content area instead of being trapped in it.
 *
 * Public slot: `data-rf-slot="floating-sidebar"`.
 */
export const FloatingSidebar: FC<FloatingSidebarProps> = ({
    items,
    value,
    onChange,
    collapsed = false,
    className,
    'aria-label': ariaLabel
}) => {
    const [focusedIndex, setFocusedIndex] = useState(value);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

    const activeIndex = items[focusedIndex]?.disabled ? value : focusedIndex;

    const focusItem = (index: number) => {
        setFocusedIndex(index);
        itemRefs.current[index]?.focus();
    };

    const activate = (index: number) => {
        const item = items[index];
        if (!item || item.disabled) return;
        setFocusedIndex(index);
        onChange(index, item);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                focusItem(nextEnabledIndex(items, activeIndex, 1));
                break;
            case 'ArrowUp':
                event.preventDefault();
                focusItem(nextEnabledIndex(items, activeIndex, -1));
                break;
            case 'Home':
                event.preventDefault();
                focusItem(nextEnabledIndex(items, -1, 1));
                break;
            case 'End':
                event.preventDefault();
                focusItem(nextEnabledIndex(items, items.length, -1));
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                activate(activeIndex);
                break;
            default:
                // Left/Right and everything else bubble, so the D-pad can leave the rail.
                break;
        }
    };

    const classes = [
        'rf-floating-sidebar',
        collapsed && 'rf-floating-sidebar--collapsed',
        className
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <nav
            className={classes}
            data-rf-slot='floating-sidebar'
            aria-label={ariaLabel}
        >
            <ul className='rf-floating-sidebar__list'>
                {items.map((item, index) => {
                    const selected = index === value;
                    const focusable = index === activeIndex;

                    return (
                        <li key={item.id} className='rf-floating-sidebar__item'>
                            <button
                                ref={(el) => {
                                    itemRefs.current[index] = el;
                                }}
                                type='button'
                                id={item.id}
                                className='rf-floating-sidebar__button'
                                data-rf-slot='floating-sidebar-item'
                                // `aria-current="page"` rather than `aria-selected`: this is a
                                // navigation landmark, not a tablist, and `aria-selected` is not
                                // valid on a plain button.
                                aria-current={selected ? 'page' : undefined}
                                disabled={item.disabled}
                                tabIndex={focusable ? 0 : -1}
                                onClick={() => activate(index)}
                                onKeyDown={onKeyDown}
                                onFocus={() => setFocusedIndex(index)}
                            >
                                {item.icon ? (
                                    <span
                                        className='rf-floating-sidebar__icon'
                                        aria-hidden='true'
                                    >
                                        {item.icon}
                                    </span>
                                ) : null}
                                <span className='rf-floating-sidebar__label'>
                                    {item.label}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
};

export default FloatingSidebar;
