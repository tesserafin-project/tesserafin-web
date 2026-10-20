const path = require('node:path');
const { NormalModuleReplacementPlugin } = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const captures = require('./webpack.captures');

const fixture = (name) =>
    path.resolve(__dirname, `tests/playerMenusBrowser/harness/${name}.ts`);

// Component browser rig, separate from the shipped graph. The real menu, adapters,
// focusManager, keyboardNavigation and styles run against a fixture engine/API.
module.exports = {
    ...captures,
    entry: path.resolve(
        __dirname,
        'tests/playerMenusBrowser/harness/entry.tsx'
    ),
    output: {
        ...captures.output,
        path: path.resolve(__dirname, 'tests/playerMenusBrowser/dist')
    },
    resolve: {
        ...captures.resolve,
        alias: {
            'components/playback/playbackmanager$': fixture('engine'),
            'lib/jellyfin-apiclient$': fixture('services'),
            'apps/modern/features/playerPanels/playerStats$':
                fixture('services')
        }
    },
    plugins: [
        new NormalModuleReplacementPlugin(
            /(^|[/\\])(layoutManager|globalize|appSettings|inputManager)(\.[jt]s)?$/,
            (resource) => {
                const name = resource.request.match(
                    /([^/\\]+?)(?:\.[jt]s)?$/
                )[1];
                resource.request = fixture(name);
            }
        ),
        new CopyPlugin({
            patterns: [
                {
                    from: path.resolve(
                        __dirname,
                        'tests/captures/harness/index.html'
                    ),
                    to: 'index.html'
                }
            ]
        })
    ]
};
