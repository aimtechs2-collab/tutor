"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { notify } from "@/lib/notifications";
import { fetchAuthStatus } from "@/lib/auth";
import {
  createPlan,
  deactivatePlan,
  listPlans,
  updatePlan,
  type PlanRecord,
  type PlanWritePayload,
} from "@/lib/admin-api";

type QuotaField =
  | "chat_messages"
  | "voice_minutes"
  | "quiz_generations"
  | "kb_uploads";

type QuotaFormState = Record<
  QuotaField,
  { unlimited: boolean; value: string }
>;

type PlanFormState = {
  name: string;
  display_name: string;
  price_monthly: string;
  price_yearly: string;
  quotas: QuotaFormState;
};

const QUOTA_FIELDS: Array<{ key: QuotaField; label: string }> = [
  { key: "chat_messages", label: "Chat messages" },
  { key: "voice_minutes", label: "Voice minutes" },
  { key: "quiz_generations", label: "Quiz generations" },
  { key: "kb_uploads", label: "KB uploads" },
];

function emptyQuotaState(): QuotaFormState {
  return {
    chat_messages: { unlimited: false, value: "100" },
    voice_minutes: { unlimited: false, value: "10" },
    quiz_generations: { unlimited: false, value: "5" },
    kb_uploads: { unlimited: false, value: "3" },
  };
}

function emptyFormState(): PlanFormState {
  return {
    name: "",
    display_name: "",
    price_monthly: "0",
    price_yearly: "0",
    quotas: emptyQuotaState(),
  };
}

function quotaFromPlan(plan: PlanRecord): QuotaFormState {
  const next = emptyQuotaState();
  for (const { key } of QUOTA_FIELDS) {
    const limit = plan[key];
    next[key] =
      limit === -1
        ? { unlimited: true, value: "0" }
        : { unlimited: false, value: String(limit) };
  }
  return next;
}

function formFromPlan(plan: PlanRecord): PlanFormState {
  return {
    name: plan.name,
    display_name: plan.display_name,
    price_monthly: String(plan.price_monthly),
    price_yearly: String(plan.price_yearly),
    quotas: quotaFromPlan(plan),
  };
}

function formatLimit(value: number): string {
  return value === -1 ? "Unlimited" : String(value);
}

function formatPrice(value: number): string {
  return value === 0 ? "Free" : `$${value.toFixed(2)}`;
}

function buildPayload(form: PlanFormState): PlanWritePayload {
  const quotas = QUOTA_FIELDS.reduce(
    (acc, { key }) => {
      const entry = form.quotas[key];
      acc[key] = entry.unlimited ? -1 : Number.parseInt(entry.value, 10) || 0;
      return acc;
    },
    {} as Record<QuotaField, number>,
  );

  return {
    name: form.name.trim().toLowerCase(),
    display_name: form.display_name.trim(),
    price_monthly: Number.parseFloat(form.price_monthly) || 0,
    price_yearly: Number.parseFloat(form.price_yearly) || 0,
    chat_messages: quotas.chat_messages,
    voice_minutes: quotas.voice_minutes,
    quiz_generations: quotas.quiz_generations,
    kb_uploads: quotas.kb_uploads,
  };
}

export default function AdminPlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanRecord | null>(null);
  const [form, setForm] = useState<PlanFormState>(emptyFormState());

  const activePlans = useMemo(
    () => plans.filter((plan) => plan.is_active),
    [plans],
  );
  const inactivePlans = useMemo(
    () => plans.filter((plan) => !plan.is_active),
    [plans],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPlans(await listPlans());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (!status?.authenticated) {
        router.replace("/login");
        return;
      }
      if (status.role !== "admin") {
        router.replace("/");
        return;
      }
      void load();
    });
  }, [load, router]);

  function openCreateModal() {
    setEditingPlan(null);
    setForm(emptyFormState());
    setModalOpen(true);
  }

  function openEditModal(plan: PlanRecord) {
    setEditingPlan(plan);
    setForm(formFromPlan(plan));
    setModalOpen(true);
  }

  function closeModal() {
    if (working) return;
    setModalOpen(false);
    setEditingPlan(null);
  }

  function updateQuotaField(
    key: QuotaField,
    patch: Partial<QuotaFormState[QuotaField]>,
  ) {
    setForm((current) => ({
      ...current,
      quotas: {
        ...current.quotas,
        [key]: { ...current.quotas[key], ...patch },
      },
    }));
  }

  async function handleSave() {
    if (!form.name.trim() || !form.display_name.trim()) {
      notify("Name and display name are required", { tone: "error" });
      return;
    }

    setWorking(true);
    try {
      const payload = buildPayload(form);
      if (editingPlan) {
        await updatePlan(editingPlan.id, payload);
        notify("Plan updated", { tone: "success" });
      } else {
        await createPlan(payload);
        notify("Plan created", { tone: "success" });
      }
      setModalOpen(false);
      setEditingPlan(null);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to save plan", {
        tone: "error",
      });
    } finally {
      setWorking(false);
    }
  }

  async function handleDeactivate(plan: PlanRecord) {
    if (
      !window.confirm(
        `Deactivate "${plan.display_name}"? Existing assignments stay active until changed.`,
      )
    ) {
      return;
    }
    setWorking(true);
    try {
      await deactivatePlan(plan.id);
      notify("Plan deactivated", { tone: "success" });
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to deactivate plan", {
        tone: "error",
      });
    } finally {
      setWorking(false);
    }
  }

  function renderPlanCard(plan: PlanRecord) {
    return (
      <article
        key={plan.id}
        className={`rounded-2xl border bg-[var(--card)] p-5 shadow-sm ${
          plan.is_active
            ? "border-[var(--border)]"
            : "border-[var(--border)] opacity-60"
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CreditCard size={16} className="text-[var(--primary)]" />
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                {plan.display_name}
              </h2>
            </div>
            <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
              {plan.name}
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
            {plan.user_count} users
          </span>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Monthly</p>
            <p className="font-medium text-[var(--foreground)]">
              {formatPrice(plan.price_monthly)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Yearly</p>
            <p className="font-medium text-[var(--foreground)]">
              {formatPrice(plan.price_yearly)}
            </p>
          </div>
        </div>

        <ul className="mb-5 space-y-1 text-xs text-[var(--muted-foreground)]">
          <li>Chat messages: {formatLimit(plan.chat_messages)}</li>
          <li>Voice minutes: {formatLimit(plan.voice_minutes)}</li>
          <li>Quiz generations: {formatLimit(plan.quiz_generations)}</li>
          <li>KB uploads: {formatLimit(plan.kb_uploads)}</li>
        </ul>

        {plan.is_active ? (
          <div className="flex gap-2">
            <button
              onClick={() => openEditModal(plan)}
              disabled={working}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--background)] disabled:opacity-40"
            >
              <Pencil size={14} />
              Edit
            </button>
            <button
              onClick={() => handleDeactivate(plan)}
              disabled={working}
              className="inline-flex flex-1 items-center justify-center rounded-lg border border-[var(--destructive)]/30 bg-[color-mix(in_srgb,var(--destructive)_10%,var(--card))] px-3 py-2 text-sm text-[var(--destructive)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Deactivate
            </button>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">Inactive plan</p>
        )}
      </article>
    );
  }

  return (
    <div className="h-screen overflow-y-auto px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-[var(--foreground)]">
              Subscription Plans
            </h1>
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
              Create plans, set quotas, and manage subscriptions
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--card)]"
          >
            <Plus size={14} />
            Create Plan
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-[var(--destructive)]/30 bg-[color-mix(in_srgb,var(--destructive)_10%,var(--card))] px-4 py-3 text-sm text-[var(--destructive)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">
            Loading plans…
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] py-16 text-center text-sm text-[var(--muted-foreground)]">
            No plans yet. Create your first subscription plan.
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">{activePlans.map(renderPlanCard)}</div>
            {inactivePlans.length > 0 ? (
              <div className="mt-10">
                <h2 className="mb-4 text-sm font-semibold text-[var(--muted-foreground)]">
                  Inactive plans
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {inactivePlans.map(renderPlanCard)}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                {editingPlan ? "Edit plan" : "Create plan"}
              </h2>
              <button
                onClick={closeModal}
                disabled={working}
                className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-40"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block text-xs text-[var(--muted-foreground)]">
                Name (slug)
                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm((current) => ({ ...current, name: e.target.value }))
                  }
                  disabled={working || Boolean(editingPlan)}
                  placeholder="pro"
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] disabled:opacity-60"
                />
              </label>

              <label className="block text-xs text-[var(--muted-foreground)]">
                Display name
                <input
                  value={form.display_name}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      display_name: e.target.value,
                    }))
                  }
                  disabled={working}
                  placeholder="Pro"
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-[var(--muted-foreground)]">
                  Monthly price
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price_monthly}
                    onChange={(e) =>
                      setForm((current) => ({
                        ...current,
                        price_monthly: e.target.value,
                      }))
                    }
                    disabled={working}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  />
                </label>
                <label className="block text-xs text-[var(--muted-foreground)]">
                  Yearly price
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price_yearly}
                    onChange={(e) =>
                      setForm((current) => ({
                        ...current,
                        price_yearly: e.target.value,
                      }))
                    }
                    disabled={working}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                  />
                </label>
              </div>

              <div className="space-y-3 border-t border-[var(--border)] pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  Quota limits
                </p>
                {QUOTA_FIELDS.map(({ key, label }) => {
                  const entry = form.quotas[key];
                  return (
                    <div
                      key={key}
                      className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-sm text-[var(--foreground)]">{label}</span>
                        <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                          <input
                            type="checkbox"
                            checked={entry.unlimited}
                            onChange={(e) =>
                              updateQuotaField(key, { unlimited: e.target.checked })
                            }
                            disabled={working}
                          />
                          Unlimited ∞
                        </label>
                      </div>
                      {!entry.unlimited ? (
                        <input
                          type="number"
                          min="0"
                          value={entry.value}
                          onChange={(e) =>
                            updateQuotaField(key, { value: e.target.value })
                          }
                          disabled={working}
                          className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeModal}
                disabled={working}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={working}
                className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm font-medium text-[var(--background)] hover:opacity-90 disabled:opacity-40"
              >
                {working ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
