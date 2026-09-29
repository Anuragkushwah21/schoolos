import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { addDays } from "@/lib/dates";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";

/**
 * A school's own audit trail, for its School Admin.
 *
 * `AuditLog` is written for the platform and every school alike, so it is
 * read here with the session's `schoolId` as a hard filter — never one from
 * the request. Entries a SchoolOS operator made about the school (approval,
 * suspension) show "SchoolOS" rather than the operator's name.
 */

export const SCHOOL_AUDIT_PAGE_SIZE = 50;

/** Groups for the filter, by the prefix of the action name. */
export const AUDIT_AREAS = {
  STUDENTS: ["STUDENT", "ENROLLMENT", "GUARDIAN", "PARENT", "ADMISSION"],
  PEOPLE_ACCESS: ["PERSON_STATUS", "LOGIN_ACCESS", "PORTAL_ACCESS", "PASSWORD_RESET"],
  STUDENT_SUPPORT: ["SUPPORT", "CONCERN"],
  TEACHERS: ["TEACHER", "CLASS_TEACHER", "SUBJECT", "LEAVE", "CLASS_SUBSTITUTE"],
  ATTENDANCE: ["ATTENDANCE", "STAFF_ATTENDANCE", "HOLIDAY", "WEEKLY_OFFS"],
  ACADEMICS: ["EXAM", "MARKS", "RESULTS", "CLASS_TEST", "HOMEWORK", "LESSON", "CLASS_ACTIVITY", "TIMETABLE", "SECTION", "CLASS", "ACADEMIC", "STREAM"],
  FINANCE: ["FEE", "PAYROLL", "SALARY", "EXPENSE"],
  COMMUNICATION: ["NOTICE", "EVENT", "MEETING", "PTM", "COMPLAINT", "WEBSITE"],
} as const;

export type AuditArea = keyof typeof AUDIT_AREAS;

export async function listSchoolAudit(
  ctx: TenantContext,
  filters: { area?: AuditArea; q?: string; from?: Date; to?: Date; page?: number } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.AuditLogWhereInput = {
    schoolId: ctx.schoolId,
    ...(filters.area ? { OR: AUDIT_AREAS[filters.area].map((prefix) => ({ action: { startsWith: prefix } })) } : {}),
    ...(filters.q ? { summary: { contains: filters.q, mode: "insensitive" } } : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: addDays(filters.to, 1) } : {}) } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * SCHOOL_AUDIT_PAGE_SIZE,
      take: SCHOOL_AUDIT_PAGE_SIZE,
      select: {
        id: true,
        action: true,
        entityType: true,
        summary: true,
        createdAt: true,
        actor: { select: { firstName: true, lastName: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      ...row,
      actor: row.actor
        ? row.actor.role === "SUPER_ADMIN"
          ? { name: "SchoolOS", role: "PLATFORM" }
          : { name: `${row.actor.firstName} ${row.actor.lastName}`, role: row.actor.role }
        : null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / SCHOOL_AUDIT_PAGE_SIZE)),
  };
}
