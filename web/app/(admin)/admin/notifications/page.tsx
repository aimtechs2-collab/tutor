"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2, Mail, Send } from "lucide-react";
import { notify } from "@/lib/notifications";
import {
  EMAIL_TEMPLATE_VARS,
  NOTIFICATION_SEGMENTS,
  adminSendNotification,
  createEmailTemplate,
  fetchEmailTemplates,
  updateEmailTemplate,
  type EmailTemplate,
} from "@/lib/notifications-api";

type Tab = "compose" | "templates";

export default function AdminNotificationsPage() {
  const [tab, setTab] = useState<Tab>("compose");
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const [segment, setSegment] = useState("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailHtml, setEmailHtml] = useState("");

  const [tplKey, setTplKey] = useState("");
  const [tplName, setTplName] = useState("");
  const [tplSubject, setTplSubject] = useState("");
  const [tplHtml, setTplHtml] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      setTemplates(await fetchEmailTemplates());
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to load templates", { tone: "error" });
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "templates") void loadTemplates();
  }, [tab, loadTemplates]);

  useEffect(() => {
    if (!selectedTemplateId) return;
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (!tpl) return;
    setTplKey(tpl.key);
    setTplName(tpl.name);
    setTplSubject(tpl.subject);
    setTplHtml(tpl.html_body);
  }, [selectedTemplateId, templates]);

  async function handleSend() {
    if (!title.trim()) {
      notify("Title is required", { tone: "error" });
      return;
    }
    setSending(true);
    try {
      const result = await adminSendNotification({
        segment,
        title: title.trim(),
        body: body.trim(),
        send_email: sendEmail,
        email_subject: sendEmail ? emailSubject : undefined,
        email_html: sendEmail ? emailHtml : undefined,
      });
      notify(`Sent to ${result.created} user(s)`, { tone: "success" });
      setTitle("");
      setBody("");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Send failed", { tone: "error" });
    } finally {
      setSending(false);
    }
  }

  async function handleSaveTemplate() {
    if (!tplKey.trim() || !tplName.trim() || !tplSubject.trim()) {
      notify("Key, name, and subject are required", { tone: "error" });
      return;
    }
    setSavingTemplate(true);
    try {
      if (selectedTemplateId) {
        await updateEmailTemplate(selectedTemplateId, {
          key: tplKey.trim(),
          name: tplName.trim(),
          subject: tplSubject.trim(),
          html_body: tplHtml,
        });
        notify("Template updated", { tone: "success" });
      } else {
        const created = await createEmailTemplate({
          key: tplKey.trim(),
          name: tplName.trim(),
          subject: tplSubject.trim(),
          html_body: tplHtml,
        });
        setSelectedTemplateId(created.id);
        notify("Template created", { tone: "success" });
      }
      await loadTemplates();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", { tone: "error" });
    } finally {
      setSavingTemplate(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-2">
          <Bell size={20} className="text-[var(--primary)]" />
          <div>
            <h1 className="text-xl font-semibold text-[var(--foreground)]">Notifications</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Compose in-app messages and manage email templates
            </p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-[var(--border)]">
          {(
            [
              { id: "compose" as Tab, label: "Compose & send" },
              { id: "templates" as Tab, label: "Email templates" },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === id
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "compose" ? (
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Audience segment</label>
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              >
                {NOTIFICATION_SEGMENTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              Also send email (requires Resend or SMTP)
            </label>
            {sendEmail ? (
              <>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">Email subject</label>
                  <input
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">Email HTML body</label>
                  <textarea
                    value={emailHtml}
                    onChange={(e) => setEmailHtml(e.target.value)}
                    rows={6}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs"
                  />
                </div>
              </>
            ) : null}
            <button
              type="button"
              disabled={sending}
              onClick={() => void handleSend()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send notification
            </button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 lg:col-span-1">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Templates</h2>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTemplateId(null);
                    setTplKey("");
                    setTplName("");
                    setTplSubject("");
                    setTplHtml("");
                  }}
                  className="text-xs text-[var(--primary)] hover:underline"
                >
                  New
                </button>
              </div>
              {loadingTemplates ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={20} className="animate-spin text-[var(--muted-foreground)]" />
                </div>
              ) : (
                <div className="mt-2 space-y-1">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${
                        selectedTemplateId === tpl.id
                          ? "bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))] text-[var(--primary)]"
                          : "text-[var(--foreground)] hover:bg-[var(--background)]"
                      }`}
                    >
                      {tpl.name}
                      <span className="block text-[10px] text-[var(--muted-foreground)]">{tpl.key}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 lg:col-span-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <Mail size={16} />
                Template editor
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Variables: {EMAIL_TEMPLATE_VARS.join(", ")}
              </p>
              <input
                value={tplKey}
                onChange={(e) => setTplKey(e.target.value)}
                placeholder="key e.g. welcome_email"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
              <input
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="Display name"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
              <input
                value={tplSubject}
                onChange={(e) => setTplSubject(e.target.value)}
                placeholder="Email subject"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
              <textarea
                value={tplHtml}
                onChange={(e) => setTplHtml(e.target.value)}
                rows={12}
                placeholder="<p>Hello {{username}}, welcome to AIMTutor!</p>"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs"
              />
              <button
                type="button"
                disabled={savingTemplate}
                onClick={() => void handleSaveTemplate()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {savingTemplate ? <Loader2 size={14} className="animate-spin" /> : null}
                Save template
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
