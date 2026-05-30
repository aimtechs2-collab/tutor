/**
 * PCMDownsampleProcessor — buffers mic input, downsamples to 16 kHz mono Int16.
 * Batching (~85 ms @ 48 kHz) cuts WebSocket/JSON overhead vs per-quantum sends.
 */
class PCMDownsampleProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._inputRate = (options.processorOptions || {}).inputSampleRate || 48000;
    this._outputRate = 16000;
    this._active = true;
    this._buffer = [];
    this._bufferSize = 2048;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "stop") this._active = false;
    };
  }

  _flush() {
    if (!this._buffer.length) return;
    const channel = new Float32Array(this._buffer);
    this._buffer = [];

    const ratio = this._inputRate / this._outputRate;
    const outLen = Math.floor(channel.length / ratio);
    if (outLen === 0) return;

    const int16 = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i * ratio;
      const lo = Math.floor(src);
      const hi = Math.min(lo + 1, channel.length - 1);
      const t = src - lo;
      const sample = channel[lo] * (1 - t) + channel[hi] * t;
      int16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    }

    this.port.postMessage({ type: "pcm_chunk", buffer: int16.buffer }, [int16.buffer]);
  }

  process(inputs) {
    if (!this._active) return false;
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;

    for (let i = 0; i < channel.length; i++) {
      this._buffer.push(channel[i]);
    }
    if (this._buffer.length >= this._bufferSize) {
      this._flush();
    }
    return true;
  }
}

registerProcessor("pcm-downsample-processor", PCMDownsampleProcessor);
