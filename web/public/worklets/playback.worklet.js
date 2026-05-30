/**
 * PCM playback worklet — continuous low-latency queue for Gemini Live audio.
 */
class PCMPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this.port.onmessage = ({ data }) => {
      if (data.type === "chunk" && data.samples) {
        this._queue.push(data.samples);
      } else if (data.type === "interrupt") {
        this._queue = [];
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs && outputs[0] && outputs[0][0];
    if (!out) return true;

    if (!this._queue.length) {
      out.fill(0);
      return true;
    }

    let written = 0;
    while (written < out.length && this._queue.length) {
      const head = this._queue[0];
      const remaining = out.length - written;
      if (head.length <= remaining) {
        out.set(head, written);
        written += head.length;
        this._queue.shift();
      } else {
        out.set(head.subarray(0, remaining), written);
        this._queue[0] = head.subarray(remaining);
        written += remaining;
      }
    }

    if (written < out.length) {
      for (let i = written; i < out.length; i++) out[i] = 0;
    }

    return true;
  }
}

registerProcessor("pcm-playback-processor", PCMPlaybackProcessor);
