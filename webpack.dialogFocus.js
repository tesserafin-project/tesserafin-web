const path = require('node:path');
const { NormalModuleReplacementPlugin } = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const captures = require('./webpack.captures');
const adapters = path.resolve(
    __dirname,
    'tests/dialogFocusBrowser/harness/adapters.ts'
);
// A production-mode component bundle, separate from the unmodified shipped app.
// Keep real inputManager/focusManager/keyboardNavigation/browser/dialogHelper.
module.exports = {
    ...captures,
    mode: 'production',
    entry: path.resolve(__dirname, 'tests/dialogFocusBrowser/harness/entry.ts'),
    output: {
        ...captures.output,
        path: path.resolve(__dirname, 'tests/dialogFocusBrowser/dist')
    },
    plugins: [
        new NormalModuleReplacementPlugin(
            /(^|[/\\])(RootAppRouter|apphost|playbackmanager|appRouter|layoutManager|appSettings)(\.[jt]sx?)?$/,
            adapters
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
