"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id, requiredDate } from "@/lib/validation/common";
import { leaveDecisionSchema, leaveRequestSchema } from "@/lib/validation/leave";
import { requireTenantForAction } from "@/server/auth/current-user";
import { assignSubstitute, clearSubstitute } from "@/server/classwork/substitutes";
import { performAction } from "@/server/perform-action";
import { applyForLeave, cancelLeave, decideLeave } from "@/server/staff/leave";

type Result = ActionResult<undefined>;

/** Leave and cover change the teacher's day, the staff register and dashboards. */
const STAFF_PAGES = ["/school-admin", "/teacher", "/staff"];

export async function applyLeaveAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER", "NON_TEACHING_STAFF");
      await applyForLeave(ctx, parseFormData(leaveRequestSchema, formData));
      return successResult("Leave requested. The school office will review it.");
    },
    { revalidate: STAFF_PAGES },
  );
}

export async function cancelLeaveAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("TEACHER", "NON_TEACHING_STAFF");
      const { leaveId } = parseFormData(z.object({ leaveId: id }), formData);
      await cancelLeave(ctx, leaveId);
      return successResult("Leave cancelled.");
    },
    { revalidate: STAFF_PAGES },
  );
}

export async function decideLeaveAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const input = parseFormData(leaveDecisionSchema, formData);
      const { decided } = await decideLeave(ctx, input);
      const verb = input.decision === "APPROVED" ? "approved" : "rejected";
      return successResult(`${decided} request${decided === 1 ? "" : "s"} ${verb}.`);
    },
    { revalidate: STAFF_PAGES },
  );
}

const coverSchema = z.object({ timetableSlotId: id, date: requiredDate("the date"), teacherId: id });

export async function assignSubstituteAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await assignSubstitute(ctx, parseFormData(coverSchema, formData));
      return successResult("Cover arranged.");
    },
    { revalidate: [...STAFF_PAGES, "/student", "/parent"] },
  );
}

export async function clearSubstituteAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { classSessionId } = parseFormData(z.object({ classSessionId: id }), formData);
      await clearSubstitute(ctx, classSessionId);
      return successResult("Cover removed.");
    },
    { revalidate: [...STAFF_PAGES, "/student", "/parent"] },
  );
}
