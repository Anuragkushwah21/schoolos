import { apiRoute, apiSuccess } from "@/server/api/handler";
import { myMeetings } from "@/server/communication/meetings";

/** Meetings the caller is invited to: upcoming (with cancellations) and past. */
export const GET = apiRoute({ roles: ["TEACHER", "STUDENT", "PARENT", "NON_TEACHING_STAFF"] }, async ({ ctx }) => apiSuccess(await myMeetings(ctx)));
