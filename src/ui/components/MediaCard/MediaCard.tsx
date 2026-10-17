import React, { type FC, type MouseEvent, type ReactNode } from 'react';

import { usePresentation } from '../../presentation/PresentationContext';

import './MediaCard.scss';

export type MediaCardImageAspect = 'poster' | 'backdrop' | 'square';

/** A button laid over the artwork (play, mark watched, favourite, more…). Callers translate `label`. */
export interface MediaCardAction {
    /** Stable key, also exposed as `data-action`. */
    id: string;
    label: string;
    icon: ReactNode;
    onClick: (event: MouseEvent<HTMLButtonElement>) => void;
    /** A toggle's current state (`aria-pressed`); omit for a plain command. */
    pressed?: boolean;
    /** Drawn large in the centre of the artwork rather than in the corner row. */
    primary?: boolean;
}

/** A secondary destination named on the card, e.g. an episode's series or a song's artists. */
export interface MediaCardLink {
    label: string;
    href: string;
}

export interface MediaCardProps {
    title: string;
    subtitle?: string;
    imageUrl?: string;
    imageAspect: MediaCardImageAspect;
    /** 0-100; renders a progress bar over the image (e.g. "continue watching") when set. */
    progressPercent?: number;
    /** Marks the item as watched, with a check over the image. */
    played?: boolean;
    /** Accessible name of the watched mark; callers translate (`src/ui` imports no `globalize`). */
    playedLabel?: string;
    /** Renders the card as an `<a>` when set; takes precedence over `onClick`. */
    href?: string;
    onClick?: (event: MouseEvent<HTMLElement>) => void;
    /** Links to other destinations, on a line of their own under `subtitle`, joined by " / ". */
    subtitleLinks?: MediaCardLink[];
    actions?: MediaCardAction[];
    onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
    /** Shown in place of the image when `imageUrl` is absent; the title when omitted. */
    placeholderIcon?: ReactNode;
    className?: string;
}

/**
 * Presentational media card (RFC-0005 §6 `MediaCard`), deliberately decoupled from Jellyfin's
 * `BaseItemDto`/legacy `ItemDto` — the DTO-to-props adaptation belongs to the consuming route
 * (RFC-0005 §11 W13.6, WP4), not to the design system. Public slot: `data-rf-slot="media-card"`.
 */
export const MediaCard: FC<MediaCardProps> = ({
    title,
    subtitle,
    imageUrl,
    imageAspect,
    progressPercent,
    played,
    playedLabel = 'Watched',
    href,
    onClick,
    subtitleLinks,
    actions,
    onContextMenu,
    placeholderIcon,
    className
}) => {
    // Presentation choices come from the active theme (RFC-0007 §4.6). `imageAspect` deliberately
    // stays a required PROP rather than a theme value: it is a statement about the artwork this
    // particular card holds, and a theme that could override it would crop posters into backdrops.
    // `presentation.mediaCard.imageAspect` is the DEFAULT a consuming route may read; it is not
    // applied here behind the caller's back.
    const presentation = usePresentation();
    const classes = [
        'rf-media-card',
        `rf-media-card--${imageAspect}`,
        className
    ]
        .filter(Boolean)
        .join(' ');

    /**
     * Semantic variants as data attributes rather than modifier classes: a theme picks a value from
     * a published enum, and an attribute selector expresses "whatever the theme chose" without this
     * component enumerating a class per value. It also leaves `className` — a public prop call
     * sites append to — untouched.
     */
    const presentationAttrs = {
        'data-rf-hover': presentation.mediaCard.hoverEffect,
        'data-rf-title-placement': presentation.mediaCard.titlePlacement
    };

    const imageContent = (
        <>
            {imageUrl ? (
                <img className='rf-media-card__image' src={imageUrl} alt='' />
            ) : (
                // The title by default (THEME-PRESENTATION-1): a season or series with no artwork
                // was a blank tile until its caption was read. Hidden: the caption names it.
                <span className='rf-media-card__placeholder' aria-hidden='true'>
                    {placeholderIcon ?? (
                        <span className='rf-media-card__placeholder-title'>
                            {title}
                        </span>
                    )}
                </span>
            )}
            {typeof progressPercent === 'number' &&
                presentation.mediaCard.progressStyle === 'bar' && (
                    <span
                        className='rf-media-card__progress'
                        role='progressbar'
                        /*
                         * A `role="progressbar"` with no accessible name is announced as a bare
                         * percentage — "62%", of nothing. Naming it after the card's title is the
                         * only information that makes the number mean anything, and it is WCAG
                         * 4.1.2. `aria-label` rather than `aria-labelledby` pointing at the title
                         * element: the title has no id, and minting one per card would put an id
                         * collision one duplicate title away.
                         */
                        aria-label={title}
                        aria-valuenow={progressPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                    >
                        <span
                            className='rf-media-card__progress-bar'
                            style={{ width: `${progressPercent}%` }}
                        />
                    </span>
                )}
            {played && (
                <span
                    className='rf-media-card__played'
                    role='img'
                    aria-label={playedLabel}
                >
                    <svg
                        viewBox='0 0 24 24'
                        aria-hidden='true'
                        focusable='false'
                    >
                        <path d='M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z' />
                    </svg>
                </span>
            )}
        </>
    );
    const image = (
        <span className='rf-media-card__image-wrap'>{imageContent}</span>
    );

    const text = (
        <span className='rf-media-card__text'>
            <span className='rf-media-card__title'>{title}</span>
            {subtitle && (
                <span className='rf-media-card__subtitle'>{subtitle}</span>
            )}
        </span>
    );

    /*
     * Composite card: a card that holds other controls cannot BE a link, since nothing interactive
     * may nest inside an `<a>`. The artwork and the title are then two links to `href` — the
     * artwork one out of the tab order and hidden from assistive technology, so the card is still
     * one stop and one name — and the actions and subtitle links sit beside them.
     */
    if (actions?.length || subtitleLinks?.length) {
        return (
            <div
                className={`${classes} rf-media-card--composite`}
                data-rf-slot='media-card'
                {...presentationAttrs}
            >
                <a
                    className='rf-media-card__image-wrap'
                    href={href}
                    onClick={onClick}
                    onContextMenu={onContextMenu}
                    tabIndex={-1}
                    aria-hidden='true'
                >
                    {imageContent}
                </a>
                <span className='rf-media-card__text'>
                    <a
                        className='rf-media-card__title rf-media-card__link'
                        href={href}
                        onClick={onClick}
                        onContextMenu={onContextMenu}
                    >
                        {title}
                    </a>
                    {subtitle && (
                        <span className='rf-media-card__subtitle'>
                            {subtitle}
                        </span>
                    )}
                    {!!subtitleLinks?.length && (
                        <span className='rf-media-card__subtitle'>
                            {subtitleLinks.map((link, index) => (
                                <React.Fragment key={link.href}>
                                    {index > 0 && ' / '}
                                    <a
                                        className='rf-media-card__sublink'
                                        href={link.href}
                                    >
                                        {link.label}
                                    </a>
                                </React.Fragment>
                            ))}
                        </span>
                    )}
                </span>
                {!!actions?.length && (
                    <span className='rf-media-card__actions'>
                        {actions.map((action) => (
                            <button
                                key={action.id}
                                type='button'
                                className={`rf-media-card__action${
                                    action.primary
                                        ? ' rf-media-card__action--primary'
                                        : ''
                                }`}
                                data-action={action.id}
                                aria-label={action.label}
                                title={action.label}
                                aria-pressed={action.pressed}
                                onClick={action.onClick}
                            >
                                {action.icon}
                            </button>
                        ))}
                    </span>
                )}
            </div>
        );
    }

    if (href) {
        return (
            <a
                className={classes}
                data-rf-slot='media-card'
                {...presentationAttrs}
                href={href}
                onClick={onClick}
                onContextMenu={onContextMenu}
            >
                {image}
                {text}
            </a>
        );
    }

    if (onClick) {
        return (
            <button
                type='button'
                className={classes}
                data-rf-slot='media-card'
                {...presentationAttrs}
                onClick={onClick}
            >
                {image}
                {text}
            </button>
        );
    }

    return (
        <div
            className={classes}
            data-rf-slot='media-card'
            {...presentationAttrs}
        >
            {image}
            {text}
        </div>
    );
};

export default MediaCard;
