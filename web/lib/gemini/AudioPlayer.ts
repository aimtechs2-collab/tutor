/**
 * AudioPlayer — Gemini Live playback worklet (MyTutor parity).
 */

interface AudioPlayerWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;

  async init(): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("AudioPlayer requires a browser environment");
    }
    const Ctor =
      window.AudioContext ?? (window as AudioPlayerWindow).webkitAudioContext;
    if (!Ctor) throw new Error("AudioContext not supported");

    this.ctx = new Ctor({ sampleRate: 24000 });
    await this.ctx.audioWorklet.addModule("/worklets/playback.worklet.js");
    this.node = new AudioWorkletNode(this.ctx, "pcm-playback-processor");
    this.node.connect(this.ctx.destination);
  }

  async resume(): Promise<void> {
    if (this.ctx?.state === "suspended") await this.ctx.resume();
  }

  playChunk(b64: string): void {
    if (!this.node) return;
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const i16 = new Int16Array(u8.buffer);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
    this.node.port.postMessage({ type: "chunk", samples: f32 }, [f32.buffer]);
  }

  interrupt(): void {
    this.node?.port.postMessage({ type: "interrupt" });
  }

  destroy(): void {
    try {
      this.node?.disconnect();
    } catch {
      /* ignore */
    }
    this.ctx?.close().catch(() => {});
    this.node = null;
    this.ctx = null;
  }
}
