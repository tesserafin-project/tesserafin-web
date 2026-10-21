import { beforeEach, expect, it, vi } from 'vitest';
import Events from '../utils/events';

const fixture = vi.hoisted(() => ({
    manager: {
        getTargets: vi.fn(),
        trySetActivePlayer: vi.fn(),
        getPlayerInfo: vi.fn()
    },
    connections: {
        getApiClients: () => [{ accessToken: () => 'fixture-token' }],
        _callbacks: {}
    }
}));
vi.mock('components/playback/playbackmanager', () => ({
    playbackManager: fixture.manager
}));
vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: fixture.connections
}));
import { initialize } from './autocast';

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    fixture.connections._callbacks = {};
    fixture.manager.getTargets.mockResolvedValue([]);
});
it('does not enumerate or load Cast without a saved preference, including sign-in', () => {
    initialize();
    Events.trigger(fixture.connections, 'localusersignedin');
    expect(fixture.manager.getTargets).not.toHaveBeenCalled();
});
it('allows discovery on startup and sign-in only for explicitly saved Google Cast', async () => {
    localStorage.setItem('autocastPlayerId', 'Google Cast');
    const target = { id: 'Google Cast', playerName: 'Google Cast' };
    fixture.manager.getTargets.mockResolvedValue([target]);
    initialize();
    Events.trigger(fixture.connections, 'localusersignedin');
    await Promise.resolve();
    expect(fixture.manager.getTargets).toHaveBeenCalledTimes(2);
    expect(fixture.manager.getTargets).toHaveBeenCalledWith({
        enableDiscovery: true
    });
    expect(fixture.manager.trySetActivePlayer).toHaveBeenCalledWith(
        'Google Cast',
        target
    );
});
it('keeps saved household-session reconnection passive for Google Cast', async () => {
    localStorage.setItem('autocastPlayerId', 'household-tv');
    const target = { id: 'household-tv', playerName: 'session' };
    fixture.manager.getTargets.mockResolvedValue([target]);
    initialize();
    await Promise.resolve();
    expect(fixture.manager.getTargets).toHaveBeenCalledWith({
        enableDiscovery: false
    });
    expect(fixture.manager.trySetActivePlayer).toHaveBeenCalledWith(
        'session',
        target
    );
});
