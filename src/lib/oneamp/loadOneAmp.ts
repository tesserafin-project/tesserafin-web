/**
 * Browser side of the OneAmp host (contract §4.2, §9.2): the real loaders
 * behind `HostDeps`. This module, the worklet and the wasm are only reached
 * through a dynamic import made with the experimental flag on, so none of
 * them is in the initial bundle, and with the flag off no request is made.
 */
import {
    type HostDeps,
    type HostGraph,
    type HostNode,
    OneAmpHost
} from './oneampHost';

// Emitted by webpack as hashed assets (`new URL(…, import.meta.url)`).
const WASM_URL = new URL('./oneamp_wasm.wasm', import.meta.url);
const WORKLET_URL = new URL('./oneampWorklet.js', import.meta.url);

let moduleLoad: Promise<WebAssembly.Module> | null = null;
const worklets = new WeakMap<BaseAudioContext, Promise<void>>();

/**
 * Compiled once per page. `compile(arrayBuffer)` rather than
 * `compileStreaming`, so a server serving `.wasm` with another MIME type
 * still works. A failure stays failed: no retry loop (§4.7.3).
 */
function loadModule(): Promise<WebAssembly.Module> {
    moduleLoad ??= fetch(WASM_URL).then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return WebAssembly.compile(await res.arrayBuffer());
    });
    return moduleLoad;
}

function addWorklet(context: BaseAudioContext): Promise<void> {
    let load = worklets.get(context);
    if (!load) {
        load = context.audioWorklet.addModule(WORKLET_URL.href);
        worklets.set(context, load);
    }
    return load;
}

function available(): boolean {
    return (
        typeof AudioWorkletNode === 'function' &&
        typeof WebAssembly === 'object' &&
        typeof WebAssembly.compile === 'function'
    );
}

export const browserDeps: HostDeps = {
    loadModule,
    addWorklet,
    createNode: (context, options) =>
        new AudioWorkletNode(
            context,
            'tesserafin-oneamp',
            options
        ) as unknown as HostNode,
    available
};

export function createOneAmpHost(
    graph: HostGraph,
    initialFailure?: string | null
): OneAmpHost {
    return new OneAmpHost(graph, { ...browserDeps, initialFailure });
}

export { OneAmpHost };
