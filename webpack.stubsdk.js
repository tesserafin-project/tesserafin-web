/**
 * TEMPORARY measurement config for issue #23 (LANE B item 1). Not for merge.
 *
 * Identical to webpack.prod.js except `lib/reefin-sdk` resolves to a trivial stub. Diffing the
 * resulting main.jellyfin.bundle.js against the real prod build yields the CEILING of reefin-sdk's
 * minified footprint in the main bundle - the upper bound on what any barrel-narrowing or
 * route-lazy-loading refactor could possibly recover.
 *
 * Emits to dist-stub/ so it never clobbers the baseline build in dist/.
 */
const path = require('node:path');
const { merge } = require('webpack-merge');

const prod = require('./webpack.prod');

module.exports = merge(prod, {
    output: {
        path: path.resolve(__dirname, 'dist-stub')
    },
    resolve: {
        alias: {
            'lib/reefin-sdk': path.resolve(__dirname, 'scripts/_stub-reefin-sdk.js')
        }
    },
    // The whole point is to shrink the asset below budget-relevant size; don't let the prod
    // performance guard fail the measurement build.
    performance: { hints: false }
});
