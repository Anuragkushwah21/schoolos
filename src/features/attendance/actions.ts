"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, runAction, successResult } from "@/lib/action-result";
import { parseDateInput } from "@/lib/dates";
import { ValidationError } from "@/lib/errors";
import { id, requiredDate } from "@/lib/validation/common";
import { requireTenantForAction } from "@/server/auth/current-user";
import {
  ATTENDANCE_STATUSES,
  type AttendanceEntry,
  STAFF_ATTENDANCE_STATUSES,
  markAttendance,
  markStaffAttendance,
  saveRegisterDraft,
} from "@/server/attendance/service";
import { deadlineLabel } from "@/server/attendance/register";
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
      const reason = formData.get("reason");
      const outcome = await markAttendance(ctx, { sectionId, date, entries, reason: typeof reason === "string" ? reason : null });
      const until = outcome.deadline && outcome.deadline > new Date() && ctx.user.role === "TEACHER" ? ` You can correct it until ${deadlineLabel(outcome.deadline)}.` : "";
      if (outcome.kind === "CORRECTED") {
        return successResult(outcome.saved ? `Correction saved for ${outcome.saved} ${outcome.saved === 1 ? "student" : "students"}.${until}` : "Nothing changed.");
      }
      return successResult(`Attendance submitted for ${outcome.saved} ${outcome.saved === 1 ? "student" : "students"}.${until}`);
    },
    { revalidate: ["/school-admin", "/teacher", "/student", "/parent"] },
  );
}

const draftSchema = z.object({
  sectionId: id,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z
    .array(z.object({ studentId: id, status: z.enum(ATTENDANCE_STATUSES as [AttendanceEntry["status"], ...AttendanceEntry["status"][]]), remarks: z.string().trim().max(200).nullable() }))
    .max(500),
});

/**
 * Auto-save while the register is being taken. Called as the teacher taps;
 * it only ever writes a draft — submission is a separate, server-side step.
 */
export async function saveRegisterDraftAction(input: unknown): Promise<ActionResult<{ savedAt: string; finalizeAt: string | null }>> {
  return runAction(async () => {
    const ctx = await requireTenantForAction("SCHOOL_ADMIN", "TEACHER");
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("That draft could not be saved.");
    const date = parseDateInput(parsed.data.date);
    if (!date) throw new ValidationError("That draft could not be saved.");
    const entries = parsed.data.entries.map((entry) => ({ ...entry, remarks: entry.remarks || null }));
    if (!entries.length) return successResult(undefined, { savedAt: new Date().toISOString(), finalizeAt: null });
    const saved = await saveRegisterDraft(ctx, { sectionId: parsed.data.sectionId, date, entries });
    return successResult(undefined, { savedAt: saved.savedAt.toISOString(), finalizeAt: saved.finalizeAt?.toISOString() ?? null });
  });
}

export async function markStaffAttendanceAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { date } = parseFormData(staffSchema, formData);
      // Rows arrive keyed "t:<teacher id>" or "s:<staff id>"; the service
      // checks every id inside this school.
      const entries = readEntries(formData, STAFF_ATTENDANCE_STATUSES).map((entry) => ({
        teacherId: entry.id.startsWith("t:") ? entry.id.slice(2) : null,
        staffMemberId: entry.id.startsWith("s:") ? entry.id.slice(2) : null,
        status: entry.status,
        remarks: entry.remarks,
      }));
      const { saved } = await markStaffAttendance(ctx, { date, entries });
      return successResult(`Staff attendance saved for ${saved}.`);
    },
    { revalidate: "/school-admin" },
  );
}
