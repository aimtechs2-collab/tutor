/**
 * AudioStreamer — mic capture for Gemini Live (MyTutor parity).
 */

interface AudioStreamerWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export class AudioStreamer {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  async start(onChunk: (b64: string) => void): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("AudioStreamer requires a browser environment");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is not available in this browser");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const Ctor =
      window.AudioContext ?? (window as AudioStreamerWindow).webkitAudioContext;
    if (!Ctor) throw new Error("AudioContext not supported");

    this.ctx = new Ctor({ sampleRate: 48000 });
    await this.ctx.audioWorklet.addModule("/worklets/capture.worklet.js");

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "audio-capture-processor");

    const inputRate = this.ctx.sampleRate;
    this.node.port.onmessage = ({ data }) => {
      if (data?.type !== "audio" || !data.data) return;
      const down = this._downsample(data.data as Float32Array, inputRate, 16000);
      onChunk(this._toBase64PCM16(down));
    };

    this.source.connect(this.node);
  }

  private _downsample(buf: Float32Array, from: number, to: number): Float32Array {
    if (from === to) return buf;
    const ratio = from / to;
    const out = new Float32Array(Math.floor(buf.length / ratio));
    for (let i = 0; i < out.length; i++) {
      out[i] = buf[Math.floor(i * ratio)];
    }
    return out;
  }

  private _toBase64PCM16(f32: Float32Array): string {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const c = Math.max(-1, Math.min(1, f32[i]));
      i16[i] = c < 0 ? c * 0x8000 : c * 0x7fff;
    }
    const u8 = new Uint8Array(i16.buffer);
    let s = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)));
    }
    return btoa(s);
  }

  stop(): void {
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.node?.disconnect();
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.source = null;
    this.node = null;
    this.stream = null;
    this.ctx = null;
  }
}
