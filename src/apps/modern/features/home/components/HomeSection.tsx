import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { type FC, type PropsWithChildren } from 'react';

import globalize from 'lib/globalize';

const SECTION_HEADER_CLASS =
    'sectionTitleContainer sectionTitleContainer-cards padded-left';
const SECTION_TITLE_CLASS = 'sectionTitle sectionTitle-cards';

const LOADING_PLACEHOLDER_KEYS = [0, 1, 2, 3, 4, 5];

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
    <Box className={SECTION_HEADER_CLASS}>
        <Typography className={SECTION_TITLE_CLASS} variant='h2'>
            {title}
        </Typography>
    </Box>
);

/**
 * Generic loading/error/empty/success wrapper for one home-page section (design doc §3.3: every
 * section must decide these four states explicitly - there's no shared skeleton/empty widget at
 * the `AppLayout` level to fall back on).
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
            <Box className='verticalSection'>
                <SectionHeading title={title} />
                <Stack
                    direction='row'
                    spacing={2}
                    sx={{ px: 2, overflow: 'hidden' }}
                >
                    {LOADING_PLACEHOLDER_KEYS.map((key) => (
                        <Skeleton
                            key={key}
                            variant='rounded'
                            width={260}
                            height={146}
                            sx={{ flexShrink: 0 }}
                        />
                    ))}
                </Stack>
            </Box>
        );
    }

    if (isError) {
        return (
            <Box className='verticalSection'>
                <SectionHeading title={title} />
                <Alert
                    severity='error'
                    sx={{ mx: 2 }}
                    action={
                        <Button color='inherit' size='small' onClick={onRetry}>
                            {globalize.translate('Retry')}
                        </Button>
                    }
                >
                    {globalize.translate('ErrorDefault')}
                </Alert>
            </Box>
        );
    }

    if (isEmpty) {
        if (!emptyLabel) return null;

        return (
            <Box className='verticalSection'>
                <SectionHeading title={title} />
                <Typography
                    variant='body2'
                    color='text.secondary'
                    sx={{ px: 2 }}
                >
                    {emptyLabel}
                </Typography>
            </Box>
        );
    }

    return <>{children}</>;
};

export default HomeSection;
