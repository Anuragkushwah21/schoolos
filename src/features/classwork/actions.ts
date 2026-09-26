"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import {
  activitySchema,
  homeworkSchema,
  lessonMaterialSchema,
  lessonPlanSchema,
  remarkEditSchema,
  remarkSchema,
} from "@/lib/validation/classwork";
import { id } from "@/lib/validation/common";
import { requireTenantForAction } from "@/server/auth/current-user";
import { recordActivity } from "@/server/classwork/activities";
import { addLessonMaterial, deleteLessonMaterial, planLesson } from "@/server/classwork/lessons";
import { createHomework, deleteHomework, updateHomework } from "@/server/classwork/homework";
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
      await recordActivity(ctx, parseFormData(activitySchema, formData));
      return successResult("Class recorded.");
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
      const { homeworkId, ...input } = parseFormData(homeworkSchema, formData);

      if (homeworkId) {
        await updateHomework(ctx, homeworkId, input);
        return successResult("Homework updated.");
      }

      await createHomework(ctx, input);
      return successResult("Homework set.");
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
