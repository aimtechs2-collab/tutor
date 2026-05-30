"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Ban, KeyRound, PauseCircle, PlayCircle, RefreshCw } from "lucide-react";
import { notify } from "@/lib/notifications";
import { fetchAuthStatus } from "@/lib/auth";
import {
  banUser,
  getUserById,
  resetUserPassword,
  suspendUser,
  unsuspendUser,
  type UserRecord,
} from "@/lib/admin-api";

type ReasonModalMode = "suspend" | "ban";

function formatDateTime(iso?: string): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Never";
  }
}

function statusPill(user: UserRecord) {
  if (user.banned) {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--destructive)]/30 bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] px-2.5 py-1 text-xs font-medium text-[var(--destructive)]">
        Banned
      </span>
    );
  }
  if (user.disabled) {
    return (
      <span className="inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))] px-2.5 py-1 text-xs font-medium text-[var(--primary)]">
        Suspended
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))] px-2.5 py-1 text-xs font-medium text-[var(--primary)]">
      <span
        className="inline-block h-2 w-2 rounded-full bg-[color-mix(in_srgb,var(--primary)_55%,var(--foreground))]"
        aria-hidden
      />
      Active
    </span>
  );
}

export default function AdminUserDetailPage() {
  const router = useRouter();
  const params = useParams<{ userId: string }>();
  const userId = useMemo(() => String(params?.userId ?? ""), [params]);

  const [user, setUser] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [reasonMode, setReasonMode] = useState<ReasonModalMode | null>(null);
  const [reason, setReason] = useState("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const loadUser = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError("");
    try {
      const found = await getUserById(userId);
      if (!found) {
        setError("User not found");
        setUser(null);
        return;
      }
      setUser(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load user");
    } finally {
      setLoading(false);
    }
  }, [userId]);

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
      void loadUser();
    });
  }, [loadUser, router]);

  function openReasonModal(mode: ReasonModalMode) {
    setReason("");
    setReasonMode(mode);
  }

  async function confirmReasonAction() {
    if (!reasonMode || !user) return;
    setWorking(true);
    try {
      if (reasonMode === "suspend") {
        await suspendUser(user.id, reason);
        notify("User suspended", { tone: "success" });
      } else {
        await banUser(user.id, reason);
        notify("User banned", { tone: "success" });
      }
      setReasonMode(null);
      await loadUser();
    } catch (e) {
      notify(e instanceof Error ? e.message : "User action failed", { tone: "error" });
    } finally {
      setWorking(false);
    }
  }

  async function handleUnsuspend() {
    if (!user) return;
    setWorking(true);
    try {
      await unsuspendUser(user.id);
      notify("User unsuspended", { tone: "success" });
      await loadUser();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to unsuspend user", { tone: "error" });
    } finally {
      setWorking(false);
    }
  }

  async function confirmPasswordReset() {
    if (!user) return;
    if (newPassword.length < 8) {
      notify("Password must be at least 8 characters", { tone: "error" });
      return;
    }
    setWorking(true);
    try {
      await resetUserPassword(user.id, newPassword);
      notify("Password reset", { tone: "success" });
      setShowPasswordModal(false);
      setNewPassword("");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to reset password", { tone: "error" });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/admin/users"
            className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <ArrowLeft size={15} />
            Users
          </Link>
          <button
            onClick={loadUser}
            disabled={loading}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--muted-foreground)]">
            Loading user...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--foreground)]">
            {error}
          </div>
        ) : user ? (
          <div className="space-y-5">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    {statusPill(user)}
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)]">
                      {user.role}
                    </span>
                  </div>
                  <h1 className="text-2xl font-semibold text-[var(--foreground)]">
                    {user.username}
                  </h1>
                  <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
                    {user.id}
                  </p>
                  <div className="mt-4 grid gap-2 text-sm text-[var(--muted-foreground)] sm:grid-cols-2">
                    <p>Joined: {formatDateTime(user.created_at)}</p>
                    <p>Suspended: {formatDateTime(user.suspended_at)}</p>
                    {user.suspension_reason ? (
                      <p className="sm:col-span-2">Suspension reason: {user.suspension_reason}</p>
                    ) : null}
                    {user.ban_reason ? (
                      <p className="sm:col-span-2">Ban reason: {user.ban_reason}</p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 md:justify-end">
                  <button
                    onClick={() => openReasonModal("suspend")}
                    disabled={working || user.disabled || user.banned}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))] px-3 py-2 text-sm text-[var(--primary)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <PauseCircle size={15} />
                    Suspend
                  </button>
                  {user.disabled && !user.banned ? (
                    <button
                      onClick={handleUnsuspend}
                      disabled={working}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_18%,var(--card))] px-3 py-2 text-sm font-medium text-[var(--primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      <PlayCircle size={15} />
                      Unsuspend
                    </button>
                  ) : null}
                  <button
                    onClick={() => openReasonModal("ban")}
                    disabled={working || Boolean(user.banned)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--destructive)]/30 bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] px-3 py-2 text-sm text-[var(--destructive)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Ban size={15} />
                    Ban
                  </button>
                  <button
                    onClick={() => setShowPasswordModal(true)}
                    disabled={working}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    <KeyRound size={15} />
                    Reset Password
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
              User control changes are audited and take effect immediately for password auth.
            </section>
          </div>
        ) : null}
      </div>

      {reasonMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {reasonMode === "suspend" ? "Suspend user" : "Ban user"}
            </h2>
            <label className="mt-4 block text-xs text-[var(--muted-foreground)]">
              Reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                className="mt-1 w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setReasonMode(null)}
                disabled={working}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={confirmReasonAction}
                disabled={working}
                className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm font-medium text-[var(--background)] hover:opacity-90 disabled:opacity-40"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showPasswordModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              Reset password
            </h2>
            <label className="mt-4 block text-xs text-[var(--muted-foreground)]">
              New password
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowPasswordModal(false)}
                disabled={working}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={confirmPasswordReset}
                disabled={working}
                className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm font-medium text-[var(--background)] hover:opacity-90 disabled:opacity-40"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
