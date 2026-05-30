import { apiFetch, apiUrl } from "@/lib/api";

export interface PromptVersion {
  id: string;
  persona_id: string;
  version_number: number;
  system_prompt: string;
  change_note: string;
  created_by: string;
  created_at: string;
}

export interface TutorPersona {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar_url: string;
  expertise_tags: string[];
  voice_model: string;
  voice_badge: string;
  is_published: boolean;
  behavior_settings: Record<string, unknown>;
  current_prompt_version_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  prompt_versions?: PromptVersion[];
  current_prompt?: PromptVersion | null;
}

async function parseError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  return fallback;
}

export async function fetchTutorPersonas(): Promise<TutorPersona[]> {
  const res = await apiFetch(apiUrl("/api/v1/admin/tutor-personas"));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load personas"));
  const data = await res.json();
  return data.personas ?? [];
}

export async function fetchTutorPersona(personaId: string): Promise<TutorPersona> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/tutor-personas/${encodeURIComponent(personaId)}`));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load persona"));
  const data = await res.json();
  return data.persona;
}

export async function createTutorPersona(payload: {
  name: string;
  description?: string;
  system_prompt?: string;
  expertise_tags?: string[];
  voice_badge?: string;
}): Promise<TutorPersona> {
  const res = await apiFetch(apiUrl("/api/v1/admin/tutor-personas"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create persona"));
  const data = await res.json();
  return data.persona;
}

export async function updateTutorPersona(
  personaId: string,
  payload: Partial<{
    name: string;
    slug: string;
    description: string;
    avatar_url: string;
    expertise_tags: string[];
    voice_model: string;
    voice_badge: string;
    behavior_settings: Record<string, unknown>;
  }>,
): Promise<TutorPersona> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/tutor-personas/${encodeURIComponent(personaId)}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update persona"));
  const data = await res.json();
  return data.persona;
}

export async function deleteTutorPersona(personaId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/tutor-personas/${encodeURIComponent(personaId)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete persona"));
}

export async function togglePersonaPublish(personaId: string): Promise<TutorPersona> {
  const res = await apiFetch(
    apiUrl(`/api/v1/admin/tutor-personas/${encodeURIComponent(personaId)}/toggle-publish`),
    { method: "POST" },
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to toggle publish"));
  const data = await res.json();
  return data.persona;
}

export async function createPromptVersion(
  personaId: string,
  payload: { system_prompt: string; change_note?: string },
): Promise<TutorPersona> {
  const res = await apiFetch(
    apiUrl(`/api/v1/admin/tutor-personas/${encodeURIComponent(personaId)}/prompt-versions`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to save prompt"));
  const data = await res.json();
  return data.persona;
}

export async function rollbackPrompt(personaId: string, versionId: string): Promise<TutorPersona> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/admin/tutor-personas/${encodeURIComponent(personaId)}/rollback/${encodeURIComponent(versionId)}`,
    ),
    { method: "POST" },
  );
  if (!res.ok) throw new Error(await parseError(res, "Failed to rollback"));
  const data = await res.json();
  return data.persona;
}

export async function liveTestPersona(
  personaId: string,
  message: string,
): Promise<{ reply: string; system_prompt: string }> {
  const res = await apiFetch(
    apiUrl(`/api/v1/admin/tutor-personas/${encodeURIComponent(personaId)}/test`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
  );
  if (!res.ok) throw new Error(await parseError(res, "Live test failed"));
  return res.json();
}
