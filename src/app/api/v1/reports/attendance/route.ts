import { apiRoute, apiSuccess, readQuery } from "@/server/api/handler";
import { today } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { reportQuery } from "@/lib/validation/api";
import { getCurrentSession } from "@/server/academics/structure";
import { schoolReport, sectionReport } from "@/server/attendance/service";

/**
 * Attendance totals over a date range: one section with `?section=`, or every
 * section of the current session without it. Defaults to the session so far.
 */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx }) => {
  const query = readQuery(request, reportQuery);
  const session = await getCurrentSession(ctx);
  if (!session) throw new AppError("CONFLICT", "This school has no current academic session.");

  const now = today();
  const from = query.from ?? session.startDate;
  const to = query.to ?? (now < session.endDate ? now : session.endDate);
  if (from > to) throw new AppError("VALIDATION", "`from` must be on or before `to`.");

  if (query.section) {
    return apiSuccess(await sectionReport(ctx, query.section, from, to), {
      meta: { session, from, to },
    });
  }

  if (ctx.user.role !== "SCHOOL_ADMIN") {
    throw new AppError("FORBIDDEN", "Pass ?section= — teachers see their own classes.");
  }

  return apiSuccess(await schoolReport(ctx, session.id, from, to), { meta: { session, from, to } });
});
