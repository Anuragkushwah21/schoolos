import "server-only";

import { addDays, today } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import {
  accessibleSectionIds,
  requireSectionAccess,
  requireTeacherSelf,
} from "@/server/auth/teacher-access";
import {
  getCurrentSession,
  requireCurrentSession,
  sectionLabel,
} from "@/server/academics/structure";
import {
  type AttendanceCounts,
  attendedShare,
  emptyCounts,
} from "@/server/attendance/service";

/**
 * What a teacher sees of their own working life: their classes, the children
 * in them, their own record, their own attendance.
 *
 * Everything starts from `ctx.user.id`. No function here accepts a
 * `teacherId`, so none of them can be pointed at a colleague.
 */

/** How many days back the roster's attendance percentage looks. */
const ROSTER_WINDOW_DAYS = 30;

export type TeacherClass = {
  sectionId: string;
  label: string;
  students: number;
  /** Subjects this teacher teaches to this section. */
  subjects: string[];
  isClassTeacher: boolean;
  /** Whether today's register has been taken — by anyone. */
  attendanceMarkedToday: boolean;
};

/**
 * The classes this teacher is responsible for, with today's register status.
 *
 * Built from `TeacherSubjectAssignment` plus class-teachership, which is the
 * same pair `accessibleSectionIds` uses — so what this screen lists and what
 * the server will actually permit cannot drift apart.
 */
export async function getMyClasses(ctx: TenantContext): Promise<TeacherClass[]> {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const session = await requireCurrentSession(ctx);

  const sectionIds = await accessibleSectionIds(ctx, session.id);
  const mine = sectionIds === "ALL" ? [] : sectionIds;
  if (mine.length === 0) return [];

  const [sections, assignments, markedToday] = await Promise.all([
    ctx.db.section.findMany({
      where: { id: { in: mine } },
      select: {
        id: true,
        name: true,
        classTeacherId: true,
        class: { select: { name: true, level: true } },
        stream: { select: { name: true } },
        _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
      },
    }),
    ctx.db.teacherSubjectAssignment.findMany({
      where: { teacherId: teacher.id, academicSessionId: session.id, sectionId: { in: mine } },
      select: { sectionId: true, subject: { select: { name: true } } },
    }),
    ctx.db.studentAttendance.groupBy({
      by: ["sectionId"],
      where: { date: today(), sectionId: { in: mine } },
    }),
  ]);

  const subjectsBySection = new Map<string, string[]>();
  for (const row of assignments) {
    const list = subjectsBySection.get(row.sectionId) ?? [];
    list.push(row.subject.name);
    subjectsBySection.set(row.sectionId, list);
  }

  const marked = new Set(markedToday.map((row) => row.sectionId));

  return sections
    .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
    .map((section) => ({
      sectionId: section.id,
      label: sectionLabel(section),
      students: section._count.enrollments,
      subjects: [...new Set(subjectsBySection.get(section.id) ?? [])].sort(),
      isClassTeacher: section.classTeacherId === teacher.id,
      attendanceMarkedToday: marked.has(section.id),
    }));
}

export type RosterStudent = {
  studentId: string;
  rollNumber: string | null;
  name: string;
  photoUrl: string | null;
  status: string;
  counts: AttendanceCounts;
  /** Null when nothing has been marked yet — not zero, which would read as 0%. */
  share: number | null;
};

/**
 * The children in one of the teacher's sections.
 *
 * `requireSectionAccess` is the whole authorization: it refuses a section in
 * another school (the scoped client cannot even see it) and a section in this
 * school that the teacher does not teach.
 */
export async function getMyRoster(
  ctx: TenantContext,
  sectionId: string,
): Promise<{ section: { id: string; label: string }; students: RosterStudent[]; from: Date; to: Date }> {
  assertRole(ctx.user, "TEACHER");
  await requireSectionAccess(ctx, sectionId);

  const session = await requireCurrentSession(ctx);
  const to = today();
  const from = addDays(to, -ROSTER_WINDOW_DAYS);

  const [section, enrollments, grouped] = await Promise.all([
    ctx.db.section.findFirstOrThrow({
      where: { id: sectionId },
      select: {
        id: true,
        name: true,
        class: { select: { name: true } },
        stream: { select: { name: true } },
      },
    }),
    ctx.db.studentEnrollment.findMany({
      where: { sectionId, academicSessionId: session.id, status: "ACTIVE" },
      select: {
        rollNumber: true,
        student: {
          select: { id: true, firstName: true, lastName: true, photoUrl: true, status: true },
        },
      },
    }),
    ctx.db.studentAttendance.groupBy({
      by: ["studentId", "status"],
      where: { sectionId, date: { gte: from, lte: to } },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, AttendanceCounts>();
  for (const row of grouped) {
    const entry = counts.get(row.studentId) ?? emptyCounts();
    entry[row.status] += row._count._all;
    entry.total += row._count._all;
    counts.set(row.studentId, entry);
  }

  const students = enrollments
    .map((row) => {
      const c = counts.get(row.student.id) ?? emptyCounts();
      return {
        studentId: row.student.id,
        rollNumber: row.rollNumber,
        name: fullName(row.student),
        photoUrl: row.student.photoUrl,
        status: row.student.status,
        counts: c,
        share: attendedShare(c),
      };
    })
    .sort(byRollThenName);

  return { section: { id: section.id, label: sectionLabel(section) }, students, from, to };
}

/** Roll numbers are strings but read as numbers; blanks sort last. */
function byRollThenName(a: RosterStudent, b: RosterStudent): number {
  const left = a.rollNumber ? Number(a.rollNumber) : Number.NaN;
  const right = b.rollNumber ? Number(b.rollNumber) : Number.NaN;
  if (!Number.isNaN(left) && !Number.isNaN(right) && left !== right) return left - right;
  if (!Number.isNaN(left) && Number.isNaN(right)) return -1;
  if (Number.isNaN(left) && !Number.isNaN(right)) return 1;
  return a.name.localeCompare(b.name);
}

/**
 * One child, for the detail view a teacher opens from the roster.
 *
 * Reached through the enrollment so the section — and therefore the
 * permission — comes from the database rather than from the request.
 */
export async function getMyStudent(ctx: TenantContext, studentId: string) {
  assertRole(ctx.user, "TEACHER");
  const session = await requireCurrentSession(ctx);

  const enrollment = await ctx.db.studentEnrollment.findFirst({
    where: { studentId, academicSessionId: session.id, status: "ACTIVE" },
    select: {
      rollNumber: true,
      sectionId: true,
      section: {
        select: {
          id: true,
          name: true,
          class: { select: { name: true } },
          stream: { select: { name: true } },
        },
      },
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          photoUrl: true,
          status: true,
          gender: true,
        },
      },
    },
  });

  if (!enrollment) return null;
  await requireSectionAccess(ctx, enrollment.sectionId);

  const to = today();
  const from = addDays(to, -ROSTER_WINDOW_DAYS);

  const grouped = await ctx.db.studentAttendance.groupBy({
    by: ["status"],
    where: { studentId, date: { gte: from, lte: to } },
    _count: { _all: true },
  });

  const counts = emptyCounts();
  for (const row of grouped) {
    counts[row.status] += row._count._all;
    counts.total += row._count._all;
  }

  return {
    student: {
      id: enrollment.student.id,
      name: fullName(enrollment.student),
      admissionNumber: enrollment.student.admissionNumber,
      photoUrl: enrollment.student.photoUrl,
      status: enrollment.student.status,
      rollNumber: enrollment.rollNumber,
    },
    section: { id: enrollment.section.id, label: sectionLabel(enrollment.section) },
    counts,
    share: attendedShare(counts),
    from,
    to,
  };
}

/**
 * The teacher's own staff record.
 *
 * Read-only by design: designation, employee id, school and assignments are
 * the school's record of them, not a profile they own. Changing any of it is
 * the office's job, which is why there is no counterpart writer here.
 *
 * The session is optional here, unlike everywhere else in this file. Who
 * somebody is does not depend on the school having opened a year: a teacher
 * added before the office sets the current session must still be able to see
 * their own record. Only the assignments are session-scoped, and without one
 * there are simply none to list.
 */
export async function getMyProfile(ctx: TenantContext) {
  assertRole(ctx.user, "TEACHER");
  const session = await getCurrentSession(ctx);

  const teacher = await ctx.db.teacher.findFirst({
    where: { userId: ctx.user.id },
    select: {
      id: true,
      employeeId: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      qualification: true,
      joiningDate: true,
      photoUrl: true,
      status: true,
      assignments: {
        // No session means no assignments, rather than every year's at once.
        where: { academicSessionId: session?.id ?? "__none__" },
        select: {
          id: true,
          subject: { select: { name: true } },
          section: {
            select: {
              id: true,
              name: true,
              class: { select: { name: true, level: true } },
              stream: { select: { name: true } },
            },
          },
        },
      },
      classTeacherOf: {
        where: { academicSessionId: session?.id ?? "__none__" },
        select: {
          id: true,
          name: true,
          class: { select: { name: true } },
          stream: { select: { name: true } },
        },
      },
    },
  });

  if (!teacher) return null;

  return {
    teacher: {
      id: teacher.id,
      employeeId: teacher.employeeId,
      name: fullName(teacher),
      // The signing-in address is on `User`; the staff record's own address is
      // optional and often the school one, so both are worth showing.
      email: teacher.email ?? ctx.user.email,
      loginEmail: ctx.user.email,
      phone: teacher.phone,
      qualification: teacher.qualification,
      joiningDate: teacher.joiningDate,
      photoUrl: teacher.photoUrl,
      status: teacher.status,
    },
    school: { name: ctx.schoolName, slug: ctx.schoolSlug },
    session,
    assignments: teacher.assignments
      .map((a) => ({
        id: a.id,
        subject: a.subject.name,
        sectionId: a.section.id,
        section: sectionLabel(a.section),
        level: a.section.class.level,
      }))
      .sort((a, b) => a.level - b.level || a.section.localeCompare(b.section)),
    classTeacherOf: teacher.classTeacherOf.map((s) => ({ id: s.id, label: sectionLabel(s) })),
  };
}

/**
 * The teacher's own attendance for a month.
 *
 * Read-only: a teacher marking their own attendance would make the record
 * worthless, and `markStaffAttendance` already refuses anyone but a School
 * Admin. This only reads it back.
 */
export async function getMyAttendance(
  ctx: TenantContext,
  options: { year: number; month: number },
) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);

  // Month is 1-based; day 0 of the next month is the last day of this one.
  const from = new Date(Date.UTC(options.year, options.month - 1, 1));
  const to = new Date(Date.UTC(options.year, options.month, 0));

  const rows = await ctx.db.teacherAttendance.findMany({
    where: { teacherId: teacher.id, date: { gte: from, lte: to } },
    orderBy: { date: "desc" },
    select: { id: true, date: true, status: true, checkInTime: true, checkOutTime: true, remarks: true },
  });

  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, ON_LEAVE: 0, total: 0 };
  for (const row of rows) {
    counts[row.status] += 1;
    counts.total += 1;
  }

  return {
    from,
    to,
    rows,
    counts,
    // Present and late both mean they turned up. Leave is neither credit nor
    // blame, so it is shown separately rather than folded into a percentage.
    share: counts.total ? (counts.PRESENT + counts.LATE) / counts.total : null,
  };
}

export type TeachingOption = {
  sectionId: string;
  label: string;
  /** The subjects this teacher may set work in, for this section. */
  subjects: Array<{ id: string; name: string }>;
};

/**
 * The (section, subject) pairs this teacher is assigned to.
 *
 * Setting homework needs a subject assignment, not section access: a class
 * teacher may take any register in their section but may not set Mathematics
 * work unless they teach it. Nesting the subjects inside each section is what
 * keeps a form from offering a pair `requireSubjectAssignment` would refuse —
 * a flat pair of lists would let a teacher choose their Class 6 English
 * against their Class 9 section.
 */
export async function myTeachingOptions(ctx: TenantContext): Promise<TeachingOption[]> {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);
  const session = await requireCurrentSession(ctx);

  const rows = await ctx.db.teacherSubjectAssignment.findMany({
    where: { teacherId: teacher.id, academicSessionId: session.id },
    select: {
      subject: { select: { id: true, name: true } },
      section: {
        select: {
          id: true,
          name: true,
          class: { select: { name: true, level: true } },
          stream: { select: { name: true } },
        },
      },
    },
  });

  const bySection = new Map<string, TeachingOption & { level: number }>();
  for (const row of rows) {
    const entry =
      bySection.get(row.section.id) ??
      {
        sectionId: row.section.id,
        label: sectionLabel(row.section),
        level: row.section.class.level,
        subjects: [],
      };
    if (!entry.subjects.some((subject) => subject.id === row.subject.id)) {
      entry.subjects.push(row.subject);
    }
    bySection.set(row.section.id, entry);
  }

  return [...bySection.values()]
    .sort((a, b) => a.level - b.level || a.label.localeCompare(b.label))
    .map((option) => ({
      sectionId: option.sectionId,
      label: option.label,
      subjects: option.subjects.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}
