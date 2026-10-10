import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { type AuditAction, PLATFORM_AUDIT_ACTIONS } from "@/lib/audit-actions";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { humanize } from "@/lib/format";
import { describeModules } from "@/server/platform/plans";

export const AUDIT_PAGE_SIZE = 50;

/**
 * What the Super Admin may read from the audit trail: platform actions, and
 * anything a Super Admin did themselves (resetting a school admin's password,
 * deactivating one). Everything else is a school's daily operation and stays
 * off platform screens — every Super Admin read of the log goes through this.
 */
export const PLATFORM_AUDIT_WHERE: Prisma.AuditLogWhereInput = {
  OR: [
    { action: { in: [...PLATFORM_AUDIT_ACTIONS] } },
    { actor: { role: "SUPER_ADMIN" } },
  ],
};

/** The platform-level audit trail, newest first. */
export async function listAuditLog(
  actor: SessionUser,
  filters: { action?: AuditAction; schoolId?: string; q?: string; page?: number },
) {
  assertRole(actor, "SUPER_ADMIN");

  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.AuditLogWhereInput = {
    AND: [PLATFORM_AUDIT_WHERE, { OR: [{ schoolId: null }, { school: { isDemo: false } }] }],
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
        metadata: true,
        actor: { select: { email: true, firstName: true, lastName: true, role: true } },
        school: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
}

/**
 * "Previous → new" for an audit row, from what its writer recorded: a status
 * change ({ from, to }) or a settings change ({ previous, next }).
 */
export function auditChange(metadata: unknown): { previous: string; next: string } | null {
  if (!metadata || typeof metadata !== "object") return null;
  const data = metadata as Record<string, unknown>;
  if (typeof data.from === "string" && typeof data.to === "string") return { previous: humanize(data.from), next: humanize(data.to) };
  const show = (value: unknown): string => {
    if (!value || typeof value !== "object") return String(value ?? "—");
    const parts: string[] = [];
    const record = value as Record<string, unknown>;
    if (typeof record.plan === "string" || record.plan === null) parts.push(`Plan: ${record.plan ?? "none"}`);
    if (Array.isArray(record.optionalModules)) parts.push(`Modules: ${describeModules(record.optionalModules as string[])}`);
    if (typeof record.customized === "boolean") parts.push(record.customized ? "set for this school" : "follows plan");
    return parts.join(" · ") || "—";
  };
  if (data.previous !== undefined && data.next !== undefined) return { previous: show(data.previous), next: show(data.next) };
  return null;
}
