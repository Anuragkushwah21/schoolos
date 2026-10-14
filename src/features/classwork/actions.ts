"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import {
  activitySchema,
  addHomeworkResourceSchema,
  homeworkMarksSchema,
  homeworkSchema,
  SUBMISSION_MARK_VALUES,
  lessonMaterialSchema,
  lessonPlanSchema,
  parseHomeworkResources,
  remarkEditSchema,
  remarkSchema,
  updateHomeworkResourceSchema,
} from "@/lib/validation/classwork";
import { id } from "@/lib/validation/common";
import { requireTenantForAction } from "@/server/auth/current-user";
import { recordActivity } from "@/server/classwork/activities";
import { addLessonMaterial, deleteLessonMaterial, planLesson } from "@/server/classwork/lessons";
import {
  addHomeworkResource,
  createHomework,
  deleteHomework,
  markHomeworkSubmissions,
  removeHomeworkResource,
  updateHomework,
  updateHomeworkResource,
} from "@/server/classwork/homework";
import { addRemark, deleteRemark, updateRemark } from "@/server/classwork/remarks";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/**
 * Everything a teacher records about their teaching.
 *
 * Each action re-checks its own caller: the page that rendered the form
 * protects nothing, because a Server Action is a separate POST endpoint that
 * anyone can call directly. The service behind it checks the assignment
 * again, so a forged `sectionId` or `timetableSlotId` fails there too.
 */

/** A lesson record changes what the teacher and the admin see of the day. */
// The whole area, not just its dashboard: `revalidatePath(path, "layout")`
// refreshes a subtree, and a lesson record shows up on several pages in each.
const CLASSWORK_PAGES = ["/teacher", "/school-admin", "/parent", "/student"];

export async function recordActivityAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      // Syllabus topics arrive as `topic.<id>` = COVERED | PARTIAL; blank means not taught today.
      // Without the topics block on the form, the recorded topics are left as they were.
      const topics = formData.get("topicsSent")
        ? [...formData.entries()]
            .filter(([key, value]) => key.startsWith("topic.") && (value === "COVERED" || value === "PARTIAL"))
            .map(([key, value]) => ({ topicId: key.slice(6), coverage: value as "COVERED" | "PARTIAL" }))
        : undefined;
      await recordActivity(ctx, { ...parseFormData(activitySchema, formData), topics });
      return successResult(topics?.length ? `Class recorded with ${topics.length} topic(s).` : "Class recorded.");
    },
    { revalidate: CLASSWORK_PAGES },
  );
}

/**
 * Plan a lesson the class has not sat yet.
 *
 * Writes the plan onto the same `ClassSession` row the teacher will later write
 * the class up on, so a plan and its record never become two rows that
 * disagree.
 */
export async function planLessonAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      await planLesson(ctx, parseFormData(lessonPlanSchema, formData));
      return successResult("Lesson planned. Your class can see it now.");
    },
    { revalidate: [...CLASSWORK_PAGES, "/student"] },
  );
}

export async function addLessonMaterialAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      await addLessonMaterial(ctx, parseFormData(lessonMaterialSchema, formData));
      return successResult("Material added.");
    },
    { revalidate: [...CLASSWORK_PAGES, "/student"] },
  );
}

export async function deleteLessonMaterialAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const { materialId } = parseFormData(z.object({ materialId: id }), formData);
      await deleteLessonMaterial(ctx, materialId);
      return successResult("Material removed.");
    },
    { revalidate: [...CLASSWORK_PAGES, "/student"] },
  );
}

export async function saveHomeworkAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      // Resource rows are checked alongside the homework, so the teacher sees
      // every problem at once rather than one per submit.
      const { resources, fieldErrors } = parseHomeworkResources(formData);
      let parsed;
      try {
        parsed = parseFormData(homeworkSchema, formData);
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new ValidationError(error.message, { ...error.fieldErrors, ...fieldErrors });
        }
        throw error;
      }
      if (Object.keys(fieldErrors).length) {
        throw new ValidationError("Please correct the highlighted resources.", fieldErrors);
      }
      const { homeworkId, syllabusItemId, ...rest } = parsed;
      // Only a form that shows the syllabus choice may change it; otherwise an edit leaves the link as it is.
      const input = formData.has("syllabusItemId") ? { ...rest, syllabusItemId } : rest;

      if (homeworkId) {
        // Resources on existing homework are managed one at a time on its page.
        await updateHomework(ctx, homeworkId, input);
        return successResult("Homework updated.");
      }

      const { ids } = await createHomework(ctx, input, resources);
      const parts = [
        ids.length > 1 ? `Classes: ${ids.length}.` : "",
        input.audience === "SELECTED_STUDENTS" ? `Selected students: ${input.studentIds.length}.` : "",
        resources.length ? `Resources: ${resources.length}.` : "",
      ].filter(Boolean);
      return successResult(parts.length ? `Homework set. ${parts.join(" ")}` : "Homework set.");
    },
    { revalidate: CLASSWORK_PAGES, redirectTo: "/teacher/homework" },
  );
}

export async function deleteHomeworkAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const { homeworkId } = parseFormData(z.object({ homeworkId: id }), formData);
      await deleteHomework(ctx, homeworkId);
      return successResult("Homework deleted.");
    },
    // The row is gone, so the page it was deleted from may no longer exist.
    { revalidate: CLASSWORK_PAGES, redirectTo: "/teacher/homework" },
  );
}

export async function addRemarkAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      await addRemark(ctx, parseFormData(remarkSchema, formData));
      return successResult("Remark saved.");
    },
    { revalidate: CLASSWORK_PAGES },
  );
}

export async function updateRemarkAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const { remarkId, ...bands } = parseFormData(remarkEditSchema, formData);
      await updateRemark(ctx, remarkId, bands);
      return successResult("Remark updated.");
    },
    { revalidate: CLASSWORK_PAGES },
  );
}

export async function deleteRemarkAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const { remarkId } = parseFormData(z.object({ remarkId: id }), formData);
      await deleteRemark(ctx, remarkId);
      return successResult("Remark deleted.");
    },
    { revalidate: CLASSWORK_PAGES },
  );
}

export async function addHomeworkResourceAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const { homeworkId, ...input } = parseFormData(addHomeworkResourceSchema, formData);
      await addHomeworkResource(ctx, homeworkId, input);
      return successResult("Resource added.");
    },
    { revalidate: CLASSWORK_PAGES },
  );
}

export async function updateHomeworkResourceAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const { resourceId, ...input } = parseFormData(updateHomeworkResourceSchema, formData);
      await updateHomeworkResource(ctx, resourceId, input);
      return successResult("Resource updated.");
    },
    { revalidate: CLASSWORK_PAGES },
  );
}

export async function removeHomeworkResourceAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const { resourceId } = parseFormData(z.object({ resourceId: id }), formData);
      await removeHomeworkResource(ctx, resourceId);
      return successResult("Resource removed.");
    },
    { revalidate: CLASSWORK_PAGES },
  );
}

/**
 * Record who handed homework in, after checking it. One field per student,
 * `mark.<studentId>` = ASSIGNED | SUBMITTED | LATE | MISSING; the service
 * checks the teacher set it and each student is one it is for.
 */
export async function markHomeworkAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const { homeworkId } = parseFormData(homeworkMarksSchema, formData);
      const marks: Array<{ studentId: string; status: (typeof SUBMISSION_MARK_VALUES)[number]; note: string | null }> = [];
      for (const [key, value] of formData.entries()) {
        if (!key.startsWith("mark.")) continue;
        const status = String(value);
        if (!(SUBMISSION_MARK_VALUES as readonly string[]).includes(status)) throw new ValidationError("Please correct the highlighted fields.", { [key]: ["Choose a status"] });
        const studentId = key.slice(5);
        // Feedback the student and their parents see; blank for none.
        const note = String(formData.get("note." + studentId) ?? "").trim().slice(0, 300) || null;
        marks.push({ studentId, status: status as (typeof SUBMISSION_MARK_VALUES)[number], note });
      }
      const { changed } = await markHomeworkSubmissions(ctx, homeworkId, marks);
      return successResult(changed ? `Saved. Students updated: ${changed}.` : "Nothing changed.");
    },
    { revalidate: [...CLASSWORK_PAGES, "/student", "/parent"] },
  );
}
