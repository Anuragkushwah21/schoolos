"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id, optionalDate, optionalId, optionalText, requiredInt, requiredText } from "@/lib/validation/common";
import { requireTenantForAction } from "@/server/auth/current-user";
import { createReview, markUnitReady, respondToReview, saveAcademicThreshold, updateReview } from "@/server/academics/progress";
import { deleteSyllabusItem, saveSyllabusItem } from "@/server/academics/syllabus";
import { performAction } from "@/server/perform-action";

/**
 * Academic progress actions. Each service checks the caller again (role,
 * scope, school); these only parse the form and re-render the pages.
 */

type Result = ActionResult<undefined>;
const PAGES = ["/school-admin/progress", "/teacher/progress", "/teacher/dashboard", "/school-admin/dashboard", "/principal/dashboard"];

const syllabusItemSchema = z.object({
  id: optionalId,
  classId: id,
  subjectId: id,
  level: z.enum(["UNIT", "CHAPTER", "TOPIC"]),
  parentId: optionalId,
  title: requiredText("a title", 200),
  plannedFrom: optionalDate,
  plannedTo: optionalDate,
});

export async function saveSyllabusItemAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL");
      const input = parseFormData(syllabusItemSchema, formData);
      await saveSyllabusItem(ctx, input);
      return successResult(input.id ? "Saved." : "Added.");
    },
    { revalidate: PAGES },
  );
}

export async function deleteSyllabusItemAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL");
      await deleteSyllabusItem(ctx, parseFormData(z.object({ id }), formData).id);
      return successResult("Removed.");
    },
    { revalidate: PAGES },
  );
}

export async function saveThresholdAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await saveAcademicThreshold(ctx, parseFormData(z.object({ percent: requiredInt(1, 100) }), formData).percent);
      return successResult("Review threshold saved.");
    },
    { revalidate: PAGES },
  );
}

const ACTIONS = ["NOTE", "UPDATE_REQUESTED", "REVISION_RECOMMENDED", "RESOLVED"] as const;

export async function createReviewAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL");
      const input = parseFormData(z.object({ sectionId: id, subjectId: id, assessmentId: optionalId, syllabusItemId: optionalId, note: optionalText(1000), action: z.enum(ACTIONS) }), formData);
      await createReview(ctx, input);
      return successResult("Review saved. The teacher sees it on their Progress page.");
    },
    { revalidate: PAGES },
  );
}

export async function updateReviewAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL");
      const input = parseFormData(z.object({ reviewId: id, note: optionalText(1000), action: z.enum(ACTIONS) }), formData);
      await updateReview(ctx, input.reviewId, input);
      return successResult(input.action === "RESOLVED" ? "Review closed." : "Review updated.");
    },
    { revalidate: PAGES },
  );
}

export async function markUnitReadyAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const input = parseFormData(z.object({ sectionId: id, subjectId: id, unitId: id, note: optionalText(1000) }), formData);
      await markUnitReady(ctx, input);
      return successResult("Unit sent for review.");
    },
    { revalidate: PAGES },
  );
}

export async function respondToReviewAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const input = parseFormData(z.object({ reviewId: id, response: optionalText(1000), revisionPlannedOn: optionalDate, revisionSessionId: optionalId, followUpAssessmentId: optionalId }), formData);
      await respondToReview(ctx, input.reviewId, {
        response: input.response,
        // Blank fields leave what was recorded before.
        ...(input.revisionPlannedOn ? { revisionPlannedOn: input.revisionPlannedOn } : {}),
        ...(input.revisionSessionId ? { revisionSessionId: input.revisionSessionId } : {}),
        ...(input.followUpAssessmentId ? { followUpAssessmentId: input.followUpAssessmentId } : {}),
      });
      return successResult("Reply saved.");
    },
    { revalidate: PAGES },
  );
}
