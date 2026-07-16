module.exports = {
    babelrcRoots: [
        // Keep the root as a root
        '.'
    ],
    sourceType: 'unambiguous',
    presets: [
        // No useBuiltIns/corejs: the evergreen browserslist baseline (RFC-0002) natively supports
        // everything core-js used to backfill, so automatic per-file polyfill injection is dead weight.
        '@babel/preset-env',
        '@babel/preset-react'
    ],
    plugins: [
    ]
};
