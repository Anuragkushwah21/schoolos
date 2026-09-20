import "server-only";

import { addDays, dayOfWeek, today } from "@/lib/dates";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { accessibleSectionIds } from "@/server/auth/teacher-access";
import { sectionLabel } from "@/server/academics/structure";
import { attendedShare, emptyCounts } from "@/server/attendance/service";
import { attendanceSpark } from "@/server/analytics/student";

/**
 * What the people at a school see of themselves: a teacher's own day, a
 * student's own record, a guardian's own children.
 *
 * Every function starts from `ctx.user.id` rather than an id in the URL. The
 * one exception is a parent asking about a specific child, and that goes
 * through `requireChildOfParent`, which checks the guardian link in the
 * database — being in the same school is never enough.
 */

const SLOT_SELECT = {
  id: true,
  dayOfWeek: true,
  startMinute: true,
  endMinute: true,
  room: true,
  subject: { select: { name: true } },
  teacher: { select: { firstName: true, lastName: true } },
  section: {
    select: { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
  },
} as const;

// -----------------------------------------------------------------------------
// Teacher
// -----------------------------------------------------------------------------

export async function getTeacherDay(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");

  const [teacher, session] = await Promise.all([
    ctx.db.teacher.findFirst({
      where: { userId: ctx.user.id },
      select: { id: true, firstName: true, employeeId: true },
    }),
    ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } }),
  ]);
  if (!teacher || !session) return null;

  const date = today();
  const day = dayOfWeek(date);
  const sectionIds = await accessibleSectionIds(ctx, session.id);
  const mine = sectionIds === "ALL" ? [] : sectionIds;

  const [periods, markedToday, classTeacherOf] = await Promise.all([
    ctx.db.timetableSlot.findMany({
      where: { teacherId: teacher.id, academicSessionId: session.id, dayOfWeek: day },
      orderBy: { startMinute: "asc" },
      select: SLOT_SELECT,
    }),
    ctx.db.studentAttendance.groupBy({
      by: ["sectionId"],
      where: { date, sectionId: { in: mine } },
    }),
    ctx.db.section.findMany({
      where: { classTeacherId: teacher.id, academicSessionId: session.id },
      select: { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
    }),
  ]);

  const sections = await ctx.db.section.findMany({
    where: { id: { in: mine } },
    select: {
      id: true,
      name: true,
      class: { select: { name: true, level: true } },
      stream: { select: { name: true } },
      _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
    },
  });

  const marked = new Set(markedToday.map((row) => row.sectionId));

  return {
    teacher,
    session,
    date,
    day,
    periods,
    classTeacherOf: classTeacherOf.map((section) => ({ id: section.id, label: sectionLabel(section) })),
    sections: sections
      .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
      .map((section) => ({
        id: section.id,
        label: sectionLabel(section),
        students: section._count.enrollments,
        markedToday: marked.has(section.id),
      })),
  };
}

export async function getTeacherWeek(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const [teacher, session] = await Promise.all([
    ctx.db.teacher.findFirst({ where: { userId: ctx.user.id }, select: { id: true } }),
    ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } }),
  ]);
  if (!teacher || !session) return null;

  const slots = await ctx.db.timetableSlot.findMany({
    where: { teacherId: teacher.id, academicSessionId: session.id },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    select: SLOT_SELECT,
  });
  return { session, slots };
}

// -----------------------------------------------------------------------------
// Student
// -----------------------------------------------------------------------------

/** The signed-in student's own enrollment, or null before they are placed. */
export async function getStudentPlacement(ctx: TenantContext) {
  assertRole(ctx.user, "STUDENT");

  const student = await ctx.db.student.findFirst({
    where: { userId: ctx.user.id },
    select: { id: true, firstName: true, lastName: true, admissionNumber: true },
  });
  if (!student) throw new NotFoundError();

  const session = await ctx.db.academicSession.findFirst({
    where: { isCurrent: true },
    select: { id: true, name: true },
  });
  if (!session) return { student, session: null, enrollment: null };

  const enrollment = await ctx.db.studentEnrollment.findFirst({
    where: { studentId: student.id, academicSessionId: session.id },
    select: {
      rollNumber: true,
      section: {
        select: {
          id: true,
          name: true,
          class: { select: { name: true } },
          stream: { select: { name: true } },
          classTeacher: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  return { student, session, enrollment };
}

/** The weekly timetable of a section the caller is entitled to see. */
export async function getSectionWeek(ctx: TenantContext, sectionId: string, academicSessionId: string) {
  return ctx.db.timetableSlot.findMany({
    where: { sectionId, academicSessionId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    select: SLOT_SELECT,
  });
}

// -----------------------------------------------------------------------------
// Parent
// -----------------------------------------------------------------------------

export async function getParentChildren(ctx: TenantContext) {
  assertRole(ctx.user, "PARENT");

  const parent = await ctx.db.parent.findFirst({
    where: { userId: ctx.user.id },
    select: { id: true, firstName: true },
  });
  if (!parent) throw new NotFoundError();

  const session = await ctx.db.academicSession.findFirst({
    where: { isCurrent: true },
    select: { id: true, name: true },
  });

  const links = await ctx.db.parentStudent.findMany({
    where: { parentId: parent.id },
    select: {
      relationship: true,
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          status: true,
          enrollments: {
            where: session ? { academicSessionId: session.id } : { id: "__none__" },
            select: {
              rollNumber: true,
              section: {
                select: { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });

  const date = today();
  const studentIds = links.map((link) => link.student.id);

  const [todayMarks, totals, recent] = await Promise.all([
    ctx.db.studentAttendance.findMany({
      where: { studentId: { in: studentIds }, date },
      select: { studentId: true, status: true },
    }),
    session
      ? ctx.db.studentAttendance.groupBy({
          by: ["studentId", "status"],
          where: { studentId: { in: studentIds }, academicSessionId: session.id },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    ctx.db.studentAttendance.findMany({
      where: { studentId: { in: studentIds }, date: { gte: addDays(date, -30) } },
      orderBy: { date: "asc" },
      select: { studentId: true, date: true, status: true },
    }),
  ]);

  const byStudent = new Map(todayMarks.map((mark) => [mark.studentId, mark.status]));
  const history = new Map<string, Array<{ date: Date; status: (typeof recent)[number]["status"] }>>();
  for (const row of recent) {
    const list = history.get(row.studentId) ?? [];
    list.push({ date: row.date, status: row.status });
    history.set(row.studentId, list);
  }
  const counts = new Map<string, ReturnType<typeof emptyCounts>>();
  for (const row of totals) {
    const entry = counts.get(row.studentId) ?? emptyCounts();
    entry[row.status] += row._count._all;
    entry.total += row._count._all;
    counts.set(row.studentId, entry);
  }

  return {
    parent,
    session,
    date,
    children: links.map((link) => {
      const enrollment = link.student.enrollments[0];
      const tally = counts.get(link.student.id) ?? emptyCounts();
      return {
        id: link.student.id,
        name: `${link.student.firstName} ${link.student.lastName}`,
        admissionNumber: link.student.admissionNumber,
        status: link.student.status,
        relationship: link.relationship,
        sectionId: enrollment?.section.id ?? null,
        sectionLabel: enrollment ? sectionLabel(enrollment.section) : null,
        rollNumber: enrollment?.rollNumber ?? null,
        todayStatus: byStudent.get(link.student.id) ?? null,
        counts: tally,
        share: attendedShare(tally),
        spark: attendanceSpark(history.get(link.student.id) ?? []),
      };
    }),
  };
}

/**
 * A guardian may only ever open a child linked to them. This is the check
 * that makes `/parent/children/<id>` safe: tenant scoping alone would happily
 * return any child in the same school.
 */
export async function requireChildOfParent(ctx: TenantContext, studentId: string) {
  assertRole(ctx.user, "PARENT");

  const parent = await ctx.db.parent.findFirst({ where: { userId: ctx.user.id }, select: { id: true } });
  if (!parent) throw new ForbiddenError();

  const link = await ctx.db.parentStudent.findFirst({
    where: { parentId: parent.id, studentId },
    select: { studentId: true },
  });
  if (!link) throw new NotFoundError();

  const student = await ctx.db.student.findFirst({
    where: { id: studentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNumber: true,
      enrollments: {
        orderBy: { academicSession: { startDate: "desc" } },
        select: {
          rollNumber: true,
          academicSession: { select: { id: true, name: true, isCurrent: true } },
          section: {
            select: { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!student) throw new NotFoundError();
  return student;
}
