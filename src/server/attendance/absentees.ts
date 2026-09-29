import "server-only";

import { fullName } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";

/**
 * Students marked absent on a day, with everything the office needs to ring
 * home: the class, who marked them and any note, how often they have been
 * absent this year, and every guardian's phone (primary first) plus the
 * emergency contact.
 *
 * School Admin only. It holds families' phone numbers, so it is read through
 * `ctx.db` (this school only) and never offered to other roles.
 */
export async function absentStudents(ctx: TenantContext, input: { date: Date; sectionId?: string }) {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const marks = await ctx.db.studentAttendance.findMany({
    where: { date: input.date, status: "ABSENT", ...(input.sectionId ? { sectionId: input.sectionId } : {}) },
    select: {
      id: true,
      remarks: true,
      markedAt: true,
      academicSessionId: true,
      markedBy: { select: { firstName: true, lastName: true } },
      section: { select: { id: true, name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } } },
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          emergencyContactName: true,
          emergencyContactPhone: true,
          enrollments: { where: { academicSession: { isCurrent: true } }, select: { rollNumber: true } },
          parents: {
            orderBy: { isPrimary: "desc" },
            select: { relationship: true, isPrimary: true, parent: { select: { firstName: true, lastName: true, phone: true, email: true } } },
          },
        },
      },
    },
  });
  if (!marks.length) return { rows: [], total: 0 };

  // How many times each of them has been absent this session, in one query.
  const history = await ctx.db.studentAttendance.groupBy({
    by: ["studentId"],
    where: { studentId: { in: marks.map((mark) => mark.student.id) }, academicSessionId: marks[0]!.academicSessionId, status: "ABSENT" },
    _count: { _all: true },
  });
  const absences = new Map(history.map((row) => [row.studentId, row._count._all]));

  const rows = marks
    .map((mark) => ({
      id: mark.id,
      studentId: mark.student.id,
      name: fullName(mark.student),
      admissionNumber: mark.student.admissionNumber,
      section: sectionLabel(mark.section),
      sectionId: mark.section.id,
      level: mark.section.class.level,
      rollNumber: mark.student.enrollments[0]?.rollNumber ?? null,
      remarks: mark.remarks,
      markedBy: mark.markedBy ? fullName(mark.markedBy) : null,
      markedAt: mark.markedAt,
      absencesThisSession: absences.get(mark.student.id) ?? 1,
      guardians: mark.student.parents.map((link) => ({
        name: fullName(link.parent),
        relationship: link.relationship,
        isPrimary: link.isPrimary,
        phone: link.parent.phone,
        email: link.parent.email,
      })),
      emergency: mark.student.emergencyContactPhone
        ? { name: mark.student.emergencyContactName, phone: mark.student.emergencyContactPhone }
        : null,
    }))
    // By class, then roll number, then name — the order a register is read in.
    .sort(
      (a, b) =>
        a.level - b.level ||
        a.section.localeCompare(b.section) ||
        (Number(a.rollNumber) || 9999) - (Number(b.rollNumber) || 9999) ||
        a.name.localeCompare(b.name),
    );
  return { rows, total: rows.length };
}

/** A phone number as a `tel:` link: digits and a leading + only. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
