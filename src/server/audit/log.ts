import type { AuditAction } from "@/lib/audit-actions";
import { auditModuleFor } from "@/lib/audit-modules";
import { type BaseStaffRole, STAFF_ROLE_NAMES } from "@/lib/staff-access";
import { prisma } from "@/server/db/prisma";

/**
 * Append-only audit trail.
 *
 * Never pass credentials, password hashes or session tokens in `metadata` —
 * this table is read by support staff and exported for review.
 *
 * Writing an audit entry must never break the operation it is recording, so
 * failures are logged and swallowed rather than propagated.
 */

export type { AuditAction };

export type AuditEntry = {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  actorId?: string | null;
  schoolId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  /** Filled from the action name when absent. */
  module?: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "SchoolOS",
  SCHOOL_ADMIN: "School Admin",
  TEACHER: "Teacher",
  STUDENT: "Student",
  PARENT: "Parent",
  NON_TEACHING_STAFF: "Staff",
};

/**
 * The actor's role as it is right now — the moment of the action — so the
 * log keeps "Accountant" even if they later change role or leave. A School
 * Admin doing an accountant's work is recorded as School Admin: nobody is
 * ever impersonated.
 */
async function actorRoleOf(actorId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: { role: true, staffMember: { select: { role: true, roleProfile: { select: { name: true } } } } },
  });
  if (!user) return null;
  if (user.role === "NON_TEACHING_STAFF" && user.staffMember) {
    return user.staffMember.roleProfile?.name ?? STAFF_ROLE_NAMES[user.staffMember.role as BaseStaffRole] ?? "Staff";
  }
  return ROLE_LABEL[user.role] ?? user.role;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const actorRole = entry.actorId ? await actorRoleOf(entry.actorId) : null;
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorRole,
        module: entry.module ?? auditModuleFor(entry.action),
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        actorId: entry.actorId ?? null,
        schoolId: entry.schoolId ?? null,
        metadata: (entry.metadata ?? undefined) as never,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record entry", entry.action, error);
  }
}
