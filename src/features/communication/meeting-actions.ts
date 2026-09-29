"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import { cancelMeetingSchema, meetingSchema } from "@/lib/validation/meetings";
import { requireTenantForAction } from "@/server/auth/current-user";
import { cancelMeeting, deleteMeeting, saveMeeting } from "@/server/communication/meetings";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/** Every portal that lists meetings or shows them in its alert feed. */
const PAGES = ["/school-admin", "/teacher", "/student", "/parent", "/staff"];

export async function saveMeetingAction(
  _p: ActionResult<{ id: string } | undefined>,
  formData: FormData,
): Promise<ActionResult<{ id: string } | undefined>> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const input = parseFormData(meetingSchema, formData);
      const meetingId = await saveMeeting(ctx, input);
      return successResult(input.meetingId ? "Meeting updated." : "Meeting created successfully. Everyone invited can see it now.", { id: meetingId });
    },
    { revalidate: PAGES, redirectTo: (data) => (data ? (`/school-admin/meetings/${data.id}` as Route) : null) },
  );
}

export async function cancelMeetingAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await cancelMeeting(ctx, parseFormData(cancelMeetingSchema, formData));
      return successResult("Meeting cancelled. Invitees will see it marked as cancelled.");
    },
    { revalidate: PAGES },
  );
}

export async function deleteMeetingAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { meetingId } = parseFormData(z.object({ meetingId: id }), formData);
      await deleteMeeting(ctx, meetingId);
      return successResult("Meeting deleted.");
    },
    { revalidate: PAGES, redirectTo: "/school-admin/meetings" },
  );
}
