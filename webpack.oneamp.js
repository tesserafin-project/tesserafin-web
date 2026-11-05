/**
 * Build for the server-free OneAmp browser suite (`tests/oneampBrowser/`,
 * contract §9.3 step 5).
 *
 * The real `htmlAudioPlayer` plugin, `audioGraph`, OneAmp bridge, host,
 * worklet and vendored wasm run in Chromium and Firefox. Only the app
 * services the plugin reaches for (apphost, router, settings, device
 * profile) are replaced by fixtures. The worklet and the wasm are emitted
 * through the same `new URL(…, import.meta.url)` as in production.
 *
 * Separate from the production config, like `webpack.captures.js`, so no
 * test entry can move the shipped bundle. Output: `tests/oneampBrowser/dist/`
 * (gitignored).
 */
const path = require('node:path');
const { NormalModuleReplacementPlugin } = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const captures = require('./webpack.captures');

const harness = (name) =>
    path.resolve(__dirname, `tests/oneampBrowser/harness/${name}`);

module.exports = {
    ...captures,
    entry: harness('entry.ts'),
    output: {
        path: path.resolve(__dirname, 'tests/oneampBrowser/dist'),
        filename: 'oneamp.bundle.js',
        assetModuleFilename: '[name].[hash][ext]',
        clean: true
    },
    plugins: [
        new NormalModuleReplacementPlugin(
            /(^|[/\\])(apphost|appRouter|userSettings|webSettings|browserDeviceProfile|appSettings)(\.[jt]s)?$/,
            (resource) => {
                resource.request = harness('services.ts');
            }
        ),
        new CopyPlugin({
            patterns: [{ from: harness('index.html'), to: 'index.html' }]
        })
    ]
};
