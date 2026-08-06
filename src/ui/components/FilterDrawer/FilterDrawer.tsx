import React, {
    type FC,
    type ReactNode,
    useCallback,
    useEffect,
    useRef
} from 'react';

import './FilterDrawer.scss';

export interface FilterDrawerProps {
    /** Accessible name and visible label of the button that opens the panel. */
    triggerLabel: string;
    /** Heading of the panel; also its accessible name. */
    title: string;
    /** Accessible name of the close button. */
    closeLabel: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The controls the drawer relocates. Rendered only while open. */
    children: ReactNode;
    className?: string;
}

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dismissible panel for controls that are otherwise laid out inline — the surface behind
 * `presentation.page.library.filters: 'drawer'` (RFC-0007 §4.7).
 *
 * ## Why this is a `src/ui` primitive and not MUI's `Drawer`
 *
 * A theme composes with published vocabulary only. MUI's `Drawer` would put its generated class
 * names (`.MuiDrawer-paper`, `.MuiBackdrop-root`) on the one element a `filters: 'drawer'` recipe
 * produces, and a theme author wanting to shape it would have nothing else to target — a generated
 * class name becoming theme API is exactly what `tests/boundary/presentationBoundary.ratchet.test.ts`
 * prohibits. This renders `--rf-*` tokens and one published slot,
 * `data-rf-slot="filter-drawer"`, like every other primitive here.
 *
 * ## Why it is not portalled
 *
 * The panel stays inside the route's own DOM subtree. A portal would mount it outside
 * `PresentationProvider`'s tree in any host that renders a second React root, and the resolved
 * presentation would silently stop reaching it — the same failure `renderComponent` is prohibited
 * for. Nothing here needs to escape a stacking context: the panel is `position: fixed` and its
 * backdrop is a sibling.
 *
 * ## What it deliberately does NOT do
 *
 * It does not own the controls' state, and mounting it is not what makes those controls take
 * effect. A drawer is a place to PUT a control, never a condition on what the control does — see
 * `apps/modern/features/library/utils/libraryRecipe.ts`. Closing the panel unmounts its children
 * and changes nothing else.
 */
export const FilterDrawer: FC<FilterDrawerProps> = ({
    triggerLabel,
    title,
    closeLabel,
    open,
    onOpenChange,
    children,
    className
}) => {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    /*
     * Whether the panel was open on the previous render. Returning focus must happen on the
     * open→closed TRANSITION only: doing it whenever `open` is false would steal focus back to the
     * trigger on every unrelated re-render of a closed drawer.
     */
    const wasOpen = useRef(false);

    useEffect(() => {
        if (open) {
            const first =
                panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
            first?.focus();
        } else if (wasOpen.current) {
            triggerRef.current?.focus();
        }
        wasOpen.current = open;
    }, [open]);

    const close = useCallback(() => onOpenChange(false), [onOpenChange]);
    const toggle = useCallback(() => onOpenChange(!open), [onOpenChange, open]);

    /**
     * Escape closes, and Tab is bounded to the panel while it is open.
     *
     * Bound on `document` rather than as a JSX handler on the panel, for two reasons. It is the
     * only way Escape works when focus sits on the backdrop rather than inside the panel; and a
     * `keydown` handler on a `div` is a non-interactive element carrying an interaction, which the
     * lint rules reject on exactly the grounds that it usually hides a missing button.
     *
     * The trap is a wrap-around rather than a hard block, so a keyboard's Tab and a remote's
     * directional keys both stay inside and neither can strand focus: the browser's own order is
     * used, this only closes the loop at its two ends.
     */
    useEffect(() => {
        if (!open) return;

        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                close();
                return;
            }

            if (event.key !== 'Tab') return;

            const focusable = [
                ...(panelRef.current?.querySelectorAll<HTMLElement>(
                    FOCUSABLE
                ) ?? [])
            ];
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;

            if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!panelRef.current?.contains(active)) {
                // Focus escaped the panel (the backdrop, or a host that moved it): put it back at
                // the appropriate end rather than letting Tab walk into the page behind the dialog.
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, close]);

    const classes = ['rf-filter-drawer', className].filter(Boolean).join(' ');

    return (
        <div className={classes}>
            <button
                ref={triggerRef}
                type='button'
                className='rf-filter-drawer__trigger'
                aria-expanded={open}
                onClick={toggle}
            >
                {triggerLabel}
            </button>

            {open && (
                <>
                    {/*
                     * A real `button`, and NOT an `aria-hidden` div with a click handler: a click
                     * target that only a mouse can reach is the shape axe flags, and hiding a
                     * focusable node from the accessibility tree is the shape it flags next. It is
                     * `tabIndex={-1}` because the panel's own close button and Escape are the
                     * keyboard and remote routes out — this one exists so a pointer user can
                     * dismiss by tapping away, without adding a second stop outside the trap.
                     */}
                    <button
                        type='button'
                        tabIndex={-1}
                        className='rf-filter-drawer__backdrop'
                        aria-label={closeLabel}
                        onClick={close}
                    />
                    <div
                        ref={panelRef}
                        className='rf-filter-drawer__panel'
                        data-rf-slot='filter-drawer'
                        role='dialog'
                        aria-modal='true'
                        aria-label={title}
                    >
                        <div className='rf-filter-drawer__header'>
                            <h2 className='rf-filter-drawer__title'>{title}</h2>
                            <button
                                type='button'
                                className='rf-filter-drawer__close'
                                onClick={close}
                            >
                                {closeLabel}
                            </button>
                        </div>
                        <div className='rf-filter-drawer__body'>{children}</div>
                    </div>
                </>
            )}
        </div>
    );
};

export default FilterDrawer;
