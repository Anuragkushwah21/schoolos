import "server-only";

import { CURRENT_EMPLOYEE, employeeMaySignIn } from "@/lib/validation/lifecycle";

import type { Prisma, StaffRole, TeacherStatus } from "@/generated/prisma/client";
import { CsvFormatError, readCsvRecords } from "@/lib/csv";
import { parseDateInput, toDateInput, today } from "@/lib/dates";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { fullName, humanize } from "@/lib/format";
import { STAFF_ROLES, type StaffInput } from "@/lib/validation/operations";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { createPortalUser } from "@/server/people/accounts";
import { changeEmployeeStatus } from "@/server/people/lifecycle";
import type { Credentials } from "@/server/platform/schools";
import { isUniqueViolation } from "@/server/db/errors";
import type { ReportTable } from "@/server/reports/exports";

/**
 * Non-teaching staff: accountants, drivers, librarians, office staff.
 *
 * Basic employment details only — no documents, and no salary here (teacher
 * payroll stays in its own module). School Admin only.
 *
 * A staff member may be given a login with the NON_TEACHING_STAFF role. Their
 * designation (`role`) grants nothing; what they can open is `permissions`,
 * which only the School Admin sets here. The login follows the record: an
 * INACTIVE staff member is signed out and cannot sign in.
 */

const CARD = {
  id: true,
  employeeId: true,
  firstName: true,
  lastName: true,
  role: true,
  designation: true,
  department: true,
  phone: true,
  email: true,
  joiningDate: true,
  status: true,
  notes: true,
  permissions: true,
  userId: true,
} as const;

export async function listStaff(ctx: TenantContext, filters: { q?: string; role?: StaffRole; status?: TeacherStatus | "CURRENT" } = {}) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const where: Prisma.StaffMemberWhereInput = {
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.status === "CURRENT" ? { status: { in: [...CURRENT_EMPLOYEE] } } : filters.status ? { status: filters.status } : {}),
    ...(filters.q
      ? {
          OR: [
            { firstName: { contains: filters.q, mode: "insensitive" } },
            { lastName: { contains: filters.q, mode: "insensitive" } },
            { employeeId: { contains: filters.q, mode: "insensitive" } },
            { phone: { contains: filters.q } },
          ],
        }
      : {}),
  };
  return ctx.db.staffMember.findMany({ where, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: CARD });
}

export async function getStaff(ctx: TenantContext, staffId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const row = await ctx.db.staffMember.findFirst({
    where: { id: staffId },
    select: { ...CARD, user: { select: { id: true, email: true, isActive: true, lastLoginAt: true } } },
  });
  if (!row) throw new NotFoundError("That staff member was not found.");
  return row;
}

export async function saveStaff(ctx: TenantContext, input: StaffInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { staffId, permissions, status, ...fields } = input;
  const data = { ...fields, ...(permissions ? { permissions } : {}) };
  try {
    let id: string;
    if (staffId) {
      const existing = await ctx.db.staffMember.findFirst({ where: { id: staffId }, select: { userId: true, permissions: true, status: true } });
      if (!existing) throw new NotFoundError("That staff member was not found.");
      await ctx.db.staffMember.updateMany({ where: { id: staffId }, data });
      id = staffId;
      if (existing.userId) {
        // The login carries the person's name.
        await ctx.db.user.updateMany({
          where: { id: existing.userId, role: "NON_TEACHING_STAFF" },
          data: { firstName: fields.firstName, lastName: fields.lastName, phone: fields.phone },
        });
      }
      // A status sent with the details (CSV-era forms, the API) is recorded
      // like any other change: dated today, with its effect on the login.
      if (status && status !== existing.status) {
        await changeEmployeeStatus(ctx, "STAFF", staffId, status, { effectiveDate: today(), reason: "Changed on the staff details", remarks: null, confirmReturn: true });
      }
      if (permissions && !sameSet(permissions, existing.permissions)) {
        await recordAudit({
          action: "STAFF_PERMISSIONS_CHANGED",
          entityType: "StaffMember",
          entityId: id,
          schoolId: ctx.schoolId,
          actorId: ctx.user.id,
          summary: `${fields.firstName} ${fields.lastName} may now open: ${permissions.length ? permissions.map(humanize).join(", ") : "nothing beyond their own profile, notices and meetings"}.`,
        });
      }
    } else {
      id = (await ctx.db.staffMember.create({ data: { ...data, status: status ?? "ACTIVE", schoolId: ctx.schoolId }, select: { id: true } })).id;
    }
    await recordAudit({
      action: "STAFF_SAVED",
      entityType: "StaffMember",
      entityId: id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `${humanize(data.role)} ${data.firstName} ${data.lastName} ${staffId ? "updated" : "added"}.`,
    });
    return id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("That employee ID is already in use.");
    throw error;
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

/**
 * Give a staff member a login. The role is always NON_TEACHING_STAFF — set
 * here, never taken from the request — and the password is generated and
 * shown once.
 */
export async function grantStaffPortal(ctx: TenantContext, staffId: string, email: string): Promise<Credentials> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const staff = await ctx.db.staffMember.findFirst({
    where: { id: staffId },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, status: true, userId: true },
  });
  if (!staff) throw new NotFoundError("That staff member was not found.");
  if (staff.userId) throw new ConflictError("This staff member already has a login. Reset its password instead.");
  if (!employeeMaySignIn(staff.status)) throw new ConflictError("Only current staff can be given a login.");

  const { userId, credentials } = await createPortalUser(ctx, {
    email,
    role: "NON_TEACHING_STAFF",
    firstName: staff.firstName,
    lastName: staff.lastName,
    phone: staff.phone,
  });
  // Conditional on still having no login, so two admins racing cannot leave a
  // second, orphaned account linked to nobody.
  const { count } = await ctx.db.staffMember.updateMany({ where: { id: staff.id, userId: null }, data: { userId, email: staff.email ?? email } });
  if (!count) {
    await ctx.db.user.deleteMany({ where: { id: userId } });
    throw new ConflictError("This staff member already has a login. Reset its password instead.");
  }

  await recordAudit({
    action: "PORTAL_ACCESS_GRANTED",
    entityType: "StaffMember",
    entityId: staff.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Staff login ${email} issued.`,
  });
  return { ...credentials, label: `Sign-in for ${staff.firstName} ${staff.lastName}` };
}

/** Options for pickers (drivers, attendants, borrowers). */
export async function staffOptions(ctx: TenantContext, roles?: StaffRole[]) {
  const rows = await ctx.db.staffMember.findMany({
    where: { status: "ACTIVE", ...(roles ? { role: { in: roles } } : {}) },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true, role: true },
  });
  return rows.map((row) => ({ value: row.id, label: `${fullName(row)} (${humanize(row.role)})` }));
}

export const STAFF_IMPORT_COLUMNS = ["Employee ID", "First name", "Last name", "Role", "Designation", "Phone", "Email", "Joining date"] as const;

export type ImportError = { line: number; message: string };

/** Add staff from CSV. Every row checked first; nothing is saved unless all pass. */
export async function importStaff(ctx: TenantContext, text: string): Promise<{ created: number; errors: ImportError[] }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  let records;
  try {
    records = readCsvRecords(text, { required: ["Employee ID", "First name", "Last name", "Role"], maxRows: 500 });
  } catch (error) {
    if (error instanceof CsvFormatError) return { created: 0, errors: [{ line: 1, message: error.message }] };
    throw error;
  }
  const taken = new Set((await ctx.db.staffMember.findMany({ select: { employeeId: true } })).map((row) => row.employeeId.toLowerCase()));
  const roleByKey = new Map(STAFF_ROLES.map((role) => [role.toLowerCase().replace(/_/g, " "), role]));
  const errors: ImportError[] = [];
  const rows: Prisma.StaffMemberCreateManyInput[] = [];

  for (const record of records) {
    const v = record.values;
    const problems: string[] = [];
    const employeeId = v["employee id"] ?? "";
    if (!employeeId) problems.push("employee ID is missing");
    else if (taken.has(employeeId.toLowerCase())) problems.push(`employee ID ${employeeId} is already used`);
    else taken.add(employeeId.toLowerCase());
    if (!v["first name"] || !v["last name"]) problems.push("first and last name are required");
    const role = roleByKey.get((v["role"] ?? "").toLowerCase().replace(/_/g, " "));
    if (!role) problems.push(`role "${v["role"]}" is not one of ${STAFF_ROLES.map((r) => humanize(r)).join(", ")}`);
    const phone = v["phone"] || null;
    if (phone && !/^\+?[0-9][0-9\s-]{6,18}$/.test(phone)) problems.push("phone is invalid");
    const email = v["email"] || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push("email is invalid");
    const joiningRaw = v["joining date"] ?? "";
    const joiningDate = joiningRaw ? parseDateInput(joiningRaw) : null;
    if (joiningRaw && !joiningDate) problems.push("joining date must be YYYY-MM-DD");
    if (problems.length) {
      errors.push({ line: record.line, message: problems.join("; ") });
      continue;
    }
    rows.push({
      schoolId: ctx.schoolId,
      employeeId,
      firstName: v["first name"]!,
      lastName: v["last name"]!,
      role: role!,
      designation: v["designation"] || null,
      phone,
      email: email?.toLowerCase() ?? null,
      joiningDate,
    });
  }
  if (errors.length) return { created: 0, errors };
  if (!rows.length) return { created: 0, errors: [{ line: 1, message: "The file has no rows." }] };

  await ctx.db.staffMember.createMany({ data: rows });
  await recordAudit({
    action: "STAFF_IMPORTED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${rows.length} staff imported from CSV.`,
  });
  return { created: rows.length, errors: [] };
}

export async function staffTable(ctx: TenantContext): Promise<ReportTable> {
  const rows = await listStaff(ctx);
  return {
    head: [...STAFF_IMPORT_COLUMNS, "Status"],
    rows: rows.map((row) => [
      row.employeeId,
      row.firstName,
      row.lastName,
      humanize(row.role),
      row.designation ?? "",
      row.phone ?? "",
      row.email ?? "",
      row.joiningDate ? toDateInput(row.joiningDate) : "",
      humanize(row.status),
    ]),
  };
}
