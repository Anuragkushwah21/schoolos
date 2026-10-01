import "server-only";

import { today } from "@/lib/dates";
import { groupSubjectTeachers, type Placement } from "@/server/academics/streams";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * "Does this teacher teach this student this subject?" — the one rule behind
 * who may raise a concern or add support, and who sees them: the subject
 * teacher of the student's academic group — the teacher assigned to the
 * student's own stream, or, only when nobody is, to the whole section
 * (`groupSubjectTeachers`).
 *
 * A substitute covering a period does not qualify: concerns and support stay
 * with the students' own subject teacher. The substitute sees the cover on
 * their dashboard (class, subject, time) and nothing more.
 *
 * Everything is looked up from the signed-in teacher; nothing from the request.
 */
export async function teachesStudentSubject(ctx: TenantContext, teacherId: string, placement: Placement, subjectId: string): Promise<boolean> {
  return (await groupSubjectTeachers(ctx.db, placement, subjectId)).includes(teacherId);
}

/** Of these teachers, who is on approved leave today — so the office knows who is away. */
export async function onLeaveToday(ctx: TenantContext, teacherIds: Array<string | null>): Promise<Set<string>> {
  const ids = [...new Set(teacherIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Set();
  const now = today();
  const rows = await ctx.db.leaveRequest.findMany({
    where: { teacherId: { in: ids }, status: "APPROVED", startDate: { lte: now }, endDate: { gte: now } },
    select: { teacherId: true },
  });
  return new Set(rows.map((row) => row.teacherId!));
}
