"use server";

import type { Route } from "next";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { concernReviewSchema, concernSchema, supportFollowUpSchema, supportSchema } from "@/lib/validation/support";
import { requireTenantForAction } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { performAction } from "@/server/perform-action";
import { createSupport, followUpSupport, raiseConcern, reviewConcern } from "@/server/support/service";

type Result = ActionResult<undefined>;

/** Every portal that shows support or its alerts. */
const PAGES = ["/school-admin", "/teacher", "/parent", "/student"];

/** Add support for a student — a teacher for their own classes, or the office. */
export async function createSupportAction(
  _p: ActionResult<{ id: string; base: string } | undefined>,
  formData: FormData,
): Promise<ActionResult<{ id: string; base: string } | undefined>> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER", "SCHOOL_ADMIN");
      const id = await createSupport(ctx, parseFormData(supportSchema, formData));
      const base = ctx.user.role === "TEACHER" ? "/teacher/support" : "/school-admin/support";
      return successResult((await getT())("support.created"), { id, base });
    },
    { revalidate: PAGES, redirectTo: (data) => (data ? (`${data.base}/${data.id}` as Route) : null) },
  );
}

export async function followUpSupportAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER", "SCHOOL_ADMIN");
      await followUpSupport(ctx, parseFormData(supportFollowUpSchema, formData));
      return successResult((await getT())("support.followUpSaved"));
    },
    { revalidate: PAGES },
  );
}

/** A parent raises a concern about one of their current children. */
export async function raiseConcernAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("PARENT");
      await raiseConcern(ctx, parseFormData(concernSchema, formData));
      return successResult((await getT())("support.concernRaised"));
    },
    { revalidate: PAGES },
  );
}

/** The teacher (or the office) reviews a concern and replies to the parent. */
export async function reviewConcernAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER", "SCHOOL_ADMIN");
      await reviewConcern(ctx, parseFormData(concernReviewSchema, formData));
      return successResult((await getT())("support.concernUpdated"));
    },
    { revalidate: PAGES },
  );
}
