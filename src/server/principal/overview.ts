import "server-only";

import { addDays, today } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import type { TenantContext } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/permissions";

/**
 * What the Principal oversees, as summaries — never a record to change.
 * Everything comes through `ctx.db`, so it is this school's and no other's;
 * each function checks the Principal's area in `lib/permissions.ts` (the
 * School Admin passes too).
 */

/** Each running section: attendance over the last 30 days, and the average test score over the last 60. */
export async function classPerformance(ctx: TenantContext, academicSessionId: string) {
  assertCan(ctx, "academics", "VIEW");
  const now = today();
  const [sections, attendance, results] = await Promise.all([
    ctx.db.section.findMany({
      where: { academicSessionId, enrollments: { some: { status: "ACTIVE" } } },
      select: { id: true, name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } }, classTeacher: { select: { firstName: true, lastName: true } }, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
    }),
    ctx.db.studentAttendance.groupBy({ by: ["sectionId", "status"], where: { academicSessionId, date: { gte: addDays(now, -30), lte: now } }, _count: { _all: true } }),
    ctx.db.assessmentResult.findMany({
      where: { absent: false, marksObtained: { not: null }, assessment: { academicSessionId, date: { gte: addDays(now, -60), lte: now } } },
      select: { marksObtained: true, assessment: { select: { sectionId: true, maxMarks: true } } },
    }),
  ]);
  return sections
    .map((section) => {
      const rows = attendance.filter((row) => row.sectionId === section.id);
      const total = rows.reduce((sum, row) => sum + row._count._all, 0);
      const attended = rows.filter((row) => row.status === "PRESENT" || row.status === "LATE" || row.status === "HALF_DAY").reduce((sum, row) => sum + row._count._all, 0);
      const marks = results.filter((row) => row.assessment.sectionId === section.id && row.assessment.maxMarks > 0);
      const score = marks.length ? marks.reduce((sum, row) => sum + row.marksObtained! / row.assessment.maxMarks, 0) / marks.length : null;
      return {
        id: section.id,
        label: sectionLabel(section),
        level: section.class.level,
        students: section._count.enrollments,
        classTeacher: section.classTeacher ? fullName(section.classTeacher) : null,
        attendance: total ? attended / total : null,
        averageScore: score,
      };
    })
    .sort((a, b) => a.level - b.level || a.label.localeCompare(b.label));
}

/** Teachers at a glance: what they teach, whether they are in today, and leave. */
export async function teacherOverview(ctx: TenantContext, academicSessionId: string) {
  assertCan(ctx, "staff", "VIEW");
  const date = today();
  const [teachers, marks, leave] = await Promise.all([
    ctx.db.teacher.findMany({
      where: { status: { in: ["ACTIVE", "ON_LEAVE"] } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        designation: true,
        classTeacherOf: { where: { academicSessionId }, select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
        assignments: { where: { section: { academicSessionId } }, select: { subject: { select: { name: true } } } },
      },
    }),
    ctx.db.teacherAttendance.findMany({ where: { date }, select: { teacherId: true, status: true } }),
    ctx.db.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: date }, endDate: { gte: date }, teacherId: { not: null } }, select: { teacherId: true } }),
  ]);
  const markOf = new Map(marks.map((row) => [row.teacherId, row.status]));
  const away = new Set(leave.map((row) => row.teacherId));
  return teachers.map((teacher) => ({
    id: teacher.id,
    name: fullName(teacher),
    designation: teacher.designation,
    classTeacherOf: teacher.classTeacherOf.map((section) => sectionLabel(section)),
    subjects: [...new Set(teacher.assignments.map((row) => row.subject.name))],
    today: away.has(teacher.id) ? "ON_LEAVE" : (markOf.get(teacher.id) ?? null),
  }));
}

/** Today's register, section by section: marked or not, and how many are in. */
export async function attendanceBySection(ctx: TenantContext, academicSessionId: string) {
  assertCan(ctx, "attendance", "VIEW");
  const date = today();
  const [sections, marks] = await Promise.all([
    ctx.db.section.findMany({
      where: { academicSessionId, enrollments: { some: { status: "ACTIVE" } } },
      select: { id: true, name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } }, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
    }),
    ctx.db.studentAttendance.groupBy({ by: ["sectionId", "status"], where: { academicSessionId, date }, _count: { _all: true } }),
  ]);
  return sections
    .map((section) => {
      const rows = marks.filter((row) => row.sectionId === section.id);
      const count = (status: string) => rows.find((row) => row.status === status)?._count._all ?? 0;
      const marked = rows.reduce((sum, row) => sum + row._count._all, 0);
      return {
        id: section.id,
        label: sectionLabel(section),
        level: section.class.level,
        students: section._count.enrollments,
        marked,
        present: count("PRESENT") + count("LATE") + count("HALF_DAY"),
        absent: count("ABSENT"),
        onLeave: count("EXCUSED"),
      };
    })
    .sort((a, b) => a.level - b.level || a.label.localeCompare(b.label));
}

const ATTENDED = ["PRESENT", "LATE", "HALF_DAY"] as const;

/**
 * The rest of the Principal's dashboard, in one pass: how big the school is,
 * subject results, lesson coverage (recorded classes), class/subject teacher
 * coverage, teacher workload, repeated absences and the last week's
 * attendance trend. Summaries only, from this school's data.
 */
export async function principalInsights(ctx: TenantContext, academicSessionId: string) {
  assertCan(ctx, "academics", "VIEW");
  const now = today();
  const weekAgo = addDays(now, -6);
  const [teachers, staff, classes, sections, assignments, slots, results, sessions, weekMarks, absences] = await Promise.all([
    ctx.db.teacher.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
    ctx.db.staffMember.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
    ctx.db.class.count({ where: { sections: { some: { academicSessionId } } } }),
    ctx.db.section.findMany({ where: { academicSessionId }, select: { id: true, classTeacherId: true } }),
    ctx.db.teacherSubjectAssignment.findMany({ where: { academicSessionId }, select: { sectionId: true, teacherId: true } }),
    ctx.db.timetableSlot.groupBy({ by: ["teacherId"], where: { academicSessionId }, _count: { _all: true } }),
    ctx.db.assessmentResult.findMany({
      where: { absent: false, marksObtained: { not: null }, assessment: { academicSessionId, date: { gte: addDays(now, -60), lte: now } } },
      select: { marksObtained: true, assessment: { select: { maxMarks: true, subject: { select: { id: true, name: true } } } } },
    }),
    ctx.db.classSession.groupBy({ by: ["status"], where: { date: { gte: addDays(now, -30), lte: now }, timetableSlot: { academicSessionId } }, _count: { _all: true } }),
    ctx.db.studentAttendance.groupBy({ by: ["date", "status"], where: { academicSessionId, date: { gte: weekAgo, lte: now } }, _count: { _all: true } }),
    ctx.db.studentAttendance.groupBy({ by: ["studentId"], where: { academicSessionId, status: "ABSENT", date: { gte: weekAgo, lte: now } }, _count: { _all: true }, having: { studentId: { _count: { gte: 3 } } } }),
  ]);

  const bySubject = new Map<string, { name: string; sum: number; count: number }>();
  for (const row of results) {
    if (row.assessment.maxMarks <= 0) continue;
    const entry = bySubject.get(row.assessment.subject.id) ?? { name: row.assessment.subject.name, sum: 0, count: 0 };
    entry.sum += row.marksObtained! / row.assessment.maxMarks;
    entry.count += 1;
    bySubject.set(row.assessment.subject.id, entry);
  }
  const subjects = [...bySubject.entries()].map(([id, entry]) => ({ id, name: entry.name, average: entry.sum / entry.count })).sort((a, b) => a.average - b.average);

  const sessionCount = (statuses: string[]) => sessions.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
  const taught = sessionCount(["COMPLETED", "SUBSTITUTE", "REMOTE"]);
  const due = taught + sessionCount(["MISSED"]);

  const withSubjects = new Set(assignments.map((row) => row.sectionId));
  const loads = slots.map((row) => row._count._all);

  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekAgo, index);
    const rows = weekMarks.filter((row) => row.date.getTime() === date.getTime());
    const total = rows.reduce((sum, row) => sum + row._count._all, 0);
    const attended = rows.filter((row) => (ATTENDED as readonly string[]).includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
    return { date, rate: total ? attended / total : null };
  });

  const repeated = absences.length
    ? await ctx.db.student.findMany({
        where: { id: { in: absences.map((row) => row.studentId) } },
        select: { id: true, firstName: true, lastName: true, enrollments: { where: { status: "ACTIVE", section: { academicSessionId } }, take: 1, select: { section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } } } },
      })
    : [];
  const absentDays = new Map(absences.map((row) => [row.studentId, row._count._all]));

  return {
    teachers,
    staff,
    classes,
    sections: sections.length,
    classTeacherCoverage: { covered: sections.filter((row) => row.classTeacherId).length, total: sections.length },
    subjectTeacherCoverage: { covered: sections.filter((row) => withSubjects.has(row.id)).length, total: sections.length },
    subjects,
    lessons: { taught, due, rate: due ? taught / due : null },
    workload: { teachersTimetabled: loads.length, averagePeriods: loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0, maxPeriods: loads.length ? Math.max(...loads) : 0 },
    trend,
    repeatedAbsence: repeated
      .map((student) => ({ id: student.id, name: fullName(student), section: student.enrollments[0] ? sectionLabel(student.enrollments[0].section) : null, days: absentDays.get(student.id) ?? 0 }))
      .sort((a, b) => b.days - a.days),
  };
}
