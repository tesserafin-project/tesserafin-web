import type { PlaybackMethod } from '../api/types';

const getPlaybackMethodColor = (method: PlaybackMethod) => {
    switch (method) {
        case 'DirectPlay':
            return 'success';
        case 'Remux':
            return 'info';
        case 'Transcode':
            return 'warning';
    }
};

export default getPlaybackMethodColor;
