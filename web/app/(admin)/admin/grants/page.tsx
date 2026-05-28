"use client";

/**
 * Admin Grants Management
 * Assign LLM models, knowledge bases, skills, and spaces to users.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Save, ChevronRight, User } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";
import { listUsers, type UserRecord } from "@/lib/admin-api";

interface Grant {
  version: number;
  user_id: string;
  models: { llm: LLMGrant[]; embedding: any[]; search: any[] };
  knowledge_bases: KBGrant[];
  skills: SkillGrant[];
  spaces: SpaceGrant[];
}

interface LLMGrant { provider: string; model_id: string; label?: string }
interface KBGrant  { name: string }
interface SkillGrant { name: string }
interface SpaceGrant { name: string }

interface LLMOption {
  provider: string;
  model_id: string;
  label: string;
  context_window?: number;
}

// ── helpers ───────────────────────────────────────────────────────────────

async function fetchGrant(userId: string): Promise<Grant | null> {
  const res = await apiFetch(apiUrl(`/api/v1/multi-user/users/${userId}/grants`));
  if (!res.ok) return null;
  const data = await res.json();
  return data.grant ?? null;
}

async function saveGrant(userId: string, grant: Grant): Promise<Grant | null> {
  const res = await apiFetch(apiUrl(`/api/v1/multi-user/users/${userId}/grants`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.grant ?? null;
}

// ── section card ──────────────────────────────────────────────────────────

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl" style={{ border: "1px solid var(--border)" }}>
      <div
        className="px-5 py-4"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--muted)" }}
      >
        <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          {title}
        </h3>
        <p className="mt-0.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
          {subtitle}
        </p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── toggle row ────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  sublabel,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  sublabel?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="text-sm" style={{ color: "var(--foreground)" }}>{label}</div>
        {sublabel && (
          <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{sublabel}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className="relative h-5 w-9 rounded-full transition-colors disabled:opacity-40"
        style={{ background: checked ? "var(--primary)" : "var(--muted)" }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform shadow-sm"
          style={{ transform: checked ? "translateX(16px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────

export default function GrantsPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [llmOptions, setLlmOptions] = useState<LLMOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listUsers()
      .then((all) => setUsers(all.filter((u) => u.role !== "admin")))
      .catch(() => {});

    apiFetch(apiUrl("/api/v1/settings/llm-options"))
      .then((r) => r.json())
      .then((opts: LLMOption[]) => setLlmOptions(Array.isArray(opts) ? opts : []))
      .catch(() => {});
  }, []);

  const selectUser = useCallback(async (user: UserRecord) => {
    setSelectedUser(user);
    setDirty(false);
    setSaved(false);
    const g = await fetchGrant(user.id);
    setGrant(
      g ?? {
        version: 1,
        user_id: user.id,
        models: { llm: [], embedding: [], search: [] },
        knowledge_bases: [],
        skills: [],
        spaces: [],
      },
    );
  }, []);

  const mutate = useCallback((fn: (g: Grant) => Grant) => {
    setGrant((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedUser || !grant) return;
    setSaving(true);
    try {
      const updated = await saveGrant(selectedUser.id, grant);
      if (updated) {
        setGrant(updated);
        setSaved(true);
        setDirty(false);
      }
    } finally {
      setSaving(false);
    }
  }, [selectedUser, grant]);

  // LLM helpers
  const hasLlm = (opt: LLMOption) =>
    (grant?.models?.llm ?? []).some(
      (m) => m.provider === opt.provider && m.model_id === opt.model_id,
    );

  const toggleLlm = (opt: LLMOption, on: boolean) =>
    mutate((g) => ({
      ...g,
      models: {
        ...g.models,
        llm: on
          ? [...(g.models.llm ?? []), { provider: opt.provider, model_id: opt.model_id, label: opt.label }]
          : (g.models.llm ?? []).filter((m) => !(m.provider === opt.provider && m.model_id === opt.model_id)),
      },
    }));

  const filteredUsers = users.filter(
    (u) =>
      !search ||
      u.username.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex h-full">
      {/* User list */}
      <div
        className="w-64 shrink-0 flex-col overflow-y-auto"
        style={{ borderRight: "1px solid var(--border)" }}
      >
        <div className="p-4">
          <h2 className="mb-3 text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            Grants
          </h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            className="w-full rounded-lg px-3 py-1.5 text-xs outline-none"
            style={{
              background: "var(--muted)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
            }}
          />
        </div>
        <div className="px-2 pb-4">
          {filteredUsers.length === 0 ? (
            <p className="px-2 py-4 text-xs" style={{ color: "var(--muted-foreground)" }}>
              No non-admin users yet.
            </p>
          ) : (
            filteredUsers.map((u) => (
              <button
                key={u.id}
                onClick={() => selectUser(u)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors"
                style={{
                  background:
                    selectedUser?.id === u.id ? "var(--accent)" : "transparent",
                }}
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                >
                  {u.username[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" style={{ color: "var(--foreground)" }}>
                    {u.username}
                  </div>
                </div>
                {selectedUser?.id === u.id && (
                  <ChevronRight size={13} style={{ color: "var(--muted-foreground)" }} />
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Grant editor */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedUser ? (
          <div
            className="flex h-full items-center justify-center text-sm"
            style={{ color: "var(--muted-foreground)" }}
          >
            <div className="text-center">
              <User size={32} className="mx-auto mb-3 opacity-30" />
              Select a user to manage their grants
            </div>
          </div>
        ) : !grant ? (
          <div className="flex h-32 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40" />
          </div>
        ) : (
          <div className="max-w-2xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold" style={{ color: "var(--foreground)" }}>
                  {selectedUser.username}
                </h2>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  Managing grants for this user
                </p>
              </div>
              <div className="flex items-center gap-2">
                {dirty && (
                  <span className="text-xs" style={{ color: "#f59e0b" }}>
                    Unsaved changes
                  </span>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-40"
                  style={{
                    background: saved ? "rgba(34,197,94,0.15)" : "var(--primary)",
                    color: saved ? "#22c55e" : "var(--primary-foreground)",
                  }}
                >
                  {saved ? <Check size={14} /> : <Save size={14} />}
                  {saving ? "Saving…" : saved ? "Saved" : "Save grants"}
                </button>
              </div>
            </div>

            {/* LLM Models */}
            <SectionCard
              title="🤖 LLM Models"
              subtitle="Which language models this user can access"
            >
              {llmOptions.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  No LLM profiles configured yet. Add models in Settings → Model Catalog.
                </p>
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {llmOptions.map((opt) => (
                    <ToggleRow
                      key={`${opt.provider}/${opt.model_id}`}
                      label={opt.label || opt.model_id}
                      sublabel={opt.provider}
                      checked={hasLlm(opt)}
                      onChange={(on) => toggleLlm(opt, on)}
                    />
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Knowledge Bases */}
            <SectionCard
              title="📚 Knowledge Bases"
              subtitle="Shared knowledge bases this user can query"
            >
              <KBSection
                grant={grant}
                mutate={mutate}
              />
            </SectionCard>

            {/* Skills */}
            <SectionCard
              title="🛠 Skills"
              subtitle="Agent skills this user can invoke"
            >
              <SkillSection grant={grant} mutate={mutate} />
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}

// ── KB section ────────────────────────────────────────────────────────────

function KBSection({
  grant,
  mutate,
}: {
  grant: Grant;
  mutate: (fn: (g: Grant) => Grant) => void;
}) {
  const [input, setInput] = useState("");
  const kbs = grant.knowledge_bases ?? [];

  const add = () => {
    const name = input.trim();
    if (!name || kbs.some((k) => k.name === name)) return;
    mutate((g) => ({ ...g, knowledge_bases: [...(g.knowledge_bases ?? []), { name }] }));
    setInput("");
  };

  const remove = (name: string) =>
    mutate((g) => ({ ...g, knowledge_bases: (g.knowledge_bases ?? []).filter((k) => k.name !== name) }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {kbs.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            No knowledge bases assigned.
          </p>
        ) : (
          kbs.map((k) => (
            <span
              key={k.name}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
              style={{ background: "var(--muted)", color: "var(--foreground)" }}
            >
              {k.name}
              <button
                onClick={() => remove(k.name)}
                className="opacity-50 hover:opacity-100"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="KB name…"
          className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
          style={{
            background: "var(--muted)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
          }}
        />
        <button
          onClick={add}
          disabled={!input.trim()}
          className="rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Skills section ────────────────────────────────────────────────────────

function SkillSection({
  grant,
  mutate,
}: {
  grant: Grant;
  mutate: (fn: (g: Grant) => Grant) => void;
}) {
  const [input, setInput] = useState("");
  const skills = grant.skills ?? [];

  const add = () => {
    const name = input.trim();
    if (!name || skills.some((s) => s.name === name)) return;
    mutate((g) => ({ ...g, skills: [...(g.skills ?? []), { name }] }));
    setInput("");
  };

  const remove = (name: string) =>
    mutate((g) => ({ ...g, skills: (g.skills ?? []).filter((s) => s.name !== name) }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {skills.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            No skills assigned.
          </p>
        ) : (
          skills.map((s) => (
            <span
              key={s.name}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
              style={{ background: "var(--muted)", color: "var(--foreground)" }}
            >
              {s.name}
              <button onClick={() => remove(s.name)} className="opacity-50 hover:opacity-100">
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Skill name…"
          className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
          style={{
            background: "var(--muted)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
          }}
        />
        <button
          onClick={add}
          disabled={!input.trim()}
          className="rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
