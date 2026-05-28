/**
 * PCMDownsampleProcessor — AudioWorklet that resamples mic input to 16 kHz
 * mono Int16 PCM and posts chunks to the main thread.
 *
 * Runs in the AudioWorklet global scope (separate thread from main).
 */
class PCMDownsampleProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._inputRate = (options.processorOptions || {}).inputSampleRate || 44100;
    this._outputRate = 16000;
    this._active = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "stop") this._active = false;
    };
  }

  process(inputs) {
    if (!this._active) return false;
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;

    const ratio = this._inputRate / this._outputRate;
    const outLen = Math.floor(channel.length / ratio);
    if (outLen === 0) return true;

    const int16 = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i * ratio;
      const lo = Math.floor(src);
      const hi = Math.min(lo + 1, channel.length - 1);
      const t = src - lo;
      const sample = channel[lo] * (1 - t) + channel[hi] * t;
      int16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    }

    this.port.postMessage({ type: "pcm_chunk", buffer: int16.buffer }, [
      int16.buffer,
    ]);
    return true;
  }
}

registerProcessor("pcm-downsample-processor", PCMDownsampleProcessor);
