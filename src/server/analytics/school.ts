import "server-only";

import type { AttendanceStatus } from "@/generated/prisma/enums";
import { addDays, dayOfWeek, formatDate, toDateInput, today } from "@/lib/dates";
import type { TenantContext } from "@/server/auth/current-user";
import { sectionLabel } from "@/server/academics/structure";
import { attendedShare, emptyCounts, type AttendanceCounts } from "@/server/attendance/service";

/**
 * Aggregates for the school dashboards.
 *
 * Everything here is read through `ctx.db`, so a dashboard can only ever
 * summarise its own school. Each function returns plain numbers: the charts
 * take data, not queries, and are therefore trivial to test and to reuse.
 */

export type TrendPoint = {
  /** UTC-midnight calendar day. */
  date: Date;
  key: string;
  label: string;
  counts: AttendanceCounts;
  /** Present + late over everything marked, or null on a day with no register. */
  share: number | null;
};

/**
 * Daily attendance over the last `days` days, for the whole school or for a
 * set of sections. Days with no register are kept as gaps rather than drawn as
 * zero — a holiday is not 0% attendance.
 */
export async function attendanceTrend(
  ctx: TenantContext,
  options: { academicSessionId: string; days?: number; sectionIds?: string[] },
): Promise<TrendPoint[]> {
  const days = options.days ?? 30;
  const to = today();
  const from = addDays(to, -(days - 1));

  const rows = await ctx.db.studentAttendance.groupBy({
    by: ["date", "status"],
    where: {
      academicSessionId: options.academicSessionId,
      date: { gte: from, lte: to },
      ...(options.sectionIds ? { sectionId: { in: options.sectionIds } } : {}),
    },
    _count: { _all: true },
  });

  const byDay = new Map<string, AttendanceCounts>();
  for (const row of rows) {
    const key = toDateInput(row.date);
    const counts = byDay.get(key) ?? emptyCounts();
    counts[row.status as AttendanceStatus] += row._count._all;
    counts.total += row._count._all;
    byDay.set(key, counts);
  }

  const points: TrendPoint[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(from, offset);
    // Sunday is not a school day anywhere in the product; leave it out entirely
    // rather than drawing a gap the reader has to explain to themselves.
    if (dayOfWeek(date) === "SUNDAY") continue;

    const key = toDateInput(date);
    const counts = byDay.get(key) ?? emptyCounts();
    points.push({
      date,
      key,
      label: formatDate(date),
      counts,
      share: attendedShare(counts),
    });
  }

  return points;
}

/** Active students per class, for the current session. */
export async function classStrength(ctx: TenantContext, academicSessionId: string) {
  const rows = await ctx.db.studentEnrollment.groupBy({
    by: ["classId"],
    where: { academicSessionId, status: "ACTIVE" },
    _count: { _all: true },
  });

  if (!rows.length) return [];

  const classes = await ctx.db.class.findMany({
    where: { id: { in: rows.map((row) => row.classId) } },
    select: { id: true, name: true, level: true },
  });
  const byId = new Map(classes.map((klass) => [klass.id, klass]));

  return rows
    .map((row) => ({
      id: row.classId,
      label: byId.get(row.classId)?.name ?? "—",
      level: byId.get(row.classId)?.level ?? 0,
      value: row._count._all,
    }))
    .sort((a, b) => a.level - b.level);
}

/** Where this session's applications stand. Ordered stages, not categories. */
export async function admissionsFunnel(ctx: TenantContext, academicSessionId: string) {
  const rows = await ctx.db.admissionApplication.groupBy({
    by: ["status"],
    where: { academicSessionId },
    _count: { _all: true },
  });

  const count = (status: string) => rows.find((row) => row.status === status)?._count._all ?? 0;
  const received = rows.reduce((sum, row) => sum + row._count._all, 0);

  return {
    received,
    stages: [
      { key: "RECEIVED", label: "Received", value: received },
      { key: "UNDER_REVIEW", label: "Under review", value: count("UNDER_REVIEW") },
      { key: "WAITLISTED", label: "Waitlisted", value: count("WAITLISTED") },
      { key: "ACCEPTED", label: "Admitted", value: count("ACCEPTED") },
    ],
    rejected: count("REJECTED"),
    waiting: count("SUBMITTED") + count("UNDER_REVIEW"),
  };
}

/**
 * The students a class teacher should look at first: lowest attendance, and
 * only those below the threshold.
 */
export async function studentsNeedingAttention(
  ctx: TenantContext,
  options: { academicSessionId: string; sectionIds?: string[]; threshold?: number; limit?: number },
) {
  const threshold = options.threshold ?? 0.75;

  const grouped = await ctx.db.studentAttendance.groupBy({
    by: ["studentId", "status"],
    where: {
      academicSessionId: options.academicSessionId,
      ...(options.sectionIds ? { sectionId: { in: options.sectionIds } } : {}),
    },
    _count: { _all: true },
  });
  if (!grouped.length) return [];

  const counts = new Map<string, AttendanceCounts>();
  for (const row of grouped) {
    const entry = counts.get(row.studentId) ?? emptyCounts();
    entry[row.status as AttendanceStatus] += row._count._all;
    entry.total += row._count._all;
    counts.set(row.studentId, entry);
  }

  // A handful of marked days says nothing useful; wait for a real denominator.
  const candidates = [...counts.entries()]
    .map(([studentId, tally]) => ({ studentId, counts: tally, share: attendedShare(tally) }))
    .filter((row) => row.counts.total >= 5 && row.share !== null && row.share < threshold)
    .sort((a, b) => (a.share ?? 0) - (b.share ?? 0))
    .slice(0, options.limit ?? 6);

  if (!candidates.length) return [];

  const students = await ctx.db.student.findMany({
    where: { id: { in: candidates.map((row) => row.studentId) }, status: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      enrollments: {
        where: { academicSessionId: options.academicSessionId },
        select: {
          rollNumber: true,
          section: {
            select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
          },
        },
      },
    },
  });
  const byId = new Map(students.map((student) => [student.id, student]));

  return candidates.flatMap((row) => {
    const student = byId.get(row.studentId);
    if (!student) return [];
    const enrollment = student.enrollments[0];
    return [
      {
        id: student.id,
        name: `${student.firstName} ${student.lastName}`,
        section: enrollment ? sectionLabel(enrollment.section) : null,
        rollNumber: enrollment?.rollNumber ?? null,
        counts: row.counts,
        share: row.share,
      },
    ];
  });
}

/** Girls and boys among active students. */
export async function genderSplit(ctx: TenantContext) {
  const rows = await ctx.db.student.groupBy({
    by: ["gender"],
    where: { status: "ACTIVE" },
    _count: { _all: true },
  });

  const count = (gender: string | null) =>
    rows.find((row) => row.gender === gender)?._count._all ?? 0;

  return {
    boys: count("MALE"),
    girls: count("FEMALE"),
    other: count("OTHER") + count(null),
    total: rows.reduce((sum, row) => sum + row._count._all, 0),
  };
}

/** Which of this session's sections have not been marked today. */
export async function registersOutstanding(ctx: TenantContext, academicSessionId: string) {
  const date = today();

  const [sections, marked] = await Promise.all([
    ctx.db.section.findMany({
      where: { academicSessionId, enrollments: { some: { status: "ACTIVE" } } },
      select: {
        id: true,
        name: true,
        class: { select: { name: true, level: true } },
        stream: { select: { name: true } },
        _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
      },
    }),
    ctx.db.studentAttendance.groupBy({ by: ["sectionId"], where: { academicSessionId, date } }),
  ]);

  const done = new Set(marked.map((row) => row.sectionId));

  return sections
    .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
    .map((section) => ({
      id: section.id,
      label: sectionLabel(section),
      students: section._count.enrollments,
      marked: done.has(section.id),
    }));
}
