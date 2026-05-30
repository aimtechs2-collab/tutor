"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Loader2, Lock, RefreshCw } from "lucide-react";
import { notify } from "@/lib/notifications";
import { enrollInCourse, fetchCoursesCatalog, type CourseSummary } from "@/lib/courses-api";

export default function CoursesCatalogPage() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [planName, setPlanName] = useState("free");
  const [loading, setLoading] = useState(true);
  const [workingSlug, setWorkingSlug] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchCoursesCatalog();
      setCourses(data.courses);
      setPlanName(data.plan_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load courses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleEnroll(course: CourseSummary) {
    if (!course.accessible) {
      notify(`Upgrade to ${course.required_plan} or higher to enroll`, { tone: "error" });
      return;
    }
    setWorkingSlug(course.slug);
    try {
      await enrollInCourse(course.slug);
      notify(`Enrolled in ${course.title}`, { tone: "success" });
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Enrollment failed", { tone: "error" });
    } finally {
      setWorkingSlug(null);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-[var(--primary)]" />
            <div>
              <h1 className="text-xl font-semibold text-[var(--foreground)]">Courses</h1>
              <p className="text-sm text-[var(--muted-foreground)]">
                Your plan: <span className="capitalize">{planName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--muted-foreground)]">
            <Loader2 size={16} className="animate-spin" />
            Loading course catalog…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--destructive)]">
            {error}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {courses.map((course) => {
              const enrolled = Boolean(course.enrollment_status);
              const locked = !course.accessible;
              return (
                <article
                  key={course.id}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold text-[var(--foreground)]">{course.title}</h2>
                      <p className="mt-1 text-xs capitalize text-[var(--muted-foreground)]">
                        {course.required_plan} plan · {course.lesson_count ?? 0} lessons
                      </p>
                    </div>
                    {locked ? <Lock size={16} className="text-[var(--muted-foreground)]" /> : null}
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                    {course.description || "No description provided."}
                  </p>
                  <div className="mt-4 flex gap-2">
                    {enrolled ? (
                      <span className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs text-green-700 dark:text-green-300">
                        Enrolled
                      </span>
                    ) : (
                      <button
                        onClick={() => void handleEnroll(course)}
                        disabled={workingSlug === course.slug || locked}
                        className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
                      >
                        {locked ? "Upgrade required" : workingSlug === course.slug ? "Enrolling…" : "Enroll"}
                      </button>
                    )}
                    <Link
                      href="/dashboard"
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--background)]"
                    >
                      Dashboard
                    </Link>
                  </div>
                </article>
              );
            })}
            {courses.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--muted-foreground)]">
                No published courses available for your plan yet.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
