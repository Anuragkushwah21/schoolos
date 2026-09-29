"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import {
  activitySchema,
  addHomeworkResourceSchema,
  homeworkSchema,
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
      const { homeworkId, ...input } = parsed;

      if (homeworkId) {
        // Resources on existing homework are managed one at a time on its page.
        await updateHomework(ctx, homeworkId, input);
        return successResult("Homework updated.");
      }

      await createHomework(ctx, input, resources);
      return successResult(
        resources.length
          ? `Homework set with ${resources.length} resource${resources.length === 1 ? "" : "s"}.`
          : "Homework set.",
      );
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
