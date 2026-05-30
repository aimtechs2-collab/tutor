/**
 * AudioWorklet — captures microphone audio in fixed-size chunks
 * and posts Float32Array buffers back to the main thread for
 * downsampling + Base64 PCM16 encoding before sending to Gemini Live.
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = [];
        this._bufferSize = 4096;
    }

    process(inputs) {
        const ch = inputs && inputs[0] && inputs[0][0];
        if (!ch) return true;

        for (let i = 0; i < ch.length; i++) {
            this._buffer.push(ch[i]);
        }

        if (this._buffer.length >= this._bufferSize) {
            this.port.postMessage({
                type: "audio",
                data: new Float32Array(this._buffer),
            });
            this._buffer = [];
        }
        return true;
    }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
