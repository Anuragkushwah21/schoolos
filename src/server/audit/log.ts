import type { AuditAction } from "@/lib/audit-actions";
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
};

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
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
