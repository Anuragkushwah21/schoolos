"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id, optionalText, requiredDate, requiredText } from "@/lib/validation/common";
import {
  assignRegisterCover,
  assignWorkCover,
  removeRegisterCover,
  removeWorkCover,
  saveAttendanceSettings,
} from "@/server/attendance/cover";
import { requireTenantForAction } from "@/server/auth/current-user";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;
const admin = () => requireTenantForAction("SCHOOL_ADMIN");
const PAGES = ["/school-admin", "/teacher", "/staff"];

const registerCoverSchema = z.object({ sectionId: id, date: requiredDate("the date"), teacherId: id, reason: optionalText(200) });

export async function assignRegisterCoverAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await assignRegisterCover(await admin(), parseFormData(registerCoverSchema, formData));
    return successResult("Assigned. It is on that teacher's dashboard now.");
  }, { revalidate: PAGES });
}

export async function removeRegisterCoverAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await removeRegisterCover(await admin(), parseFormData(z.object({ coverId: id }), formData).coverId);
    return successResult("Cover removed.");
  }, { revalidate: PAGES });
}

const workCoverSchema = z.object({
  date: requiredDate("the date"),
  absentStaffMemberId: id,
  coverStaffMemberId: id,
  duties: requiredText("what they should do", 300),
});

export async function assignWorkCoverAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await assignWorkCover(await admin(), parseFormData(workCoverSchema, formData));
    return successResult("Assigned. It is on their dashboard now.");
  }, { revalidate: PAGES });
}

export async function removeWorkCoverAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await removeWorkCover(await admin(), parseFormData(z.object({ coverId: id }), formData).coverId);
    return successResult("Cover removed.");
  }, { revalidate: PAGES });
}

const settingsSchema = z.object({
  timing: z.enum(["FIRST_PERIOD", "LAST_PERIOD"]),
  submission: z.enum(["AUTO", "MANUAL"]),
});

export async function saveAttendanceSettingsAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await saveAttendanceSettings(await admin(), parseFormData(settingsSchema, formData));
    return successResult("Attendance settings saved.");
  }, { revalidate: PAGES });
}
