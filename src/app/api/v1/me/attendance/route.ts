import { apiRoute, apiSuccess } from "@/server/api/handler";
import { NotFoundError } from "@/lib/errors";
import { studentHistory } from "@/server/attendance/service";
import { getStudentPlacement } from "@/server/people/portal";

/** A student's own attendance for the current session. */
export const GET = apiRoute({ roles: ["STUDENT"] }, async ({ ctx }) => {
  const { student, session } = await getStudentPlacement(ctx);
  if (!session) throw new NotFoundError("The school has no current academic session.");

  const history = await studentHistory(ctx, student.id, session.id);
  return apiSuccess({
    session,
    counts: history.counts,
    attendedShare: history.share,
    days: history.rows,
  });
});
