/**
 * VideoStreamer — camera / screen capture for Gemini Live (MyTutor parity).
 * Google recommends ~1 JPEG frame per second for Live video input.
 */

export type VideoSource = "camera" | "screen";

const MAX_CAPTURE_WIDTH = 1280;
/** Gemini Live docs: JPEG ~1 FPS for video stream input. */
const SCREEN_FPS = 1;
const CAMERA_FPS = 1;

async function waitForVideoFrame(v: HTMLVideoElement): Promise<void> {
  await Promise.race([
    new Promise<void>((resolve) => {
      const tryOk = () => {
        if (v.videoWidth > 0 && v.videoHeight > 0) {
          v.removeEventListener("loadeddata", tryOk);
          v.removeEventListener("loadedmetadata", tryOk);
          resolve();
        }
      };
      v.addEventListener("loadeddata", tryOk);
      v.addEventListener("loadedmetadata", tryOk);
      tryOk();
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
  await v.play().catch(() => {});
}

function isMostlyBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const sample = 24;
  const sw = Math.max(1, Math.floor(w / sample));
  const sh = Math.max(1, Math.floor(h / sample));
  const data = ctx.getImageData(0, 0, sw, sh);
  let sum = 0;
  for (let i = 0; i < data.data.length; i += 4) {
    sum += data.data[i] + data.data[i + 1] + data.data[i + 2];
  }
  const avg = sum / (data.data.length / 4);
  return avg < 8;
}

export class VideoStreamer {
  private stream: MediaStream | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private hiddenVideo: HTMLVideoElement | null = null;
  private previewElement: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  async start(
    source: VideoSource,
    onFrame: (b64: string) => void,
    preview?: HTMLVideoElement | null,
    fps?: number,
    onEnded?: () => void,
  ): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("VideoStreamer requires a browser environment");
    }

    const targetFps =
      fps ?? (source === "screen" ? SCREEN_FPS : CAMERA_FPS);

    this.stream =
      source === "camera"
        ? await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
            audio: false,
          })
        : await navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: { ideal: 15, max: 30 },
              displaySurface: "monitor",
            } as MediaTrackConstraints,
            audio: false,
          });

    const hidden = document.createElement("video");
    hidden.srcObject = this.stream;
    hidden.muted = true;
    hidden.playsInline = true;
    hidden.setAttribute("playsinline", "true");
    this.hiddenVideo = hidden;
    await waitForVideoFrame(hidden);

    this.previewElement = preview ?? null;
    if (preview) {
      preview.srcObject = this.stream;
      preview.muted = true;
      preview.playsInline = true;
      await waitForVideoFrame(preview);
    }

    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    if (!this.ctx) throw new Error("Canvas 2D context unavailable");

    let lastW = 0;
    let lastH = 0;
    const resizeCanvas = () => {
      const el = this.hiddenVideo;
      if (!el || !this.canvas) return;
      let w = el.videoWidth || 640;
      let h = el.videoHeight || 480;
      if (w <= 0 || h <= 0) {
        w = 640;
        h = 480;
      }
      if (w > MAX_CAPTURE_WIDTH) {
        h = Math.round((h * MAX_CAPTURE_WIDTH) / w);
        w = MAX_CAPTURE_WIDTH;
      }
      this.canvas.width = w;
      this.canvas.height = h;
      lastW = el.videoWidth;
      lastH = el.videoHeight;
    };
    resizeCanvas();

    const periodMs = Math.max(1000, Math.floor(1000 / Math.max(1, targetFps)));

    const captureFrame = () => {
      try {
        if (!this.stream?.active) return;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          return;
        }
        const el = this.hiddenVideo;
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!el || !ctx || !canvas) return;
        if (
          el.videoWidth > 0 &&
          el.videoHeight > 0 &&
          (el.videoWidth !== lastW || el.videoHeight !== lastH)
        ) {
          resizeCanvas();
        }
        if (el.videoWidth <= 0 || el.videoHeight <= 0) return;
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        if (isMostlyBlank(ctx, canvas.width, canvas.height)) return;
        const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
        const b64 = dataUrl.split(",")[1];
        if (b64) onFrame(b64);
      } catch {
        /* tab unfocused or frame not ready */
      }
    };

    captureFrame();
    this.intervalId = setInterval(captureFrame, periodMs);

    const track = this.stream.getVideoTracks()[0];
    if (track) {
      track.addEventListener("ended", () => {
        this.stop();
        onEnded?.();
      });
    }
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.hiddenVideo) {
      this.hiddenVideo.srcObject = null;
    }
    if (this.previewElement) {
      this.previewElement.srcObject = null;
    }
    this.hiddenVideo = null;
    this.previewElement = null;
    this.canvas = null;
    this.ctx = null;
    this.stream = null;
  }
}
