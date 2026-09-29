import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { MEETING_TIME_STATUSES, MEETING_TYPES, meetingSchema } from "@/lib/validation/meetings";
import { getMeetingForAdmin, listMeetingsForAdmin, saveMeeting } from "@/server/communication/meetings";

const query = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(MEETING_TIME_STATUSES).optional(),
  type: z.enum(MEETING_TYPES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

/** The school's meetings, with status worked out from the clock. School Admin. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { rows, total, page, pageCount, counts } = await listMeetingsForAdmin(ctx, readQuery(request, query));
  return apiSuccess(rows, { meta: { total, page, pageCount, counts } });
});

/**
 * Schedule a meeting: `{ title, date: "YYYY-MM-DD", startMinute: "HH:MM",
 * endMinute?, type?, description?, location?, meetingLink?, audiences: [...],
 * scope?, sectionIds?, teacherIds?, staffIds?, studentAdmissionNumbers? }`.
 */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const id = await saveMeeting(ctx, await readJson(request, meetingSchema, { meetingId: undefined }));
  return apiSuccess(await getMeetingForAdmin(ctx, id), { status: 201 });
});
