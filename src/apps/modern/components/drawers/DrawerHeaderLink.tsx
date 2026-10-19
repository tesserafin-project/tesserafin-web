import Box from '@mui/material/Box';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import React from 'react';

import { useSystemInfo } from 'hooks/useSystemInfo';
import ListItemLink from 'components/ListItemLink';
import { getDisplayVersion } from 'utils/versions';

import appIcon from 'assets/branding/mark.svg';

const DrawerHeaderLink = () => {
    const { data: systemInfo } = useSystemInfo();

    return (
        <ListItemLink to='/'>
            <ListItemIcon sx={{ minWidth: 56 }}>
                <Box
                    component='img'
                    src={appIcon}
                    alt=''
                    aria-hidden
                    sx={{ height: '2.5rem', width: '2.5rem' }}
                />
            </ListItemIcon>
            <ListItemText
                primary={systemInfo?.ServerName || 'Tesserafin'}
                secondary={getDisplayVersion(systemInfo?.Version)}
                slotProps={{
                    primary: { variant: 'h6' }
                }}
            />
        </ListItemLink>
    );
};

export default DrawerHeaderLink;
