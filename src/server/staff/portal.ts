import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { fullName } from "@/lib/format";
import { sectionLabel } from "@/server/academics/structure";
import type { TenantContext } from "@/server/auth/current-user";
import { addDays, today } from "@/lib/dates";
import { assertAdminOrStaffPermission, requireStaffSelf, staffHolds } from "@/server/auth/staff-access";
import { isSchoolLeader } from "@/lib/permissions";

/**
 * Read-only views for non-teaching staff who have been granted a module.
 *
 * Deliberately narrower than the admin's screens: the student directory shows
 * who a child is, where they sit and whom to call — never fees, marks, remarks
 * or attendance, which a receptionist or driver has no need to see.
 */

export const DIRECTORY_PAGE_SIZE = 50;

export async function staffStudentDirectory(ctx: TenantContext, filters: { q?: string; sectionId?: string; page?: number } = {}) {
  await assertAdminOrStaffPermission(ctx, "students.directory");
  // Guardian name and phone need their own permission; basic details do not.
  const withContacts = isSchoolLeader(ctx.user.role) || (await staffHolds(ctx, "students.contact"));
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.StudentWhereInput = {
    status: "ACTIVE",
    ...(filters.sectionId ? { enrollments: { some: { sectionId: filters.sectionId, academicSession: { isCurrent: true } } } } : {}),
    ...(filters.q
      ? {
          OR: [
            { firstName: { contains: filters.q, mode: "insensitive" } },
            { lastName: { contains: filters.q, mode: "insensitive" } },
            { admissionNumber: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.student.findMany({
      where,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      skip: (page - 1) * DIRECTORY_PAGE_SIZE,
      take: DIRECTORY_PAGE_SIZE,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNumber: true,
        enrollments: {
          where: { academicSession: { isCurrent: true } },
          select: { rollNumber: true, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } },
        },
        parents: {
          orderBy: { isPrimary: "desc" },
          take: withContacts ? 1 : 0,
          select: { relationship: true, parent: { select: { firstName: true, lastName: true, phone: true } } },
        },
      },
    }),
    ctx.db.student.count({ where }),
  ]);
  return {
    rows: rows.map((row) => {
      const placement = row.enrollments[0];
      const guardian = row.parents[0];
      return {
        id: row.id,
        name: fullName(row),
        admissionNumber: row.admissionNumber,
        section: placement ? sectionLabel(placement.section) : null,
        rollNumber: placement?.rollNumber ?? null,
        guardian: guardian ? { name: fullName(guardian.parent), relationship: guardian.relationship, phone: guardian.parent.phone } : null,
      };
    }),
    total,
    page,
    withContacts,
    pageCount: Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE)),
  };
}

/** The signed-in staff member's own register marks for the last 30 days. */
export async function myStaffAttendance(ctx: TenantContext) {
  const staff = await requireStaffSelf(ctx);
  const to = today();
  const from = addDays(to, -30);
  const rows = await ctx.db.staffAttendance.findMany({
    where: { staffMemberId: staff.id, date: { gte: from, lte: to } },
    orderBy: { date: "desc" },
    select: { date: true, status: true, remarks: true },
  });
  const counts = { PRESENT: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0 };
  for (const row of rows) counts[row.status] += 1;
  return { from, to, rows, counts };
}

/**
 * The fee desk's day for a staff member with fees.view or fees.collect: receipts taken
 * today across the school and by this person, voided receipts left out.
 */
export async function feeDeskToday(ctx: TenantContext) {
  await assertAdminOrStaffPermission(ctx, ["fees.view", "fees.collect", "fees.manage"]);
  const date = today();
  const where = { paidOn: date, voidedAt: null };
  const [all, mine, recent] = await Promise.all([
    ctx.db.feePayment.aggregate({ where, _sum: { amountMinor: true }, _count: true }),
    ctx.db.feePayment.aggregate({ where: { ...where, recordedById: ctx.user.id }, _sum: { amountMinor: true }, _count: true }),
    ctx.db.feePayment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, receiptNo: true, amountMinor: true, method: true, student: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  return {
    receipts: all._count,
    totalMinor: all._sum.amountMinor ?? 0,
    myReceipts: mine._count,
    myTotalMinor: mine._sum.amountMinor ?? 0,
    recent: recent.map((row) => ({ id: row.id, receiptNo: row.receiptNo, amountMinor: row.amountMinor, method: row.method, student: fullName(row.student) })),
  };
}
