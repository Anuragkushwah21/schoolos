import { apiRoute, apiSuccess } from "@/server/api/handler";
import { listAcademicSessions, setCurrentSession } from "@/server/academics/structure";

/**
 * Make this the current session. Exactly one is current at any moment: the
 * switch happens in a single transaction.
 */
export const POST = apiRoute<{ sessionId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ ctx, params }) => {
    await setCurrentSession(ctx, params.sessionId);
    return apiSuccess(await listAcademicSessions(ctx));
  },
);
