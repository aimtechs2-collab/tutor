"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, BookOpen, Loader2, Plus, RefreshCw } from "lucide-react";
import { notify } from "@/lib/notifications";
import {
  createAdminCourse,
  fetchAdminCourses,
  PLAN_OPTIONS,
  type CourseSummary,
} from "@/lib/courses-api";

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requiredPlan, setRequiredPlan] = useState<string>("free");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setCourses(await fetchAdminCourses());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load courses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!title.trim()) {
      notify("Course title is required", { tone: "error" });
      return;
    }
    setCreating(true);
    try {
      const course = await createAdminCourse({
        title: title.trim(),
        description: description.trim(),
        required_plan: requiredPlan,
        is_published: false,
      });
      notify("Course created", { tone: "success" });
      setShowModal(false);
      setTitle("");
      setDescription("");
      setRequiredPlan("free");
      await load();
      window.location.href = `/admin/courses/${encodeURIComponent(course.id)}`;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Create failed", { tone: "error" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-[var(--primary)]" />
            <div>
              <h1 className="text-xl font-semibold text-[var(--foreground)]">Courses</h1>
              <p className="text-sm text-[var(--muted-foreground)]">
                Curriculum management with enrollment and completion tracking
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-foreground)]"
            >
              <Plus size={14} />
              Create course
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
            Loading courses…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--destructive)]">
            {error}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {courses.map((course) => (
              <article
                key={course.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold text-[var(--foreground)]">{course.title}</h2>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">/{course.slug}</p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${
                      course.is_published
                        ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
                        : "border-[var(--border)] text-[var(--muted-foreground)]"
                    }`}
                  >
                    {course.is_published ? "Published" : "Draft"}
                  </span>
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-[var(--muted-foreground)]">
                  {course.description || "No description yet."}
                </p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-[var(--background)] p-2">
                    <p className="text-[var(--muted-foreground)]">Enrolled</p>
                    <p className="font-semibold text-[var(--foreground)]">{course.enrollment_count ?? 0}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--background)] p-2">
                    <p className="text-[var(--muted-foreground)]">Completion</p>
                    <p className="font-semibold text-[var(--foreground)]">{course.completion_rate ?? 0}%</p>
                  </div>
                  <div className="rounded-lg bg-[var(--background)] p-2">
                    <p className="text-[var(--muted-foreground)]">Lessons</p>
                    <p className="font-semibold text-[var(--foreground)]">{course.lesson_count ?? 0}</p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Link
                    href={`/admin/courses/${encodeURIComponent(course.id)}`}
                    className="flex-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-center text-xs hover:bg-[var(--background)]"
                  >
                    Edit
                  </Link>
                  <Link
                    href={`/admin/courses/${encodeURIComponent(course.id)}?tab=analytics`}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--background)]"
                  >
                    <BarChart3 size={12} />
                    Analytics
                  </Link>
                </div>
              </article>
            ))}
            {courses.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--muted-foreground)]">
                No courses yet. Create your first course to get started.
              </div>
            ) : null}
          </div>
        )}
      </div>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Create course</h2>
            <div className="mt-4 space-y-3">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Course title"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Description"
                rows={3}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
              <select
                value={requiredPlan}
                onChange={(event) => setRequiredPlan(event.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              >
                {PLAN_OPTIONS.map((plan) => (
                  <option key={plan} value={plan}>
                    Requires {plan} plan
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={creating}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
