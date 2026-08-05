/**
 * Build for the server-free capture harness (`tests/captures/`).
 *
 * A separate, self-contained config rather than an extension of `webpack.common.js`. Two reasons:
 *
 *   - the production graph carries the whole app — routers, the SDK, the legacy tree, the service
 *     worker — and none of it is needed to render one component. Extending it would make a capture
 *     run cost a full app build and couple screenshot evidence to unrelated build changes;
 *   - more importantly, the production config must not grow an entry that exists only for tests.
 *     `verify:bundle-budget` measures `main.tesserafin.bundle.js`, and a test entry sharing that
 *     graph is exactly the kind of thing that quietly moves it.
 *
 * Output goes to `tests/captures/dist/`, which is gitignored: captures are evidence, the bundle
 * that produced them is not.
 */
const path = require('node:path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    mode: 'development',
    // Inline source maps would double the bundle and are never read here — the harness is driven
    // by Playwright, not debugged in a browser.
    devtool: false,
    entry: path.resolve(__dirname, 'tests/captures/harness/entry.tsx'),
    output: {
        path: path.resolve(__dirname, 'tests/captures/dist'),
        filename: 'captures.bundle.js',
        clean: true
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        // Same module roots as the app, so `ui/...`, `themes/...` and `apps/...` resolve exactly as
        // they do in production. A different resolution here would mean the harness could render a
        // different module than the app does under the same import.
        modules: [
            path.resolve(__dirname, 'src'),
            path.resolve(__dirname, 'node_modules')
        ]
    },
    module: {
        rules: [
            {
                test: /\.tsx$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'esbuild-loader',
                        options: { loader: 'tsx', target: 'es2020' }
                    }
                ]
            },
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'esbuild-loader',
                        options: { loader: 'ts', target: 'es2020' }
                    }
                ]
            },
            {
                test: /\.mjs$/,
                resolve: { fullySpecified: false },
                type: 'javascript/auto'
            },
            {
                test: /\.(sa|sc|c)ss$/i,
                use: ['style-loader', 'css-loader', 'sass-loader']
            }
        ]
    },
    plugins: [
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
    ],
    performance: { hints: false },
    stats: 'errors-warnings'
};
