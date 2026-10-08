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
  filters: { area?: AuditArea; q?: string; from?: Date; to?: Date; page?: number; actorId?: string; actorRole?: string; module?: string; action?: string } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.AuditLogWhereInput = {
    schoolId: ctx.schoolId,
    ...(filters.area ? { OR: AUDIT_AREAS[filters.area].map((prefix) => ({ action: { startsWith: prefix } })) } : {}),
    ...(filters.q ? { summary: { contains: filters.q, mode: "insensitive" } } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.actorRole ? { actorRole: filters.actorRole } : {}),
    ...(filters.module ? { module: filters.module } : {}),
    ...(filters.action ? { action: filters.action } : {}),
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
        entityId: true,
        summary: true,
        module: true,
        actorRole: true,
        metadata: true,
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

/** Choices for the audit filters: people who acted in this school, the roles and modules and actions seen. */
export async function auditFilterOptions(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [actors, roles, modules, actions] = await Promise.all([
    prisma.user.findMany({
      where: { schoolId: ctx.schoolId, auditLogs: { some: { schoolId: ctx.schoolId } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 300,
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.auditLog.findMany({ where: { schoolId: ctx.schoolId, actorRole: { not: null } }, distinct: ["actorRole"], select: { actorRole: true } }),
    prisma.auditLog.findMany({ where: { schoolId: ctx.schoolId, module: { not: null } }, distinct: ["module"], select: { module: true } }),
    prisma.auditLog.findMany({ where: { schoolId: ctx.schoolId }, distinct: ["action"], select: { action: true }, take: 300 }),
  ]);
  return {
    actors: actors.map((row) => ({ value: row.id, label: `${row.firstName} ${row.lastName}` })),
    roles: roles.flatMap((row) => (row.actorRole ? [{ value: row.actorRole, label: row.actorRole }] : [])).sort((a, b) => a.label.localeCompare(b.label)),
    modules: modules.flatMap((row) => (row.module ? [{ value: row.module, label: row.module }] : [])).sort((a, b) => a.label.localeCompare(b.label)),
    actions: actions.map((row) => row.action).sort(),
  };
}

