/**
 * Emits the slim, deterministic asset graph that the aggregate delivery budget is verified
 * against (scripts/verify-delivery-budget.mjs, webpack.delivery-budget.json).
 *
 * WHY A PLUGIN AND NOT `webpack --json`
 * -------------------------------------
 * `webpack --json` on this project writes a ~530 MB stats dump: every module, every reason,
 * every source-level detail, with absolute worktree paths embedded throughout. That file cannot
 * be read back by Node (`ERR_STRING_TOO_LONG`), cannot be a CI artifact, and its absolute paths
 * would make the measurement depend on where the repository happens to be checked out.
 *
 * This plugin writes the same graph facts the budget actually needs - who is initial, who is
 * async, which module lives in which counted chunk, which module issued which `import()` - in a
 * few hundred KB, using webpack's own relative `readableIdentifier`, with every collection
 * sorted. No timestamps, no absolute paths, no build-host metadata.
 *
 * WHY THE INITIAL SET COMES FROM THE EMITTED index.html
 * -----------------------------------------------------
 * "Initial delivery" is not "every initial chunk in the compilation": webpack.common.js declares
 * one entrypoint per `themes/*.scss` on top of `main.tesserafin`, and those theme stylesheets are
 * fetched by the theme manager at runtime, never by `index.html`. The only truthful definition of
 * what a cold visitor downloads before anything else is *what index.html asks for*, so that is
 * what is recorded here (`htmlInjected`), parsed out of the finished document. The verifier
 * cross-checks it against the declared entrypoints and fails closed when the two disagree, so
 * adding a chunk to index.html cannot slip past the budget.
 */
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const PLUGIN_NAME = 'DeliveryStatsPlugin';
const SCHEMA_VERSION = 1;
const HTML_ASSET = 'index.html';

/**
 * `hash: true` in html-webpack-plugin appends `?<compilation hash>`, and webpack percent-encodes
 * `@` in the chunk-derived filenames (`node_modules.%40mui.material.bundle.js`). The emitted
 * asset name is the decoded path without the query.
 */
function toAssetName(url) {
    return decodeURIComponent(String(url).split('?')[0]).replace(/^\.?\//, '');
}

/**
 * The injected set is read from the EMITTED index.html, not from html-webpack-plugin's
 * `beforeAssetTagGeneration` hook. `optimization.realContentHash` (on by default in production)
 * renames extracted CSS assets AFTER the tags are generated, so the hook's view carries stale
 * filenames - `43539.e482757e8cdecd228d91.css` where the build actually shipped
 * `43539.6a3c366228a3294a74f8.css`. Parsing the finished document is the only view that matches
 * what a browser will request, which is the whole point of the measurement.
 */
function parseInjected(html) {
    const js = [];
    const css = [];
    for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
        js.push(toAssetName(src));
    }
    for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
        if (!/\srel="stylesheet"/.test(tag)) continue;
        const href = /\shref="([^"]+)"/.exec(tag);
        if (href) css.push(toAssetName(href[1]));
    }
    return { js, css };
}

function sorted(values) {
    return [...values].sort();
}

/**
 * Yields the real source modules behind one chunk member.
 *
 * `ModuleConcatenationPlugin` (on by default in production) merges scope-hoistable modules into a
 * single `ConcatenatedModule` whose `readableIdentifier` is a SUMMARY - `./index.jsx + 8 modules`.
 * Recording that summary would hide every merged member from the progressive-delivery boundaries:
 * an authoring module concatenated into an initial chunk would simply not appear in the graph the
 * verifier inspects, and the boundary would report clean because it never saw it. So a
 * concatenation is expanded into its members, recursively.
 */
function flattenModule(module, out = []) {
    const inner = module?.modules;
    if (Array.isArray(inner) && inner.length > 0) {
        for (const child of inner) flattenModule(child, out);
    } else if (inner && typeof inner[Symbol.iterator] === 'function') {
        for (const child of inner) flattenModule(child, out);
    } else {
        out.push(module);
    }
    return out;
}

class DeliveryStatsPlugin {
    /**
     * @param {object} options
     * @param {string} options.outputPath Absolute path of the JSON file to write.
     * @param {string[]} options.bootModules Entry-side module identifiers whose `import()` calls
     *   are part of unconditional start-up. Modules of the chunks they pull in are recorded too,
     *   so the verifier can enforce the protected-module boundaries on them as well.
     */
    constructor({ outputPath, bootModules = [] }) {
        this.outputPath = outputPath;
        this.bootModules = new Set(bootModules);
    }

    apply(compiler) {
        compiler.hooks.done.tap(PLUGIN_NAME, (stats) => {
            const compilation = stats.compilation;

            // Read from the emitted file rather than from `compilation.getAsset(...).source`:
            // by the `done` hook webpack has replaced every asset source with a `SizeOnlySource`
            // ("Content and Map of this Source is not available"). The file on disk is also the
            // more honest input - it is literally what the server will hand a browser.
            // Read directly rather than guarding with `existsSync`: checking and then opening
            // is a check-then-use race, and a compilation with no index.html (the captures
            // config, for one) is an expected shape, not an error - it just has nothing to
            // record here.
            const htmlPath = join(compilation.outputOptions.path, HTML_ASSET);
            let htmlInjected = null;
            try {
                const parsed = parseInjected(readFileSync(htmlPath, 'utf8'));
                htmlInjected = {
                    js: sorted(parsed.js),
                    css: sorted(parsed.css)
                };
            } catch {
                htmlInjected = null;
            }
            const shortener = compilation.requestShortener;
            const chunkGraph = compilation.chunkGraph;

            const readable = (module) =>
                module ? module.readableIdentifier(shortener) : null;

            const chunkGroups = compilation.chunkGroups.map((group) => ({
                name: group.name ?? null,
                isEntrypoint: group.isInitial(),
                chunkIds: sorted(group.chunks.map((chunk) => String(chunk.id))),
                files: sorted(group.getFiles()),
                origins: (group.origins || [])
                    .map((origin) => ({
                        module: readable(origin.module),
                        request: origin.request ?? null
                    }))
                    .sort((a, b) =>
                        `${a.module}|${a.request}`.localeCompare(
                            `${b.module}|${b.request}`
                        )
                    )
            }));

            // Chunks whose module list is recorded: everything reachable without a user gesture.
            // Initial chunks, plus the chunks of any async group issued by a declared boot module
            // (see `bootModules`) - those are downloaded during start-up too, which is exactly
            // why a budget that ignored them could be dodged by wrapping an import in `import()`.
            const detailedChunkIds = new Set();
            for (const chunk of compilation.chunks) {
                if (chunk.canBeInitial())
                    detailedChunkIds.add(String(chunk.id));
            }
            for (const group of chunkGroups) {
                if (group.isEntrypoint) continue;
                if (
                    !group.origins.some((origin) =>
                        this.bootModules.has(origin.module)
                    )
                ) {
                    continue;
                }
                for (const id of group.chunkIds) detailedChunkIds.add(id);
            }

            const chunks = [...compilation.chunks]
                .map((chunk) => {
                    const id = String(chunk.id);
                    const entry = {
                        id,
                        names: sorted(chunk.name ? [chunk.name] : []),
                        initial: chunk.canBeInitial(),
                        files: sorted(chunk.files)
                    };
                    if (detailedChunkIds.has(id)) {
                        // First-party modules only. `node_modules` members are irrelevant to the
                        // progressive-delivery boundaries (which are about this repository's own
                        // authoring/feature code) and would multiply the artifact size.
                        const names = [];
                        for (const module of chunkGraph.getChunkModulesIterable(
                            chunk
                        )) {
                            for (const leaf of flattenModule(module)) {
                                const name = readable(leaf);
                                if (name && !name.includes('node_modules')) {
                                    names.push(name);
                                }
                            }
                        }
                        entry.modules = sorted([...new Set(names)]);
                    }
                    return entry;
                })
                .sort((a, b) => a.id.localeCompare(b.id));

            const entrypoints = {};
            for (const [name, entrypoint] of compilation.entrypoints) {
                entrypoints[name] = {
                    chunkIds: sorted(
                        entrypoint.chunks.map((chunk) => String(chunk.id))
                    ),
                    files: sorted(entrypoint.getFiles())
                };
            }

            const assets = {};
            for (const asset of compilation.getAssets()) {
                assets[asset.name] = asset.source.size();
            }

            const payload = {
                schemaVersion: SCHEMA_VERSION,
                // Deliberately NOT recorded: timestamps, absolute paths, host or worktree
                // identity. Two builds of the same commit from two different directories must
                // produce byte-identical output here.
                htmlInjected,
                entrypoints: Object.fromEntries(
                    sorted(Object.keys(entrypoints)).map((key) => [
                        key,
                        entrypoints[key]
                    ])
                ),
                assets: Object.fromEntries(
                    sorted(Object.keys(assets)).map((key) => [key, assets[key]])
                ),
                chunks,
                chunkGroups: chunkGroups.sort((a, b) =>
                    a.chunkIds.join(',').localeCompare(b.chunkIds.join(','))
                )
            };

            mkdirSync(dirname(this.outputPath), { recursive: true });
            writeFileSync(
                this.outputPath,
                JSON.stringify(payload, null, 1) + '\n'
            );
        });
    }
}

module.exports = { DeliveryStatsPlugin, SCHEMA_VERSION };
