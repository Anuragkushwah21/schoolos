"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import { eventSchema, noticeSchema } from "@/lib/validation/communication";
import { requireTenantForAction } from "@/server/auth/current-user";
import { deleteEvent, saveEvent } from "@/server/communication/events";
import { deleteNotice, saveNotice } from "@/server/communication/notices";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/** Notices and events show on every dashboard and the public website. */
const EVERYWHERE = ["/admin", "/teacher", "/student", "/parent", "/schools/[slug]"];

export async function saveNoticeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await saveNotice(ctx, parseFormData(noticeSchema, formData));
      return successResult("Notice saved.");
    },
    { revalidate: EVERYWHERE, redirectTo: "/admin/notices" },
  );
}

export async function deleteNoticeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { noticeId } = parseFormData(z.object({ noticeId: id }), formData);
      await deleteNotice(ctx, noticeId);
      return successResult("Notice deleted.");
    },
    { revalidate: EVERYWHERE, redirectTo: "/admin/notices" },
  );
}

export async function saveEventAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await saveEvent(ctx, parseFormData(eventSchema, formData));
      return successResult("Event saved.");
    },
    { revalidate: EVERYWHERE, redirectTo: "/admin/events" },
  );
}

export async function deleteEventAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { eventId } = parseFormData(z.object({ eventId: id }), formData);
      await deleteEvent(ctx, eventId);
      return successResult("Event deleted.");
    },
    { revalidate: EVERYWHERE, redirectTo: "/admin/events" },
  );
}
