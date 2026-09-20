import { apiRoute, apiSuccess } from "@/server/api/handler";
import { studentHistory } from "@/server/attendance/service";
import { getSectionWeek, requireChildOfParent } from "@/server/people/portal";

/**
 * One child's attendance and timetable.
 *
 * `requireChildOfParent` checks the guardian link in the database, so a
 * guardian cannot read another family's child by editing the id — being in
 * the same school is not enough.
 */
export const GET = apiRoute<{ studentId: string }>({ roles: ["PARENT"] }, async ({ ctx, params }) => {
  const child = await requireChildOfParent(ctx, params.studentId);
  const current = child.enrollments.find((enrollment) => enrollment.academicSession.isCurrent);

  if (!current) return apiSuccess({ child, enrollment: null, attendance: null, timetable: [] });

  const [history, timetable] = await Promise.all([
    studentHistory(ctx, child.id, current.academicSession.id),
    getSectionWeek(ctx, current.section.id, current.academicSession.id),
  ]);

  return apiSuccess({
    child: { id: child.id, firstName: child.firstName, lastName: child.lastName, admissionNumber: child.admissionNumber },
    enrollment: current,
    attendance: { counts: history.counts, attendedShare: history.share, days: history.rows },
    timetable,
  });
});
