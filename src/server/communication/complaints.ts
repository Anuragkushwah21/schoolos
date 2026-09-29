import "server-only";

import type { ComplaintCategory, ComplaintPriority, ComplaintStatus, Prisma } from "@/generated/prisma/client";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { fullName, humanize } from "@/lib/format";
import type { HandleComplaintInput, RaiseComplaintInput } from "@/lib/validation/complaints";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { findChild } from "@/server/parent/access";
import { findStudentSelf } from "@/server/student/access";

/**
 * Complaints and requests.
 *
 *   * Parent / Student — raise one (a parent about one of their own children),
 *     read their own and the school's response, and close their own.
 *   * School Admin — sees every complaint, assigns it to a staff member,
 *     updates status, responds; bulk status updates.
 *   * Teacher — sees and responds to complaints assigned to them only.
 *
 * Anyone else asking for a complaint gets the same not-found.
 */

const CARD = {
  id: true,
  category: true,
  priority: true,
  subject: true,
  description: true,
  status: true,
  response: true,
  respondedAt: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  raisedBy: { select: { firstName: true, lastName: true, role: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
} as const;

export async function raiseComplaint(ctx: TenantContext, input: RaiseComplaintInput): Promise<{ id: string }> {
  assertRole(ctx.user, "PARENT", "STUDENT");
  let studentId: string | null = null;
  if (ctx.user.role === "STUDENT") {
    studentId = (await findStudentSelf(ctx)).student.id;
  } else if (input.studentId) {
    // Only one of their own children; another family's child is not found.
    const child = await findChild(ctx, input.studentId).catch(() => null);
    if (!child) throw new NotFoundError("That child was not found.");
    studentId = child.student.id;
  }

  const created = await ctx.db.complaint.create({
    data: {
      schoolId: ctx.schoolId,
      raisedById: ctx.user.id,
      studentId,
      category: input.category,
      priority: input.priority,
      subject: input.subject,
      description: input.description,
    },
    select: { id: true },
  });
  await recordAudit({
    action: "COMPLAINT_RAISED",
    entityType: "Complaint",
    entityId: created.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    // The complaint text stays out of the log.
    summary: `${humanize(input.category)} complaint raised (${input.priority.toLowerCase()} priority).`,
  });
  return created;
}

/** Complaints the user may see, by role. */
function visibleWhere(ctx: TenantContext): Prisma.ComplaintWhereInput {
  switch (ctx.user.role) {
    case "SCHOOL_ADMIN":
      return {};
    case "TEACHER":
      return { assignedToId: ctx.user.id };
    case "PARENT":
    case "STUDENT":
      return { raisedById: ctx.user.id };
    default:
      return { id: "__none__" };
  }
}

export async function listComplaints(
  ctx: TenantContext,
  filters: { status?: ComplaintStatus; category?: ComplaintCategory; priority?: ComplaintPriority; q?: string } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN", "TEACHER", "PARENT", "STUDENT");
  return ctx.db.complaint.findMany({
    where: {
      AND: [
        visibleWhere(ctx),
        {
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.category ? { category: filters.category } : {}),
          ...(filters.priority ? { priority: filters.priority } : {}),
          ...(filters.q
            ? {
                OR: [
                  { subject: { contains: filters.q, mode: "insensitive" } },
                  { description: { contains: filters.q, mode: "insensitive" } },
                  { student: { OR: [{ firstName: { contains: filters.q, mode: "insensitive" } }, { admissionNumber: { contains: filters.q, mode: "insensitive" } }] } },
                ],
              }
            : {}),
        },
      ],
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: CARD,
  });
}

export async function getComplaint(ctx: TenantContext, complaintId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN", "TEACHER", "PARENT", "STUDENT");
  const complaint = await ctx.db.complaint.findFirst({ where: { AND: [{ id: complaintId }, visibleWhere(ctx)] }, select: CARD });
  if (!complaint) throw new NotFoundError("That complaint was not found.");
  return complaint;
}

/**
 * Update a complaint. The School Admin may change anything; the assigned
 * teacher may respond and move status, but not reassign.
 */
export async function handleComplaint(ctx: TenantContext, input: HandleComplaintInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN", "TEACHER");
  const complaint = await getComplaint(ctx, input.complaintId);

  let assignedToId = complaint.assignedTo?.id ?? null;
  if (ctx.user.role === "SCHOOL_ADMIN") {
    if (input.assignedToId) {
      const staff = await ctx.db.user.findFirst({
        where: { id: input.assignedToId, role: { in: ["SCHOOL_ADMIN", "TEACHER"] }, isActive: true },
        select: { id: true },
      });
      // A user of another school, a parent or a student cannot be assigned.
      if (!staff) throw new NotFoundError("That staff member was not found.");
      assignedToId = staff.id;
    } else {
      assignedToId = null;
    }
  } else if (input.assignedToId && input.assignedToId !== assignedToId) {
    throw new ForbiddenError("Only the school office can reassign a complaint.");
  }

  const responseChanged = (input.response ?? null) !== complaint.response;
  const settled = input.status === "RESOLVED" || input.status === "CLOSED";
  await ctx.db.complaint.updateMany({
    where: { id: complaint.id },
    data: {
      status: input.status,
      assignedToId,
      response: input.response,
      ...(responseChanged && input.response ? { respondedAt: new Date() } : {}),
      resolvedAt: settled ? (complaint.resolvedAt ?? new Date()) : null,
    },
  });
  await recordAudit({
    action: "COMPLAINT_UPDATED",
    entityType: "Complaint",
    entityId: complaint.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Complaint "${complaint.subject}" set to ${input.status.toLowerCase().replace("_", " ")}${assignedToId !== (complaint.assignedTo?.id ?? null) ? ", reassigned" : ""}.`,
  });
}

export async function bulkComplaintStatus(ctx: TenantContext, input: { complaintIds: string[]; status: ComplaintStatus }): Promise<{ updated: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const ids = [...new Set(input.complaintIds)];
  const found = await ctx.db.complaint.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new NotFoundError("A complaint was not found.");
  const settled = input.status === "RESOLVED" || input.status === "CLOSED";
  await ctx.db.complaint.updateMany({
    where: { id: { in: ids } },
    data: { status: input.status, ...(settled ? { resolvedAt: new Date() } : { resolvedAt: null }) },
  });
  await recordAudit({
    action: "COMPLAINT_UPDATED",
    entityType: "Complaint",
    entityId: null,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${ids.length} complaints set to ${input.status.toLowerCase().replace("_", " ")}.`,
    metadata: { complaintIds: ids },
  });
  return { updated: ids.length };
}

/** The person who raised it may close it once they are satisfied. */
export async function closeMyComplaint(ctx: TenantContext, complaintId: string): Promise<void> {
  assertRole(ctx.user, "PARENT", "STUDENT");
  const complaint = await getComplaint(ctx, complaintId);
  if (complaint.status === "CLOSED") throw new AppError("VALIDATION", "This complaint is already closed.");
  await ctx.db.complaint.updateMany({ where: { id: complaint.id }, data: { status: "CLOSED", resolvedAt: complaint.resolvedAt ?? new Date() } });
}

/** Staff the admin can assign a complaint to. */
export async function assignableStaff(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const users = await ctx.db.user.findMany({
    where: { role: { in: ["SCHOOL_ADMIN", "TEACHER"] }, isActive: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true, role: true },
  });
  return users.map((user) => ({ value: user.id, label: `${fullName(user)}${user.role === "SCHOOL_ADMIN" ? " (office)" : ""}` }));
}
