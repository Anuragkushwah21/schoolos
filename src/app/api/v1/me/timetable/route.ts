import { apiRoute, apiSuccess } from "@/server/api/handler";
import { NotFoundError } from "@/lib/errors";
import { getSectionWeek, getStudentPlacement, getTeacherWeek } from "@/server/people/portal";

/**
 * The caller's own week: a teacher's periods, or a student's section.
 * There is no id to pass, so there is nothing to tamper with.
 */
export const GET = apiRoute({ roles: ["TEACHER", "STUDENT"] }, async ({ ctx }) => {
  if (ctx.user.role === "TEACHER") {
    const week = await getTeacherWeek(ctx);
    if (!week) throw new NotFoundError("No timetable yet.");
    return apiSuccess({ session: week.session, slots: week.slots });
  }

  const { session, enrollment } = await getStudentPlacement(ctx);
  if (!session || !enrollment) throw new NotFoundError("You are not placed in a class yet.");

  const slots = await getSectionWeek(ctx, enrollment.section.id, session.id);
  return apiSuccess({ session, section: enrollment.section, slots });
});
