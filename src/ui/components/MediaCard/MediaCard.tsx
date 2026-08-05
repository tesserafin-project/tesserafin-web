import React, { type FC, type MouseEvent, type ReactNode } from 'react';

import { usePresentation } from '../../presentation/PresentationContext';

import './MediaCard.scss';

export type MediaCardImageAspect = 'poster' | 'backdrop' | 'square';

export interface MediaCardProps {
    title: string;
    subtitle?: string;
    imageUrl?: string;
    imageAspect: MediaCardImageAspect;
    /** 0-100; renders a progress bar over the image (e.g. "continue watching") when set. */
    progressPercent?: number;
    /** Renders the card as an `<a>` when set; takes precedence over `onClick`. */
    href?: string;
    onClick?: (event: MouseEvent<HTMLElement>) => void;
    /** Shown in place of the image when `imageUrl` is absent. */
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
    href,
    onClick,
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

    const image = (
        <span className='rf-media-card__image-wrap'>
            {imageUrl ? (
                <img className='rf-media-card__image' src={imageUrl} alt='' />
            ) : (
                <span className='rf-media-card__placeholder' aria-hidden='true'>
                    {placeholderIcon}
                </span>
            )}
            {typeof progressPercent === 'number' &&
                presentation.mediaCard.progressStyle === 'bar' && (
                    <span
                        className='rf-media-card__progress'
                        role='progressbar'
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
        </span>
    );

    const text = (
        <span className='rf-media-card__text'>
            <span className='rf-media-card__title'>{title}</span>
            {subtitle && (
                <span className='rf-media-card__subtitle'>{subtitle}</span>
            )}
        </span>
    );

    if (href) {
        return (
            <a
                className={classes}
                data-rf-slot='media-card'
                {...presentationAttrs}
                href={href}
                onClick={onClick}
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
