const path = require('path');
const { merge } = require('webpack-merge');

const common = require('./webpack.common');
const {
    mainBundleAsset,
    mainBundleBudgetBytes
} = require('./webpack.performance-budget.json');
const { bootModules } = require('./webpack.delivery-budget.json');
const {
    DeliveryStatsPlugin
} = require('./scripts/lib/delivery-stats-plugin.cjs');

module.exports = merge(common, {
    mode: 'production',
    entry: {
        ...common.entry,
        serviceworker: './serviceworker.js'
    },
    plugins: [
        // Writes the slim asset graph `npm run verify:delivery-budget` reads. OUTSIDE `dist/` on
        // purpose: it is a measurement artifact, not something shipped to a browser, and the
        // production build must not gain a file it did not have before.
        new DeliveryStatsPlugin({
            outputPath: path.resolve(__dirname, 'delivery-stats/stats.json'),
            bootModules
        })
    ],
    performance: {
        hints: 'error',
        // Raw (uncompressed) byte size, not gzip - see webpack.performance-budget.json and
        // scripts/verify-bundle-budget.mjs for the rationale (single measurement method used both
        // here and by the standalone script, no extra compression dependency, no risk of the two
        // numbers drifting apart).
        maxAssetSize: mainBundleBudgetBytes,
        // splitChunks (see `optimization` above) fans the "main.tesserafin" entrypoint out across
        // dozens of vendor/theme chunks by design - their sum is not "the bundle principal" this
        // budget targets (RFC-0002 §7 "Final measurements" / W13.1), so the entrypoint-sum check
        // is disabled and only the specific asset below is gated via assetFilter.
        maxEntrypointSize: Number.MAX_SAFE_INTEGER,
        assetFilter: (assetFilename) => assetFilename === mainBundleAsset
    }
});
