// Measurement sink used only by the browser rig, never by the production graph.
class Recorder extends globalThis.AudioWorkletProcessor {
    process(inputs, outputs) {
        const input = inputs[0];
        if (input?.length === 2) {
            this.port.postMessage({
                frame: globalThis.currentFrame,
                left: input[0],
                right: input[1]
            });
            outputs[0][0].set(input[0]);
            outputs[0][1].set(input[1]);
        }
        return true;
    }
}
globalThis.registerProcessor('test-recorder', Recorder);
