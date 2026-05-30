/**
 * GeminiLiveClient — direct WebSocket to Gemini Live (MyTutor /teacher parity).
 * Auth via ephemeral token from POST /api/v1/gemini-live/token.
 */

const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export interface GeminiCallbacks {
  onReady?: () => void;
  onAudioChunk?: (b64: string) => void;
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string) => void;
  onInterrupted?: () => void;
  onTurnComplete?: () => void;
  onError?: (err: Error) => void;
  onClose?: (info: { code: number; reason: string }) => void;
  onGoAway?: (info: { timeLeft?: string }) => void;
  onResumptionUpdate?: (info: { newHandle?: string; resumable?: boolean }) => void;
}

interface ServerPart {
  text?: string;
  inlineData?: { mimeType?: string; data: string };
  inline_data?: { mime_type?: string; data: string };
}

interface ServerContent {
  interrupted?: boolean;
  turnComplete?: boolean;
  turn_complete?: boolean;
  modelTurn?: { parts?: ServerPart[] };
  model_turn?: { parts?: ServerPart[] };
  inputTranscription?: { text?: string };
  input_transcription?: { text?: string };
  outputTranscription?: { text?: string };
  output_transcription?: { text?: string };
}

interface ServerMessage {
  setupComplete?: unknown;
  setup_complete?: unknown;
  serverContent?: ServerContent;
  server_content?: ServerContent;
  error?: { code?: number; message?: string };
  goAway?: { timeLeft?: string; time_left?: string };
  go_away?: { timeLeft?: string; time_left?: string };
  sessionResumptionUpdate?: {
    newHandle?: string;
    new_handle?: string;
    resumable?: boolean;
  };
  session_resumption_update?: {
    newHandle?: string;
    new_handle?: string;
    resumable?: boolean;
  };
}

export interface ConnectOptions {
  model?: string;
  voiceName?: string;
  sessionResumptionHandle?: string | null;
}

function getModelTurnParts(sc: ServerContent): ServerPart[] {
  const mt = sc.modelTurn ?? sc.model_turn;
  return mt?.parts ?? [];
}

function inlineAudioB64(part: ServerPart): string | undefined {
  const id = part.inlineData ?? part.inline_data;
  if (!id?.data) return undefined;
  const mime = (id as { mimeType?: string; mime_type?: string }).mimeType ??
    (id as { mime_type?: string }).mime_type ?? "";
  if (!mime.includes("audio")) return undefined;
  return id.data;
}

function looksLikeInternalThought(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (
    t.startsWith("**") &&
    (t.includes("I've crafted") ||
      t.includes("Initiating Conversation") ||
      t.includes("My current focus"))
  ) {
    return true;
  }
  return false;
}

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private setupCompleteReceived = false;
  private intentionalClose = false;
  private lastServerErrorMessage: string | null = null;
  private modelInterrupted = false;

  constructor(private readonly callbacks: GeminiCallbacks) {}

  async connect(token: string, opts: ConnectOptions = {}): Promise<void> {
    const model = (opts.model ?? "gemini-3.1-flash-live-preview")
      .trim()
      .replace(/^models\//, "");
    const voiceName = opts.voiceName ?? "Aoede";
    const handle = opts.sessionResumptionHandle?.trim() || null;
    const url = `${WS_BASE}?access_token=${encodeURIComponent(token)}`;

    this.intentionalClose = false;
    this.setupCompleteReceived = false;
    this.modelInterrupted = false;
    this.lastServerErrorMessage = null;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._send({
        setup: {
          model: `models/${model}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
          realtimeInputConfig: {
            automaticActivityDetection: { disabled: false },
            activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          ...(handle ? { sessionResumption: { handle } } : { sessionResumption: {} }),
        },
      });
    };

    this.ws.onmessage = async (e: MessageEvent) => {
      try {
        const text =
          e.data instanceof Blob ? await e.data.text() : (e.data as string);
        const msg: ServerMessage = JSON.parse(text);

        if (msg.error?.message) {
          this.lastServerErrorMessage = msg.error.message;
          this.callbacks.onError?.(new Error(msg.error.message));
          return;
        }

        if (msg.setupComplete ?? msg.setup_complete) {
          this.setupCompleteReceived = true;
          this.callbacks.onReady?.();
          return;
        }

        const goAway = msg.goAway ?? msg.go_away;
        if (goAway) {
          this.callbacks.onGoAway?.({
            timeLeft: goAway.timeLeft ?? goAway.time_left,
          });
        }

        const sr = msg.sessionResumptionUpdate ?? msg.session_resumption_update;
        if (sr) {
          this.callbacks.onResumptionUpdate?.({
            newHandle: sr.newHandle ?? sr.new_handle,
            resumable: sr.resumable,
          });
        }

        const sc = msg.serverContent ?? msg.server_content;
        if (sc) {
          if (sc.interrupted) {
            this.modelInterrupted = true;
            this.callbacks.onInterrupted?.();
          }
          if (sc.turnComplete ?? sc.turn_complete) {
            this.modelInterrupted = false;
            this.callbacks.onTurnComplete?.();
          }
          if (!this.modelInterrupted) {
            for (const part of getModelTurnParts(sc)) {
              const audioB64 = inlineAudioB64(part);
              if (audioB64) this.callbacks.onAudioChunk?.(audioB64);
            }
          }
          const inTr = sc.inputTranscription ?? sc.input_transcription;
          if (inTr?.text && !looksLikeInternalThought(inTr.text)) {
            this.callbacks.onInputTranscript?.(inTr.text);
          }
          if (!this.modelInterrupted) {
            const outTr = sc.outputTranscription ?? sc.output_transcription;
            if (outTr?.text && !looksLikeInternalThought(outTr.text)) {
              this.callbacks.onOutputTranscript?.(outTr.text);
            }
          }
        }
      } catch (err) {
        this.callbacks.onError?.(
          err instanceof Error ? err : new Error("Failed to parse live message"),
        );
      }
    };

    this.ws.onerror = () => this.callbacks.onError?.(new Error("WebSocket error"));
    this.ws.onclose = (ev: CloseEvent) => {
      if (!this.setupCompleteReceived && !this.intentionalClose) {
        const detail = [
          this.lastServerErrorMessage,
          ev.reason?.trim() || null,
          ev.code ? `code ${ev.code}` : null,
        ]
          .filter(Boolean)
          .join(" — ");
        this.callbacks.onError?.(
          new Error(
            detail
              ? `Live session could not start: ${detail}`
              : "Live session could not start. Please try again.",
          ),
        );
      }
      this.callbacks.onClose?.({ code: ev.code, reason: ev.reason || "" });
    };
  }

  sendAudio(b64: string): void {
    this._send({
      realtimeInput: {
        audio: { mimeType: "audio/pcm;rate=16000", data: b64 },
      },
    });
  }

  sendText(text: string): void {
    if (!this.setupCompleteReceived) return;
    this._send({ realtimeInput: { text } });
  }

  sendImage(b64: string): void {
    this.sendVisualFrame(b64, "image/jpeg");
  }

  sendVisualFrame(b64: string, mimeType: string): void {
    if (!this.setupCompleteReceived || !b64) return;
    this._send({
      realtimeInput: {
        video: { mimeType, data: b64 },
      },
    });
  }

  private _send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    try {
      this.ws?.close();
    } finally {
      this.ws = null;
      this.setupCompleteReceived = false;
      this.modelInterrupted = false;
    }
  }
}
