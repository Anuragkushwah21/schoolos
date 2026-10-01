"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import { studentLeaveDecisionSchema, studentLeaveSchema, studentLeaveSettingsSchema } from "@/lib/validation/student-leave";
import { applyStudentLeave, cancelStudentLeave, decideStudentLeave, saveStudentLeaveSettings } from "@/server/attendance/student-leave";
import { requireTenantForAction } from "@/server/auth/current-user";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/** Every portal that shows student leave or its alerts, and the registers. */
const PAGES = ["/parent", "/student", "/teacher", "/school-admin"];

export async function applyStudentLeaveAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("PARENT", "STUDENT");
      await applyStudentLeave(ctx, parseFormData(studentLeaveSchema, formData));
      return successResult("Leave request submitted. The class teacher will review it.");
    },
    { revalidate: PAGES },
  );
}

export async function cancelStudentLeaveAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("PARENT", "STUDENT");
      await cancelStudentLeave(ctx, parseFormData(z.object({ leaveId: id }), formData).leaveId);
      return successResult("Leave request cancelled.");
    },
    { revalidate: PAGES },
  );
}

export async function decideStudentLeaveAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER", "SCHOOL_ADMIN");
      const input = parseFormData(studentLeaveDecisionSchema, formData);
      const { markedDays } = await decideStudentLeave(ctx, input);
      const done = input.decision === "APPROVE" ? "Leave approved." : "Leave rejected.";
      return successResult(
        markedDays
          ? `${done} Attendance was already marked for ${markedDays} day${markedDays === 1 ? "" : "s"} in this period — it has not been changed. Correct it from the register if needed.`
          : done,
      );
    },
    { revalidate: PAGES },
  );
}

export async function saveStudentLeaveSettingsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await saveStudentLeaveSettings(ctx, parseFormData(studentLeaveSettingsSchema, formData));
      return successResult("Leave settings saved.");
    },
    { revalidate: PAGES },
  );
}
