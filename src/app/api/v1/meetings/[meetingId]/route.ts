import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { meetingSchema } from "@/lib/validation/meetings";
import { deleteMeeting, getMeetingForAdmin, saveMeeting } from "@/server/communication/meetings";

type Params = { meetingId: string };

export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => apiSuccess(await getMeetingForAdmin(ctx, params.meetingId)));

/** Replace an upcoming meeting's details and invitees. Refused once it has started. */
export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  await saveMeeting(ctx, await readJson(request, meetingSchema, { meetingId: params.meetingId }));
  return apiSuccess(await getMeetingForAdmin(ctx, params.meetingId));
});

/** Delete a cancelled meeting. Scheduled and held meetings are refused. */
export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await deleteMeeting(ctx, params.meetingId);
  return apiSuccess({ deleted: true });
});
