"use server";

import type { Route } from "next";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import {
  concernAssignSchema,
  concernReplySchema,
  concernUpdateRequestSchema,
  parentConcernSchema,
  teacherConcernSchema,
} from "@/lib/validation/support";
import { requireTenantForAction } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { performAction } from "@/server/perform-action";
import { assignConcern, raiseParentConcern, raiseTeacherConcern, replyToConcern, requestConcernUpdate } from "@/server/support/concerns";

type Result = ActionResult<undefined>;
type Raised = ActionResult<{ href: Route } | undefined>;

/** Every portal that shows concerns or their alerts. */
const PAGES = ["/school-admin", "/teacher", "/parent"];

/** A parent raises a concern; the school decides which teacher receives it. */
export async function raiseParentConcernAction(_p: Raised, formData: FormData): Promise<Raised> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("PARENT");
      const concern = await raiseParentConcern(ctx, parseFormData(parentConcernSchema, formData));
      const t = await getT();
      return successResult(
        concern.teacher ? t("concerns.raisedTo", { ref: concern.ref, teacher: concern.teacher }) : t("concerns.raisedToOffice", { ref: concern.ref }),
        { href: `/parent/concerns/${concern.id}` as Route },
      );
    },
    { revalidate: PAGES, redirectTo: (data) => data?.href ?? null },
  );
}

/** A teacher raises a concern for a student's parents, in a subject they teach them. */
export async function raiseTeacherConcernAction(_p: Raised, formData: FormData): Promise<Raised> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER");
      const concern = await raiseTeacherConcern(ctx, parseFormData(teacherConcernSchema, formData));
      return successResult((await getT())("concerns.raisedForParent", { ref: concern.ref }), { href: `/teacher/concerns/${concern.id}` as Route });
    },
    { revalidate: PAGES, redirectTo: (data) => data?.href ?? null },
  );
}

/** A reply in the conversation; staff may also change status or priority. */
export async function replyConcernAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("PARENT", "TEACHER", "SCHOOL_ADMIN");
      await replyToConcern(ctx, parseFormData(concernReplySchema, formData));
      return successResult((await getT())("concerns.replied"));
    },
    { revalidate: PAGES },
  );
}

/** The School Admin asks the teacher for an update. */
export async function requestConcernUpdateAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await requestConcernUpdate(ctx, parseFormData(concernUpdateRequestSchema, formData));
      return successResult((await getT())("concerns.updateRequested"));
    },
    { revalidate: PAGES },
  );
}

/** The School Admin hands a concern to a teacher. */
export async function assignConcernAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await assignConcern(ctx, parseFormData(concernAssignSchema, formData));
      return successResult((await getT())("concerns.assigned"));
    },
    { revalidate: PAGES },
  );
}
