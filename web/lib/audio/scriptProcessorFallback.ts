/**
 * Fallback mic capture using the deprecated ScriptProcessorNode.
 * Used when AudioWorklet is unavailable (older Firefox / mobile Safari).
 * Downsamples from the AudioContext sample rate to 16 kHz and fires onChunk
 * with each Int16Array buffer.
 */
export function createScriptProcessorCapture(
  audioCtx: AudioContext,
  sourceNode: MediaStreamAudioSourceNode,
  onChunk: (pcm: Int16Array) => void,
): ScriptProcessorNode {
  const bufferSize = 4096;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
  const inputRate = audioCtx.sampleRate;
  const outputRate = 16000;
  const ratio = inputRate / outputRate;

  processor.onaudioprocess = (e: AudioProcessingEvent) => {
    const float32 = e.inputBuffer.getChannelData(0);
    const outLen = Math.floor(float32.length / ratio);
    if (outLen === 0) return;
    const int16 = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i * ratio;
      const lo = Math.floor(src);
      const hi = Math.min(lo + 1, float32.length - 1);
      const t = src - lo;
      const sample = float32[lo] * (1 - t) + float32[hi] * t;
      int16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    }
    onChunk(int16);
  };

  sourceNode.connect(processor);
  // Connect to destination to keep the graph alive (Safari quirk)
  processor.connect(audioCtx.destination);
  return processor;
}
