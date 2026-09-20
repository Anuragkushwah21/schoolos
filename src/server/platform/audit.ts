import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AuditAction } from "@/lib/audit-actions";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

export const AUDIT_PAGE_SIZE = 50;

/** The platform-wide audit trail, newest first. */
export async function listAuditLog(
  actor: SessionUser,
  filters: { action?: AuditAction; schoolId?: string; q?: string; page?: number },
) {
  assertRole(actor, "SUPER_ADMIN");

  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.schoolId ? { schoolId: filters.schoolId } : {}),
    ...(filters.q ? { summary: { contains: filters.q, mode: "insensitive" } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        action: true,
        summary: true,
        ipAddress: true,
        createdAt: true,
        actor: { select: { email: true } },
        school: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
}
