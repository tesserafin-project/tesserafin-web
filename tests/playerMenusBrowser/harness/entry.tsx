import React from 'react';
import { createRoot } from 'react-dom/client';

import TrackMenus from 'apps/modern/features/playerTracks/TrackMenus';
import { setTrackMenuHost } from 'apps/modern/features/playerTracks/playerTracks';
import keyboardNavigation from 'scripts/keyboardNavigation';
import 'ui/tokens/official.classic.css';
import 'ui/tokens/official.glass.css';
import 'styles/focus-visible.scss';

import { commands, removeTrigger, stopPlayback } from './engine';
import { commands as globalKeys } from './inputManager';
import layout from './layoutManager';

const glass =
    new URLSearchParams(window.location.search).get('theme') === 'glass';
document.documentElement.dataset.rfTheme = glass
    ? 'official.glass'
    : 'official.classic';
document.documentElement.dataset.rfMode = 'dark';
document.documentElement.dataset.rfSurfaceVariant = glass ? 'glass' : 'solid';
document.documentElement.classList.add(
    layout.tv ? 'layout-tv' : 'layout-desktop'
);
const controls = document.createElement('div');
controls.style.cssText =
    'position:fixed;bottom:30px;left:40px;display:flex;gap:16px';
const slot = document.createElement('div');
const settingsSlot = document.createElement('div');
controls.append(slot, settingsSlot);
document.body.append(controls);
setTrackMenuHost({ slot, settingsSlot, onMenuOpenChange: () => undefined });
keyboardNavigation.enable();
createRoot(document.getElementById('root')!).render(<TrackMenus />);

// Fixture engine controls, never bundled into the product.
Object.assign(window, {
    menuFixture: {
        removeTrigger,
        stopPlayback,
        commands,
        globalKeys,
        detachHost: () => {
            controls.remove();
            setTrackMenuHost(null);
        }
    }
});
