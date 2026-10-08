"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import { cancelMeetingSchema, meetingSchema } from "@/lib/validation/meetings";
import { requireTenantForAction } from "@/server/auth/current-user";
import { cancelMeeting, deleteMeeting, saveMeeting } from "@/server/communication/meetings";
import { performAction } from "@/server/perform-action";
import { isSchoolLeader } from "@/lib/permissions";

type Result = ActionResult<undefined>;

/** Every portal that lists meetings or shows them in its alert feed. */
const PAGES = ["/school-admin", "/teacher", "/student", "/parent", "/staff"];

export async function saveMeetingAction(
  _p: ActionResult<{ id: string; href: Route } | undefined>,
  formData: FormData,
): Promise<ActionResult<{ id: string; href: Route } | undefined>> {
  return performAction(
    async () => {
      // Staff with "Schedule meetings" too; the service checks it (and that they scheduled it).
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL", "NON_TEACHING_STAFF");
      const input = parseFormData(meetingSchema, formData);
      const meetingId = await saveMeeting(ctx, input);
      const base = isSchoolLeader(ctx.user.role) ? "/school-admin/meetings" : "/staff/meetings/manage";
      return successResult(input.meetingId ? "Meeting updated." : "Meeting created successfully. Everyone invited can see it now.", { id: meetingId, href: `${base}/${meetingId}` as Route });
    },
    { revalidate: PAGES, redirectTo: (data) => (data ? data.href : null) },
  );
}

export async function cancelMeetingAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL", "NON_TEACHING_STAFF");
      await cancelMeeting(ctx, parseFormData(cancelMeetingSchema, formData));
      return successResult("Meeting cancelled. Invitees will see it marked as cancelled.");
    },
    { revalidate: PAGES },
  );
}

export async function deleteMeetingAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "PRINCIPAL");
      const { meetingId } = parseFormData(z.object({ meetingId: id }), formData);
      await deleteMeeting(ctx, meetingId);
      return successResult("Meeting deleted.");
    },
    { revalidate: PAGES, redirectTo: "/school-admin/meetings" },
  );
}
