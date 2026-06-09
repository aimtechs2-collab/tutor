import { apiFetch, apiUrl } from "@/lib/api";
import { isPublicAuthPath, sanitizePostAuthRedirect } from "@/lib/auth-routes";
import { invalidateClientCache, withClientCache } from "@/lib/client-cache";
import type { LLMSelection, StreamEvent } from "@/lib/unified-ws";

export interface SessionMessage {
  id: number;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  capability?: string;
  events: StreamEvent[];
  attachments: Array<{
    type: string;
    filename?: string;
    base64?: string;
    url?: string;
    mime_type?: string;
    id?: string;
    extracted_text?: string;
  }>;
  metadata?: Record<string, unknown>;
  created_at: number;
  /** Edit-branching: id of the message this row continues. `null` for the
   *  first message in a session. Siblings share the same parent. */
  parent_message_id?: number | null;
}

export interface SessionSummary {
  id: string;
  session_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  last_message: string;
  status?:
    | "idle"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "rejected";
  active_turn_id?: string;
  preferences?: {
    capability?: string;
    tools?: string[];
    knowledge_bases?: string[];
    language?: string;
    llm_selection?: LLMSelection | null;
    /** Edit-branching: maps a parent_message_id → the child id currently
     *  shown at that branch point. Missing keys default to the latest
     *  sibling (most recently created child). */
    selected_branches?: Record<string, number>;
  };
}

export interface ActiveTurnSummary {
  id: string;
  turn_id: string;
  session_id: string;
  capability: string;
  status: "running" | "completed" | "failed" | "cancelled" | "rejected";
  error: string;
  created_at: number;
  updated_at: number;
  finished_at?: number | null;
  last_seq: number;
}

export interface SessionDetail {
  id: string;
  session_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  status?:
    | "idle"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "rejected";
  active_turn_id?: string;
  compressed_summary?: string;
  summary_up_to_msg_id?: number;
  preferences?: {
    capability?: string;
    tools?: string[];
    knowledge_bases?: string[];
    language?: string;
    llm_selection?: LLMSelection | null;
    /** Edit-branching: maps a parent_message_id → the child id currently
     *  shown at that branch point. Missing keys default to the latest
     *  sibling (most recently created child). */
    selected_branches?: Record<string, number>;
  };
  messages: SessionMessage[];
  active_turns?: ActiveTurnSummary[];
}

export interface QuizResultItem {
  question_id?: string;
  question: string;
  question_type?: string;
  options?: Record<string, string>;
  user_answer: string;
  correct_answer: string;
  explanation?: string;
  difficulty?: string;
  is_correct: boolean;
}

async function expectJson<T>(response: Response): Promise<T> {
  if (response.status === 401 && typeof window !== "undefined") {
    if (!isPublicAuthPath(window.location.pathname)) {
      const next = encodeURIComponent(
        sanitizePostAuthRedirect(
          `${window.location.pathname}${window.location.search}`,
        ),
      );
      const clerkEnabled =
        process.env.NEXT_PUBLIC_AUTH_PROVIDER === "clerk" &&
        Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
      window.location.href = clerkEnabled
        ? `/sign-in?redirect_url=${next}`
        : `/login?next=${next}`;
      return new Promise(() => {});
    }
  }
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function listSessions(
  limit = 50,
  offset = 0,
  options?: { force?: boolean },
): Promise<SessionSummary[]> {
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return withClientCache<SessionSummary[]>(
    `sessions:${limit}:${offset}`,
    async () => {
      const response = await apiFetch(
        apiUrl(`/api/v1/sessions?${qs.toString()}`),
        {
          cache: "no-store",
        },
      );
      const data = await expectJson<{ sessions: SessionSummary[] }>(response);
      return (data.sessions ?? []).filter(
        (session) =>
          session.message_count > 0 || session.status === "running",
      );
    },
    {
      force: options?.force,
      ttlMs: 15_000,
    },
  );
}

export async function getSession(sessionId: string): Promise<SessionDetail> {
  const response = await apiFetch(apiUrl(`/api/v1/sessions/${sessionId}`), {
    cache: "no-store",
  });
  return expectJson<SessionDetail>(response);
}

export async function updateSessionTitle(
  sessionId: string,
  title: string,
): Promise<SessionDetail> {
  const response = await apiFetch(apiUrl(`/api/v1/sessions/${sessionId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const data = await expectJson<{ session: SessionDetail }>(response);
  invalidateClientCache("sessions:");
  return data.session;
}

export async function persistLiveTranscript(
  sessionId: string,
  turns: Array<{ role: "user" | "model"; text: string }>,
): Promise<{ session_id: string; count: number }> {
  const body = JSON.stringify({
    turns: turns.map((t) => ({
      role: t.role,
      text: t.text,
    })),
  });
  const paths = [
    `/api/v1/sessions/${sessionId}/live-transcript`,
    `/api/v1/gemini-live/transcript/${sessionId}`,
  ];

  let response: Response | null = null;
  for (const path of paths) {
    response = await apiFetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (response.status !== 404) break;
  }

  if (!response || response.status === 404) {
    throw new Error(
      "Live transcript could not be saved (API endpoint missing). Stop the app with Ctrl+C, then run `aimtutor start` again to load the latest backend.",
    );
  }
  const data = await expectJson<{
    session_id: string;
    count: number;
  }>(response);
  invalidateClientCache("sessions:");
  return data;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/v1/sessions/${sessionId}`), {
    method: "DELETE",
  });
  // Idempotent: duplicate deletes (double-click, stale sidebar row) should
  // still remove the chat from the UI without surfacing a runtime error.
  if (response.status === 404) {
    invalidateClientCache("sessions:");
    return;
  }
  await expectJson<{ deleted: boolean }>(response);
  invalidateClientCache("sessions:");
}

export async function updateSessionLLMSelection(
  sessionId: string,
  selection: LLMSelection | null,
): Promise<LLMSelection | null> {
  const response = await apiFetch(
    apiUrl(`/api/v1/sessions/${sessionId}/llm-selection`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm_selection: selection }),
    },
  );
  const data = await expectJson<{ llm_selection: LLMSelection | null }>(
    response,
  );
  invalidateClientCache("sessions:");
  return data.llm_selection ?? null;
}

export async function recordQuizResults(
  sessionId: string,
  answers: QuizResultItem[],
  turnId?: string | null,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/sessions/${sessionId}/quiz-results`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, turn_id: turnId || "" }),
    },
  );
  await expectJson<{ recorded: boolean }>(response);
}

export async function deleteMessage(
  sessionId: string,
  messageId: number,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/sessions/${sessionId}/messages/${messageId}`),
    { method: "DELETE" },
  );
  await expectJson<{ deleted: boolean }>(response);
}

export async function updateBranchSelection(
  sessionId: string,
  selectedBranches: Record<string, number>,
): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/sessions/${sessionId}/branch-selection`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_branches: selectedBranches }),
    },
  );
  await expectJson<{ selected_branches: Record<string, number> }>(response);
}
