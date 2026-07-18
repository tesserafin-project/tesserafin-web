/**
 * TEMPORARY measurement config for issue #23 (LANE B item 1). Not for merge.
 * Same as webpack.prod.js but emits to dist-measure/ and disables the performance guard, so a
 * candidate refactor can be built and byte-diffed without clobbering the baseline in dist/.
 */
const path = require('node:path');
const { merge } = require('webpack-merge');

const prod = require('./webpack.prod');

module.exports = merge(prod, {
    output: { path: path.resolve(__dirname, 'dist-measure') },
    performance: { hints: false }
});
