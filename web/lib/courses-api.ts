import { apiFetch, apiUrl } from "@/lib/api";

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  is_published: boolean;
  required_plan: string;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  enrollment_count?: number;
  completed_count?: number;
  completion_rate?: number;
  lesson_count?: number;
  accessible?: boolean;
  enrollment_status?: string | null;
  enrolled_at?: string | null;
}

export interface LessonRecord {
  id: string;
  module_id: string;
  title: string;
  slug: string;
  content: string;
  content_type: string;
  sort_order: number;
  duration_min: number;
  created_at: string;
  updated_at: string;
  progress?: { completed: boolean; completed_at: string | null };
}

export interface ModuleRecord {
  id: string;
  course_id: string;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  lessons: LessonRecord[];
}

export interface CourseDetail extends CourseSummary {
  modules?: ModuleRecord[];
  enrollment?: {
    status: string;
    enrolled_at: string;
    completed_at: string | null;
  } | null;
}

export interface CourseAnalytics {
  enrollment_count: number;
  completed_count: number;
  completion_rate: number;
  lesson_count: number;
  learners_with_progress: number;
  completed_lessons: number;
  avg_lessons_completed: number;
  avg_completion_rate: number;
  enrollments_by_day: Array<{ day: string; count: number }>;
}

async function parseError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0 && detail[0]?.msg) {
    return String(detail[0].msg);
  }
  return fallback;
}

export async function fetchCoursesCatalog(): Promise<{ courses: CourseSummary[]; plan_name: string }> {
  const res = await apiFetch(apiUrl("/api/v1/courses"));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load courses"));
  return res.json();
}

export async function enrollInCourse(slug: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/v1/courses/${encodeURIComponent(slug)}/enroll`), {
    method: "POST",
  });
  if (!res.ok) throw new Error(await parseError(res, "Enrollment failed"));
}

export async function fetchAdminCourses(): Promise<CourseSummary[]> {
  const res = await apiFetch(apiUrl("/api/v1/admin/courses"));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load admin courses"));
  const data = await res.json();
  return data.courses ?? [];
}

export async function createAdminCourse(payload: {
  title: string;
  description?: string;
  slug?: string;
  is_published?: boolean;
  required_plan?: string;
  sort_order?: number;
}): Promise<CourseSummary> {
  const res = await apiFetch(apiUrl("/api/v1/admin/courses"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create course"));
  const data = await res.json();
  return data.course;
}

export async function fetchAdminCourse(courseId: string): Promise<CourseDetail> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/courses/${encodeURIComponent(courseId)}`));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load course"));
  const data = await res.json();
  return data.course;
}

export async function updateAdminCourse(
  courseId: string,
  payload: Partial<{
    title: string;
    description: string;
    slug: string;
    is_published: boolean;
    required_plan: string;
    sort_order: number;
  }>,
): Promise<CourseSummary> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/courses/${encodeURIComponent(courseId)}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update course"));
  const data = await res.json();
  return data.course;
}

export async function fetchCourseAnalytics(courseId: string): Promise<{
  course: CourseSummary;
  analytics: CourseAnalytics;
}> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/courses/${encodeURIComponent(courseId)}/analytics`));
  if (!res.ok) throw new Error(await parseError(res, "Failed to load analytics"));
  return res.json();
}

export async function createModule(
  courseId: string,
  payload: { title: string; sort_order?: number },
): Promise<ModuleRecord> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/courses/${encodeURIComponent(courseId)}/modules`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create module"));
  const data = await res.json();
  return data.module;
}

export async function createLesson(
  moduleId: string,
  payload: {
    title: string;
    slug?: string;
    content?: string;
    content_type?: string;
    sort_order?: number;
    duration_min?: number;
  },
): Promise<LessonRecord> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/modules/${encodeURIComponent(moduleId)}/lessons`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create lesson"));
  const data = await res.json();
  return data.lesson;
}

export async function updateLesson(
  lessonId: string,
  payload: {
    title: string;
    slug?: string;
    content?: string;
    content_type?: string;
    sort_order?: number;
    duration_min?: number;
  },
): Promise<LessonRecord> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/lessons/${encodeURIComponent(lessonId)}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update lesson"));
  const data = await res.json();
  return data.lesson;
}

export async function deleteModule(moduleId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/modules/${encodeURIComponent(moduleId)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete module"));
}

export async function deleteLesson(lessonId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/v1/admin/lessons/${encodeURIComponent(lessonId)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete lesson"));
}

export const PLAN_OPTIONS = ["free", "basic", "pro", "premium"] as const;
