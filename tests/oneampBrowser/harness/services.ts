/**
 * Stand-ins for the app services `htmlAudioPlayer` and `htmlMediaHelper` reach for, in the
 * OneAmp browser harness. Every module matched by the replacement in `webpack.oneamp.js`
 * (apphost, appRouter, userSettings, webSettings, browserDeviceProfile, appSettings)
 * resolves here, so the exports are the union of what those importers use.
 */

// userSettings: the normalisation setting, driven by the spec.
export const harnessSettings = { normalisation: 'None' };
export function selectAudioNormalization(): string {
    return harnessSettings.normalisation;
}

// webSettings
export function getIncludeCorsCredentials(): Promise<boolean> {
    return Promise.resolve(false);
}

// apphost
export const appHost = {
    supports: () => false,
    getDeviceProfile: () => ({})
};

// appRouter
export const appRouter = { baseUrl: () => '' };

// browserDeviceProfile (default export) and appSettings (default export)
const store = new Map<string, unknown>();
const services = {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
        store.set(key, value);
    }
};
export default Object.assign(() => ({}), services);
