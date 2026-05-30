"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, History, Loader2, RotateCcw, Save, Send } from "lucide-react";
import { notify } from "@/lib/notifications";
import {
  createPromptVersion,
  fetchTutorPersona,
  liveTestPersona,
  rollbackPrompt,
  updateTutorPersona,
  type PromptVersion,
  type TutorPersona,
} from "@/lib/tutor-personas-api";

export default function AdminTutorPersonaDetailPage() {
  const params = useParams<{ personaId: string }>();
  const personaId = useMemo(() => String(params?.personaId ?? ""), [params]);

  const [persona, setPersona] = useState<TutorPersona | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [expertiseTags, setExpertiseTags] = useState("");
  const [voiceModel, setVoiceModel] = useState("");
  const [voiceBadge, setVoiceBadge] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [tone, setTone] = useState("friendly");
  const [verbosity, setVerbosity] = useState("balanced");

  const [systemPrompt, setSystemPrompt] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [testMessage, setTestMessage] = useState("Explain the Pythagorean theorem simply.");
  const [testReply, setTestReply] = useState("");

  const load = useCallback(async () => {
    if (!personaId) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchTutorPersona(personaId);
      setPersona(data);
      setName(data.name);
      setDescription(data.description);
      setAvatarUrl(data.avatar_url);
      setExpertiseTags((data.expertise_tags ?? []).join(", "));
      setVoiceModel(data.voice_model);
      setVoiceBadge(data.voice_badge);
      const behavior = data.behavior_settings ?? {};
      setTemperature(Number(behavior.temperature ?? 0.7));
      setTone(String(behavior.tone ?? "friendly"));
      setVerbosity(String(behavior.verbosity ?? "balanced"));
      setSystemPrompt(data.current_prompt?.system_prompt ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load persona");
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaveIdentity() {
    if (!persona) return;
    setSaving(true);
    try {
      const tags = expertiseTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const updated = await updateTutorPersona(persona.id, {
        name: name.trim(),
        description: description.trim(),
        avatar_url: avatarUrl.trim(),
        expertise_tags: tags,
        voice_model: voiceModel.trim(),
        voice_badge: voiceBadge.trim(),
        behavior_settings: { temperature, tone, verbosity },
      });
      setPersona(updated);
      notify("Persona saved", { tone: "success" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", { tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePrompt() {
    if (!persona || !systemPrompt.trim()) return;
    setPromptSaving(true);
    try {
      const updated = await createPromptVersion(persona.id, {
        system_prompt: systemPrompt.trim(),
        change_note: changeNote.trim() || "Updated prompt",
      });
      setPersona(updated);
      setChangeNote("");
      notify("New prompt version saved", { tone: "success" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Prompt save failed", { tone: "error" });
    } finally {
      setPromptSaving(false);
    }
  }

  async function handleRollback(version: PromptVersion) {
    if (!persona) return;
    if (!window.confirm(`Rollback to version ${version.version_number}?`)) return;
    try {
      const updated = await rollbackPrompt(persona.id, version.id);
      setPersona(updated);
      setSystemPrompt(updated.current_prompt?.system_prompt ?? "");
      notify(`Rolled back to v${version.version_number}`, { tone: "success" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Rollback failed", { tone: "error" });
    }
  }

  async function handleLiveTest() {
    if (!persona || !testMessage.trim()) return;
    setTesting(true);
    setTestReply("");
    try {
      const result = await liveTestPersona(persona.id, testMessage.trim());
      setTestReply(result.reply);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Test failed", { tone: "error" });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <Loader2 size={28} className="animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (error || !persona) {
    return (
      <div className="min-h-screen bg-[var(--background)] px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Persona not found"}
        </div>
      </div>
    );
  }

  const versions = persona.prompt_versions ?? [];

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/tutor-personas"
            className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--card)]"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-[var(--foreground)]">{persona.name}</h1>
            <p className="text-sm text-[var(--muted-foreground)]">/{persona.slug}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Identity */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Identity</h2>
            <div className="mt-3 space-y-3">
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Description" value={description} onChange={setDescription} multiline />
              <Field label="Avatar URL" value={avatarUrl} onChange={setAvatarUrl} />
              <Field
                label="Expertise tags (comma-separated)"
                value={expertiseTags}
                onChange={setExpertiseTags}
              />
              <Field label="Voice model" value={voiceModel} onChange={setVoiceModel} />
              <Field label="Voice badge" value={voiceBadge} onChange={setVoiceBadge} />
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveIdentity()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save identity
              </button>
            </div>
          </section>

          {/* Behavior */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Behavior settings</h2>
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">
                  Temperature ({temperature.toFixed(1)})
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">Tone</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="friendly">Friendly</option>
                  <option value="professional">Professional</option>
                  <option value="encouraging">Encouraging</option>
                  <option value="socratic">Socratic</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">Verbosity</label>
                <select
                  value={verbosity}
                  onChange={(e) => setVerbosity(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="concise">Concise</option>
                  <option value="balanced">Balanced</option>
                  <option value="detailed">Detailed</option>
                </select>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Behavior settings are saved with identity.
              </p>
            </div>
          </section>

          {/* Prompt + history */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">System prompt</h2>
            <div className="mt-3 space-y-3">
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={10}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs"
                placeholder="You are an expert tutor..."
              />
              <Field
                label="Change note (for new version)"
                value={changeNote}
                onChange={setChangeNote}
              />
              <button
                type="button"
                disabled={promptSaving}
                onClick={() => void handleSavePrompt()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {promptSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save as new version
              </button>

              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                  <History size={12} />
                  Version history
                </div>
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {versions.map((version) => {
                    const isCurrent = version.id === persona.current_prompt_version_id;
                    return (
                      <div
                        key={version.id}
                        className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs ${
                          isCurrent
                            ? "bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))]"
                            : "bg-[var(--background)]"
                        }`}
                      >
                        <div>
                          <span className="font-medium">v{version.version_number}</span>
                          {isCurrent ? (
                            <span className="ml-1 text-[var(--primary)]">(current)</span>
                          ) : null}
                          {version.change_note ? (
                            <span className="ml-1 text-[var(--muted-foreground)]">
                              — {version.change_note}
                            </span>
                          ) : null}
                        </div>
                        {!isCurrent ? (
                          <button
                            type="button"
                            onClick={() => void handleRollback(version)}
                            className="inline-flex items-center gap-0.5 text-[var(--primary)] hover:underline"
                          >
                            <RotateCcw size={10} />
                            Rollback
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Live test panel */}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Live test</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Send a test message using the current system prompt
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              placeholder="Test message..."
            />
            <button
              type="button"
              disabled={testing}
              onClick={() => void handleLiveTest()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Test
            </button>
          </div>
          {testReply ? (
            <div className="mt-3 rounded-lg bg-[var(--background)] p-3 text-sm text-[var(--foreground)] whitespace-pre-wrap">
              {testReply}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-[var(--muted-foreground)]">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}
