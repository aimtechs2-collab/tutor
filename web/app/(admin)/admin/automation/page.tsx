"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Play, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import { notify } from "@/lib/notifications";
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TEMPLATES,
  AUTOMATION_TRIGGERS,
  createAutomationRule,
  deleteAutomationRule,
  fetchAutomationLogs,
  fetchAutomationRules,
  formatTriggerLabel,
  triggerParamFromTrigger,
  runAutomationRuleNow,
  toggleAutomationRule,
  updateAutomationRule,
  type AutomationLog,
  type AutomationRule,
} from "@/lib/automation-api";

function emptyAction(type: string): Record<string, unknown> {
  switch (type) {
    case "send_in_app_notification":
      return { type, title: "AIMTutor notice", message: "Hi {username}, this is an automated message." };
    case "suspend_user":
      return { type, reason: "Automated suspension for {username}" };
    case "add_quota_bonus":
      return { type, metric: "chat_messages", amount: 25 };
    case "create_risk_flag":
      return { type, risk_type: "automation", severity: "medium", message: "Created by automation" };
    case "notify_admin":
      return { type, message: "Automation event for user {username} ({user_id})" };
    default:
      return { type, message: "Automation event for rule {rule_id}" };
  }
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Never";
  }
}

export default function AdminAutomationPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [triggerType, setTriggerType] = useState<string>(AUTOMATION_TRIGGERS[0].type);
  const [triggerParam, setTriggerParam] = useState(String(AUTOMATION_TRIGGERS[0].defaultValue));
  const [triggerMetric, setTriggerMetric] = useState("chat_messages");
  const [actions, setActions] = useState<Array<Record<string, unknown>>>([
    emptyAction("send_in_app_notification"),
  ]);

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedId) ?? null,
    [rules, selectedId],
  );

  const triggerDef = useMemo(
    () => AUTOMATION_TRIGGERS.find((item) => item.type === triggerType) ?? AUTOMATION_TRIGGERS[0],
    [triggerType],
  );

  const builtTrigger = useMemo(() => {
    const trigger: Record<string, unknown> = { type: triggerType };
    const numeric = Number(triggerParam);
    if (triggerType === "user.quota_percent") {
      trigger.metric = triggerMetric;
      trigger.percent = Number.isFinite(numeric) ? numeric : 90;
    } else if (triggerType === "user.failed_payment") {
      trigger.within_hours = Number.isFinite(numeric) ? numeric : 24;
    } else if (triggerType === "schedule.daily") {
      trigger.hour_utc = Number.isFinite(numeric) ? numeric : 9;
    } else {
      trigger.days = Number.isFinite(numeric) ? numeric : 14;
    }
    return trigger;
  }, [triggerMetric, triggerParam, triggerType]);

  const loadFormFromRule = useCallback((rule: AutomationRule | null) => {
    if (!rule) {
      setName("");
      setDescription("");
      setEnabled(true);
      setTriggerType(AUTOMATION_TRIGGERS[0].type);
      setTriggerParam(String(AUTOMATION_TRIGGERS[0].defaultValue));
      setTriggerMetric("chat_messages");
      setActions([emptyAction("send_in_app_notification")]);
      return;
    }
    setName(rule.name);
    setDescription(rule.description);
    setEnabled(rule.enabled);
    const type = String(rule.trigger.type ?? AUTOMATION_TRIGGERS[0].type);
    setTriggerType(type);
    const def = AUTOMATION_TRIGGERS.find((item) => item.type === type) ?? AUTOMATION_TRIGGERS[0];
    setTriggerParam(String(triggerParamFromTrigger(rule.trigger, def.defaultValue)));
    setTriggerMetric(String(rule.trigger.metric ?? "chat_messages"));
    setActions(rule.actions.length > 0 ? rule.actions.map((action) => ({ ...action })) : [emptyAction("send_in_app_notification")]);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ruleData, logData] = await Promise.all([fetchAutomationRules(), fetchAutomationLogs()]);
      setRules(ruleData);
      setLogs(logData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load automation data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    loadFormFromRule(selectedRule);
  }, [selectedRule, loadFormFromRule]);

  function startNewRule() {
    setSelectedId(null);
    loadFormFromRule(null);
  }

  function applyTemplate(template: (typeof AUTOMATION_TEMPLATES)[number]) {
    setSelectedId(null);
    setName(template.name);
    setDescription(template.description);
    setEnabled(true);
    const type = String(template.trigger.type);
    setTriggerType(type);
    const def = AUTOMATION_TRIGGERS.find((item) => item.type === type) ?? AUTOMATION_TRIGGERS[0];
    const trigger = template.trigger as Record<string, unknown>;
    setTriggerParam(String(triggerParamFromTrigger(trigger, def.defaultValue)));
    setTriggerMetric(String(trigger.metric ?? "chat_messages"));
    setActions(template.actions.map((action) => ({ ...action })));
  }

  async function handleSave() {
    if (!name.trim()) {
      notify("Rule name is required", { tone: "error" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        enabled,
        trigger: builtTrigger,
        actions,
      };
      if (selectedId) {
        const updated = await updateAutomationRule(selectedId, payload);
        setRules((prev) => prev.map((rule) => (rule.id === updated.id ? updated : rule)));
        notify("Rule updated", { tone: "success" });
      } else {
        const created = await createAutomationRule(payload);
        setRules((prev) => [created, ...prev]);
        setSelectedId(created.id);
        notify("Rule created", { tone: "success" });
      }
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", { tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(rule: AutomationRule) {
    setWorkingId(rule.id);
    try {
      const updated = await toggleAutomationRule(rule.id);
      setRules((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Toggle failed", { tone: "error" });
    } finally {
      setWorkingId(null);
    }
  }

  async function handleRun(rule: AutomationRule) {
    setWorkingId(rule.id);
    try {
      const count = await runAutomationRuleNow(rule.id);
      notify(`Rule ran (${count} action(s))`, { tone: "success" });
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Run failed", { tone: "error" });
    } finally {
      setWorkingId(null);
    }
  }

  async function handleDelete(rule: AutomationRule) {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    setWorkingId(rule.id);
    try {
      await deleteAutomationRule(rule.id);
      if (selectedId === rule.id) {
        setSelectedId(null);
      }
      notify("Rule deleted", { tone: "success" });
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Delete failed", { tone: "error" });
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Zap size={20} className="text-[var(--primary)]" />
            <div>
              <h1 className="text-xl font-semibold text-[var(--foreground)]">Automation</h1>
              <p className="text-sm text-[var(--muted-foreground)]">
                Build IF-THEN rules for user lifecycle, billing, and admin alerts
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={startNewRule}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              <Plus size={14} />
              New rule
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--muted-foreground)]">
            <Loader2 size={16} className="animate-spin" />
            Loading automation rules…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--destructive)]">
            {error}
          </div>
        ) : (
          <>
            <div className="flex min-h-[560px] flex-col gap-4 lg:flex-row">
              <section className="w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 lg:w-[40%]">
                <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Rules</h2>
                <div className="space-y-2">
                  {rules.map((rule) => (
                    <button
                      key={rule.id}
                      type="button"
                      onClick={() => setSelectedId(rule.id)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                        selectedId === rule.id
                          ? "border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))]"
                          : "border-[var(--border)] bg-[var(--background)] hover:bg-[var(--card)]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-[var(--foreground)]">{rule.name}</p>
                          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                            {formatTriggerLabel(rule.trigger)}
                          </p>
                        </div>
                        <label className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(event) => {
                              event.stopPropagation();
                              void handleToggle(rule);
                            }}
                            disabled={workingId === rule.id}
                          />
                          On
                        </label>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                        <span>Runs: {rule.run_count}</span>
                        <span>Last: {formatDateTime(rule.last_run_at)}</span>
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleRun(rule);
                          }}
                          disabled={workingId === rule.id}
                          className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-0.5 text-[11px]"
                        >
                          <Play size={10} />
                          Run
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDelete(rule);
                          }}
                          disabled={workingId === rule.id}
                          className="inline-flex items-center gap-1 rounded border border-red-500/30 px-2 py-0.5 text-[11px] text-red-700 dark:text-red-300"
                        >
                          <Trash2 size={10} />
                          Delete
                        </button>
                      </div>
                    </button>
                  ))}
                  {rules.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">
                      No rules yet. Use a template below or create a new rule.
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 lg:w-[60%]">
                <h2 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
                  {selectedId ? "Edit rule" : "Create rule"}
                </h2>

                <div className="space-y-5">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Step 1 · Trigger
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <select
                        value={triggerType}
                        onChange={(event) => {
                          const next = event.target.value;
                          setTriggerType(next);
                          const def = AUTOMATION_TRIGGERS.find((item) => item.type === next);
                          if (def) setTriggerParam(String(def.defaultValue));
                        }}
                        className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      >
                        {AUTOMATION_TRIGGERS.map((trigger) => (
                          <option key={trigger.type} value={trigger.type}>
                            {trigger.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={triggerParam}
                        onChange={(event) => setTriggerParam(event.target.value)}
                        className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                        placeholder={triggerDef.paramKey}
                      />
                    </div>
                    {triggerType === "user.quota_percent" ? (
                      <select
                        value={triggerMetric}
                        onChange={(event) => setTriggerMetric(event.target.value)}
                        className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      >
                        <option value="chat_messages">Chat messages</option>
                        <option value="voice_minutes">Voice minutes</option>
                        <option value="quiz_generations">Quiz generations</option>
                        <option value="kb_uploads">KB uploads</option>
                      </select>
                    ) : null}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                        Step 2 · Actions
                      </p>
                      <select
                        defaultValue=""
                        onChange={(event) => {
                          const type = event.target.value;
                          if (!type) return;
                          setActions((prev) => [...prev, emptyAction(type)]);
                          event.target.value = "";
                        }}
                        className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                      >
                        <option value="">Add action…</option>
                        {AUTOMATION_ACTIONS.map((action) => (
                          <option key={action.type} value={action.type}>
                            {action.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      {actions.map((action, index) => (
                        <div
                          key={`${action.type}-${index}`}
                          className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-medium text-[var(--foreground)]">
                              {AUTOMATION_ACTIONS.find((item) => item.type === action.type)?.label ??
                                String(action.type)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setActions((prev) => prev.filter((_, i) => i !== index))}
                              className="text-xs text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                            >
                              Remove
                            </button>
                          </div>
                          <textarea
                            value={JSON.stringify(action, null, 2)}
                            onChange={(event) => {
                              try {
                                const parsed = JSON.parse(event.target.value) as Record<string, unknown>;
                                setActions((prev) => prev.map((item, i) => (i === index ? parsed : item)));
                              } catch {
                                // keep editing until valid JSON
                              }
                            }}
                            rows={4}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 font-mono text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Step 3 · Name & save
                    </p>
                    <div className="grid gap-3">
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Rule name"
                        className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      />
                      <textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Description (optional)"
                        rows={2}
                        className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      />
                      <label className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                        Enabled
                      </label>
                      <button
                        onClick={() => void handleSave()}
                        disabled={saving}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
                      >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                        {selectedId ? "Update rule" : "Save rule"}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Templates</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {AUTOMATION_TEMPLATES.map((template) => (
                  <button
                    key={template.name}
                    type="button"
                    onClick={() => applyTemplate(template)}
                    className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-left hover:border-[color-mix(in_srgb,var(--primary)_35%,var(--border))]"
                  >
                    <p className="font-medium text-[var(--foreground)]">{template.name}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{template.description}</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Recent execution log</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                      <th className="pb-2 pr-4 font-medium">Time</th>
                      <th className="pb-2 pr-4 font-medium">Rule</th>
                      <th className="pb-2 pr-4 font-medium">User</th>
                      <th className="pb-2 pr-4 font-medium">Success</th>
                      <th className="pb-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {logs.slice(0, 20).map((log) => (
                      <tr key={log.id}>
                        <td className="py-2 pr-4 text-[var(--muted-foreground)]">{formatDateTime(log.created_at)}</td>
                        <td className="py-2 pr-4">{log.rule_name || log.rule_id}</td>
                        <td className="py-2 pr-4">{log.username || log.user_id || "—"}</td>
                        <td className="py-2 pr-4">{log.success ? "Yes" : "No"}</td>
                        <td className="py-2 font-mono text-xs text-[var(--muted-foreground)]">
                          {JSON.stringify(log.actions).slice(0, 120)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
