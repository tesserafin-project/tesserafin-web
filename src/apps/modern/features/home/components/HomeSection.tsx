import React, { type FC, type PropsWithChildren } from 'react';

import globalize from 'lib/globalize';
import { EmptyState, ErrorState, LoadingState } from 'ui';

import './HomeSection.scss';

export interface HomeSectionProps {
    title: string;
    isLoading: boolean;
    isError: boolean;
    onRetry: () => void;
    isEmpty: boolean;
    /**
     * When set, an empty section still renders its title plus this text instead of disappearing -
     * reserved for the handful of places a fully blank page/tab would look broken (design doc
     * §3.3/§5). Omit it for sections that are fine hiding entirely when there's nothing to show.
     */
    emptyLabel?: string;
}

const SectionHeading: FC<{ title: string }> = ({ title }) => (
    <h2 className='rf-home-section__title'>{title}</h2>
);

/**
 * Generic loading/error/empty/success wrapper for one home-page section (design doc §3.3: every
 * section must decide these four states explicitly - there's no shared skeleton/empty widget at
 * the `AppLayout` level to fall back on). Built on `ui`'s `LoadingState`/`ErrorState`/`EmptyState`
 * (RFC-0005 §6/§11 W13.6, WP4) rather than MUI `Alert`/`Skeleton` and the historical
 * `sectionTitleContainer*`/`verticalSection` classes it replaced.
 *
 * The section title is always rendered as its own heading above the active state, deliberately
 * kept out of `ErrorState.title`/`EmptyState.title` (which default to "something went wrong"/the
 * empty message itself) - `tests/e2e/home.spec.ts` waits for the "Mes médias" section title to be
 * visible regardless of which of the four states it lands in.
 */
const HomeSection: FC<PropsWithChildren<HomeSectionProps>> = ({
    title,
    isLoading,
    isError,
    onRetry,
    isEmpty,
    emptyLabel,
    children
}) => {
    if (isLoading) {
        return (
            <div className='rf-home-section'>
                <SectionHeading title={title} />
                <LoadingState variant='shelf' />
            </div>
        );
    }

    if (isError) {
        return (
            <div className='rf-home-section'>
                <SectionHeading title={title} />
                <ErrorState
                    message={globalize.translate('ErrorDefault')}
                    retryLabel={globalize.translate('Retry')}
                    onRetry={onRetry}
                />
            </div>
        );
    }

    if (isEmpty) {
        if (!emptyLabel) return null;

        return (
            <div className='rf-home-section'>
                <SectionHeading title={title} />
                <EmptyState title={emptyLabel} />
            </div>
        );
    }

    return <>{children}</>;
};

export default HomeSection;
