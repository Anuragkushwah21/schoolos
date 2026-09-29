import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { cancelMeetingSchema } from "@/lib/validation/meetings";
import { cancelMeeting, getMeetingForAdmin } from "@/server/communication/meetings";

type Params = { meetingId: string };

/** Cancel an upcoming or ongoing meeting: `{ reason? }`. */
export const POST = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  await cancelMeeting(ctx, await readJson(request, cancelMeetingSchema, { meetingId: params.meetingId }));
  return apiSuccess(await getMeetingForAdmin(ctx, params.meetingId));
});
