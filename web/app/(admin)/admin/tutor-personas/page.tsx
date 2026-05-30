"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Loader2, Plus, RefreshCw } from "lucide-react";
import { notify } from "@/lib/notifications";
import {
  createTutorPersona,
  fetchTutorPersonas,
  togglePersonaPublish,
  type TutorPersona,
} from "@/lib/tutor-personas-api";

export default function AdminTutorPersonasPage() {
  const [personas, setPersonas] = useState<TutorPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPersonas(await fetchTutorPersonas());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load personas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!name.trim()) {
      notify("Persona name is required", { tone: "error" });
      return;
    }
    setCreating(true);
    try {
      const persona = await createTutorPersona({
        name: name.trim(),
        description: description.trim(),
      });
      notify("Persona created", { tone: "success" });
      setShowModal(false);
      setName("");
      setDescription("");
      window.location.href = `/admin/tutor-personas/${encodeURIComponent(persona.id)}`;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Create failed", { tone: "error" });
    } finally {
      setCreating(false);
    }
  }

  async function handleTogglePublish(persona: TutorPersona) {
    setTogglingId(persona.id);
    try {
      const updated = await togglePersonaPublish(persona.id);
      setPersonas((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      notify(updated.is_published ? "Persona published" : "Persona unpublished", { tone: "success" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Toggle failed", { tone: "error" });
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot size={20} className="text-[var(--primary)]" />
            <div>
              <h1 className="text-xl font-semibold text-[var(--foreground)]">AI Tutors</h1>
              <p className="text-sm text-[var(--muted-foreground)]">
                Manage tutor personas, prompts, and behavior settings
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--card)]"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              <Plus size={14} />
              New persona
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-[var(--muted-foreground)]">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : personas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] px-6 py-16 text-center">
            <Bot size={32} className="mx-auto text-[var(--muted-foreground)]" />
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">No tutor personas yet</p>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white"
            >
              <Plus size={14} />
              Create your first persona
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {personas.map((persona) => (
              <div
                key={persona.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--primary)_15%,var(--card))] text-lg font-semibold text-[var(--primary)]">
                    {persona.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={persona.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      persona.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/tutor-personas/${encodeURIComponent(persona.id)}`}
                      className="font-medium text-[var(--foreground)] hover:text-[var(--primary)]"
                    >
                      {persona.name}
                    </Link>
                    <p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted-foreground)]">
                      {persona.description || "No description"}
                    </p>
                  </div>
                </div>

                {persona.expertise_tags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {persona.expertise_tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-[var(--background)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 flex items-center justify-between">
                  {persona.voice_badge ? (
                    <span className="rounded-md bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))] px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                      {persona.voice_badge}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--muted-foreground)]">No voice badge</span>
                  )}
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted-foreground)]">
                    <input
                      type="checkbox"
                      checked={persona.is_published}
                      disabled={togglingId === persona.id}
                      onChange={() => void handleTogglePublish(persona)}
                      className="rounded"
                    />
                    Published
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">New AI Tutor Persona</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  placeholder="e.g. Dr. Calculus"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  placeholder="Brief expertise summary"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg px-4 py-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--background)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => void handleCreate()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : null}
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
