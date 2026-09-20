"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { id, requiredDate } from "@/lib/validation/common";
import { requireTenantForAction } from "@/server/auth/current-user";
import {
  ATTENDANCE_STATUSES,
  type AttendanceEntry,
  STAFF_ATTENDANCE_STATUSES,
  markAttendance,
  markStaffAttendance,
} from "@/server/attendance/service";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

const registerSchema = z.object({ sectionId: id, date: requiredDate("a date") });
const staffSchema = z.object({ date: requiredDate("a date") });

/**
 * Register rows arrive as `status:<id>` / `remarks:<id>` pairs. Unknown status
 * values are rejected; which ids are acceptable is the service's decision.
 */
function readEntries<S extends string>(formData: FormData, allowed: readonly S[]) {
  const entries: Array<{ id: string; status: S; remarks: string | null }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("status:") || typeof value !== "string" || !value) continue;
    const personId = key.slice("status:".length);
    if (!allowed.includes(value as S)) throw new ValidationError("An attendance value was not recognised.");
    const remarks = formData.get(`remarks:${personId}`);
    entries.push({
      id: personId,
      status: value as S,
      remarks: typeof remarks === "string" && remarks.trim() ? remarks.trim().slice(0, 200) : null,
    });
  }
  return entries;
}

export async function markAttendanceAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "TEACHER");
      const { sectionId, date } = parseFormData(registerSchema, formData);
      const entries: AttendanceEntry[] = readEntries(formData, ATTENDANCE_STATUSES).map((entry) => ({
        studentId: entry.id,
        status: entry.status,
        remarks: entry.remarks,
      }));
      const { saved } = await markAttendance(ctx, { sectionId, date, entries });
      return successResult(`Attendance saved for ${saved} ${saved === 1 ? "student" : "students"}.`);
    },
    { revalidate: ["/admin", "/teacher", "/student", "/parent"] },
  );
}

export async function markStaffAttendanceAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { date } = parseFormData(staffSchema, formData);
      const entries = readEntries(formData, STAFF_ATTENDANCE_STATUSES).map((entry) => ({
        teacherId: entry.id,
        status: entry.status,
        remarks: entry.remarks,
      }));
      const { saved } = await markStaffAttendance(ctx, { date, entries });
      return successResult(`Staff attendance saved for ${saved}.`);
    },
    { revalidate: "/admin" },
  );
}
