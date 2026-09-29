import { apiRoute, apiSuccess, readQuery } from "@/server/api/handler";
import { listQuery } from "@/lib/validation/api";
import { upcomingEvents } from "@/server/communication/events";
import { noticesFor } from "@/server/communication/notices";

/** Notices addressed to the caller's role, plus what is coming up. */
export const GET = apiRoute(
  { roles: ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT", "NON_TEACHING_STAFF"] },
  async ({ request, ctx }) => {
    const { limit } = readQuery(request, listQuery);
    const [notices, events] = await Promise.all([
      noticesFor(ctx, { take: limit ?? 50 }),
      upcomingEvents(ctx, limit ?? 10),
    ]);
    return apiSuccess({ notices, events });
  },
);
