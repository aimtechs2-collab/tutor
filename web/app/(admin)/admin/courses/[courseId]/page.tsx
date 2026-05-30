"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { notify } from "@/lib/notifications";
import {
  createLesson,
  createModule,
  deleteLesson,
  deleteModule,
  fetchAdminCourse,
  fetchCourseAnalytics,
  PLAN_OPTIONS,
  updateAdminCourse,
  updateLesson,
  type CourseAnalytics,
  type CourseDetail,
  type LessonRecord,
} from "@/lib/courses-api";

export default function AdminCourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const searchParams = useSearchParams();
  const courseId = useMemo(() => String(params?.courseId ?? ""), [params]);
  const showAnalytics = searchParams.get("tab") === "analytics";

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [analytics, setAnalytics] = useState<CourseAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    setError("");
    try {
      const [courseData, analyticsData] = await Promise.all([
        fetchAdminCourse(courseId),
        fetchCourseAnalytics(courseId),
      ]);
      setCourse(courseData);
      setAnalytics(analyticsData.analytics);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load course");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaveCourse() {
    if (!course) return;
    setSaving(true);
    try {
      const updated = await updateAdminCourse(course.id, {
        title: course.title,
        description: course.description,
        slug: course.slug,
        is_published: course.is_published,
        required_plan: course.required_plan,
        sort_order: course.sort_order,
      });
      setCourse((prev) => (prev ? { ...prev, ...updated } : prev));
      notify("Course saved", { tone: "success" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", { tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddModule() {
    if (!course) return;
    const title = window.prompt("Module title:");
    if (!title?.trim()) return;
    try {
      const module = await createModule(course.id, { title: title.trim() });
      setCourse((prev) =>
        prev ? { ...prev, modules: [...(prev.modules ?? []), module] } : prev,
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to add module", { tone: "error" });
    }
  }

  async function handleAddLesson(moduleId: string) {
    const title = window.prompt("Lesson title:");
    if (!title?.trim()) return;
    try {
      const lesson = await createLesson(moduleId, {
        title: title.trim(),
        content: `# ${title.trim()}\n\nLesson content goes here.`,
      });
      setCourse((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          modules: (prev.modules ?? []).map((module) =>
            module.id === moduleId
              ? { ...module, lessons: [...module.lessons, lesson] }
              : module,
          ),
        };
      });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to add lesson", { tone: "error" });
    }
  }

  async function handleLessonChange(lesson: LessonRecord) {
    try {
      const updated = await updateLesson(lesson.id, {
        title: lesson.title,
        slug: lesson.slug,
        content: lesson.content,
        content_type: lesson.content_type,
        sort_order: lesson.sort_order,
        duration_min: lesson.duration_min,
      });
      setCourse((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          modules: (prev.modules ?? []).map((module) => ({
            ...module,
            lessons: module.lessons.map((item) => (item.id === updated.id ? updated : item)),
          })),
        };
      });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Lesson update failed", { tone: "error" });
    }
  }

  async function handleDeleteModule(moduleId: string) {
    if (!window.confirm("Delete this module and all lessons?")) return;
    try {
      await deleteModule(moduleId);
      setCourse((prev) =>
        prev ? { ...prev, modules: (prev.modules ?? []).filter((m) => m.id !== moduleId) } : prev,
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Delete failed", { tone: "error" });
    }
  }

  async function handleDeleteLesson(lessonId: string, moduleId: string) {
    if (!window.confirm("Delete this lesson?")) return;
    try {
      await deleteLesson(lessonId);
      setCourse((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          modules: (prev.modules ?? []).map((module) =>
            module.id === moduleId
              ? { ...module, lessons: module.lessons.filter((lesson) => lesson.id !== lessonId) }
              : module,
          ),
        };
      });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Delete failed", { tone: "error" });
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--muted-foreground)]">
        <Loader2 size={16} className="mr-2 animate-spin" />
        Loading course…
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-sm text-[var(--destructive)]">
        {error || "Course not found"}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/courses"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs"
          >
            <ArrowLeft size={14} />
            Courses
          </Link>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">{course.title}</h1>
        </div>

        {showAnalytics && analytics ? (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="mb-4 text-sm font-semibold">Analytics</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Enrollments", analytics.enrollment_count],
                ["Completed", analytics.completed_count],
                ["Completion rate", `${analytics.completion_rate}%`],
                ["Avg lessons done", analytics.avg_lessons_completed],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl bg-[var(--background)] p-4">
                  <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
                  <p className="mt-1 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="mb-4 text-sm font-semibold">Course settings</h2>
            <div className="space-y-3">
              <input
                value={course.title}
                onChange={(event) => setCourse({ ...course, title: event.target.value })}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                placeholder="Title"
              />
              <input
                value={course.slug}
                onChange={(event) => setCourse({ ...course, slug: event.target.value })}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                placeholder="Slug"
              />
              <textarea
                value={course.description}
                onChange={(event) => setCourse({ ...course, description: event.target.value })}
                rows={4}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                placeholder="Description"
              />
              <select
                value={course.required_plan}
                onChange={(event) => setCourse({ ...course, required_plan: event.target.value })}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              >
                {PLAN_OPTIONS.map((plan) => (
                  <option key={plan} value={plan}>
                    Requires {plan}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={course.is_published}
                  onChange={(event) => setCourse({ ...course, is_published: event.target.checked })}
                />
                Published
              </label>
              <button
                onClick={() => void handleSaveCourse()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
              >
                <Save size={14} />
                Save course
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Modules & lessons</h2>
              <button
                onClick={() => void handleAddModule()}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs"
              >
                <Plus size={12} />
                Add module
              </button>
            </div>
            <div className="space-y-4">
              {(course.modules ?? []).map((module) => (
                <div key={module.id} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="font-medium text-[var(--foreground)]">{module.title}</p>
                    <div className="flex gap-1">
                      <button
                        onClick={() => void handleAddLesson(module.id)}
                        className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px]"
                      >
                        + Lesson
                      </button>
                      <button
                        onClick={() => void handleDeleteModule(module.id)}
                        className="rounded border border-red-500/30 px-2 py-0.5 text-[11px] text-red-700 dark:text-red-300"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {module.lessons.map((lesson) => (
                      <div key={lesson.id} className="rounded-lg border border-[var(--border)] p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <input
                            value={lesson.title}
                            onChange={(event) =>
                              setCourse((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  modules: (prev.modules ?? []).map((m) =>
                                    m.id === module.id
                                      ? {
                                          ...m,
                                          lessons: m.lessons.map((l) =>
                                            l.id === lesson.id ? { ...l, title: event.target.value } : l,
                                          ),
                                        }
                                      : m,
                                  ),
                                };
                              })
                            }
                            className="flex-1 rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm"
                          />
                          <button
                            onClick={() => void handleDeleteLesson(lesson.id, module.id)}
                            className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <textarea
                          value={lesson.content}
                          onChange={(event) =>
                            setCourse((prev) => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                modules: (prev.modules ?? []).map((m) =>
                                  m.id === module.id
                                    ? {
                                        ...m,
                                        lessons: m.lessons.map((l) =>
                                          l.id === lesson.id ? { ...l, content: event.target.value } : l,
                                        ),
                                      }
                                    : m,
                                ),
                              };
                            })
                          }
                          rows={4}
                          className="w-full rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 font-mono text-xs"
                        />
                        <button
                          onClick={() => {
                            const latest = (course.modules ?? [])
                              .flatMap((m) => m.lessons)
                              .find((l) => l.id === lesson.id);
                            if (latest) void handleLessonChange(latest);
                          }}
                          className="mt-2 rounded border border-[var(--border)] px-2 py-0.5 text-[11px]"
                        >
                          Save lesson
                        </button>
                      </div>
                    ))}
                    {module.lessons.length === 0 ? (
                      <p className="text-xs text-[var(--muted-foreground)]">No lessons yet.</p>
                    ) : null}
                  </div>
                </div>
              ))}
              {(course.modules ?? []).length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">Add a module to start building content.</p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
