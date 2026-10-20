import { debug } from 'utils/debug';

import { playbackManager } from 'components/playback/playbackmanager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from 'utils/events.ts';

export function enable(enabled) {
    debug('[autocast] %s cast player', enabled ? 'enabling' : 'disabling');
    if (enabled) {
        const currentPlayerInfo = playbackManager.getPlayerInfo();

        if (currentPlayerInfo?.id) {
            localStorage.setItem('autocastPlayerId', currentPlayerInfo.id);
        }
    } else {
        localStorage.removeItem('autocastPlayerId');
    }
}

export function isEnabled() {
    const playerId = localStorage.getItem('autocastPlayerId');
    const currentPlayerInfo = playbackManager.getPlayerInfo();

    return playerId && currentPlayerInfo?.id === playerId;
}

function onOpen() {
    const playerId = localStorage.getItem('autocastPlayerId');
    if (!playerId) {
        debug('[autocast] no active cast player');
        return;
    }

    debug('[autocast] initializing cast player', playerId);

    playbackManager
        .getTargets({ enableDiscovery: playerId === 'Google Cast' })
        .then(function (targets) {
            debug('[autocast] playback target count', targets.length);

            const player = targets.find((target) => target.id === playerId);
            if (player) {
                debug('[autocast] found target player');
                playbackManager.trySetActivePlayer(player.playerName, player);
            } else {
                debug('[autocast] selected cast player not found');
            }
        });
}

export function initialize() {
    debug('[autoCast] initializing connection listener');

    // Restore cast player if already signed in (e.g. on page reload)
    if (ServerConnections.getApiClients().some((c) => c.accessToken())) {
        onOpen();
    }

    Events.on(ServerConnections, 'localusersignedin', onOpen);
}
