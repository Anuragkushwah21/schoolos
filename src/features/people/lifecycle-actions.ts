"use server";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { loginAccessSchema, statusChangeSchema } from "@/lib/validation/lifecycle";
import type { StudentStatus, TeacherStatus } from "@/generated/prisma/enums";
import { requireTenantForAction } from "@/server/auth/current-user";
import { changeEmployeeStatus, changeStudentStatus, setLoginAccess } from "@/server/people/lifecycle";
import { performAction } from "@/server/perform-action";
import { getT } from "@/server/i18n";

type Result = ActionResult<undefined>;

/** Every list and portal a status or login change can affect. */
const PAGES = ["/school-admin", "/teacher", "/student", "/parent", "/staff"];

/**
 * Change a student's, teacher's or staff member's status. School Admin only;
 * the person is looked up inside the session's school, so an id from another
 * school is simply not found.
 */
export async function changeStatusAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const t = await getT();
      const input = parseFormData(statusChangeSchema, formData);
      const options = { effectiveDate: input.effectiveDate, reason: input.reason, remarks: input.remarks, confirmReturn: input.confirmReturn };
      const result =
        input.person === "STUDENT"
          ? await changeStudentStatus(ctx, input.personId, input.status as StudentStatus, options)
          : await changeEmployeeStatus(ctx, input.person, input.personId, input.status as TeacherStatus, options);

      const notes = [t("lifecycle.statusChanged")];
      if (result.handover?.periods || result.handover?.subjects) notes.push(t("lifecycle.handover", { periods: result.handover.periods, subjects: result.handover.subjects }));
      if (result.handover?.routesCleared) notes.push(t("lifecycle.routesCleared", { count: result.handover.routesCleared }));
      return successResult(notes.join(" "));
    },
    { revalidate: PAGES },
  );
}

/** Enable or disable someone's login without touching their status. */
export async function loginAccessAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await setLoginAccess(ctx, parseFormData(loginAccessSchema, formData));
      return successResult((await getT())("lifecycle.loginChanged"));
    },
    { revalidate: PAGES },
  );
}
