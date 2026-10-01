"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { checkbox, id } from "@/lib/validation/common";
import { eventSchema, noticeSchema } from "@/lib/validation/communication";
import { requireTenantForAction } from "@/server/auth/current-user";
import { deleteEvent, saveEvent, setEventPublished } from "@/server/communication/events";
import { deleteNotice, markNoticesRead, saveNotice } from "@/server/communication/notices";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;

/** Notices and events show on every dashboard and the public website. */
const EVERYWHERE = ["/school-admin", "/teacher", "/student", "/parent", "/staff", "/schools/[slug]"];

export async function saveNoticeAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await saveNotice(ctx, parseFormData(noticeSchema, formData));
      return successResult("Notice saved.");
    },
    { revalidate: EVERYWHERE, redirectTo: "/school-admin/notices" },
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
    { revalidate: EVERYWHERE, redirectTo: "/school-admin/notices" },
  );
}

export async function saveEventAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await saveEvent(ctx, parseFormData(eventSchema, formData));
      return successResult("Event saved.");
    },
    { revalidate: EVERYWHERE, redirectTo: "/school-admin/events" },
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
    { revalidate: EVERYWHERE, redirectTo: "/school-admin/events" },
  );
}

export async function setEventPublishedAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { eventId, publish } = parseFormData(z.object({ eventId: id, publish: checkbox }), formData);
      await setEventPublished(ctx, eventId, publish);
      return successResult(publish ? "Event published — everyone can see it." : "Event unpublished — only you can see it now.");
    },
    { revalidate: EVERYWHERE },
  );
}

/** Mark one notice — or, with noticeId "ALL", every notice — read for the signed-in person. */
export async function markNoticeReadAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT", "NON_TEACHING_STAFF");
      const { noticeId } = parseFormData(z.object({ noticeId: id }), formData);
      const count = await markNoticesRead(ctx, noticeId === "ALL" ? "ALL" : [noticeId]);
      return successResult(noticeId === "ALL" ? (count ? "All notices marked as read." : "Everything was already read.") : "Marked as read.");
    },
    { revalidate: ["/school-admin", "/teacher", "/student", "/parent", "/staff"] },
  );
}
