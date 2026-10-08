import "server-only";

import { normalizePhone, phoneErrorFor } from "@/lib/phone";
import { CURRENT_EMPLOYEE, employeeMaySignIn } from "@/lib/validation/lifecycle";

import type { Prisma, StaffRole, TeacherStatus } from "@/generated/prisma/client";
import { CsvFormatError, readCsvRecords } from "@/lib/csv";
import { parseDateInput, toDateInput, today } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName, humanize } from "@/lib/format";
import { STAFF_ROLES, type StaffInput } from "@/lib/validation/operations";
import { type BaseStaffRole, STAFF_ROLE_NAMES, type StaffGrant, allowedGrants, cleanGrants, grantDef } from "@/lib/staff-access";
import { resolveRoleProfile } from "@/server/staff/roles";
import { assertRoleAvailable, assertWithinLimit } from "@/server/platform/entitlements";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import { type LoginInvite, sendActivation } from "@/server/auth/account-links";
import { assertLoginEmailFree, type EmailMove, moveLoginEmail } from "@/server/people/accounts";
import type { TenantContext } from "@/server/auth/current-user";
import { createPortalUser } from "@/server/people/accounts";
import { changeEmployeeStatus } from "@/server/people/lifecycle";
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
  grants: true,
  roleProfileId: true,
  roleProfile: { select: { id: true, name: true, isCustom: true } },
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

export const STAFF_PAGE_SIZE = 30;

/** One page of the staff list, counted and sliced in the database. */
export async function listStaffPage(ctx: TenantContext, filters: { q?: string; role?: StaffRole; status?: TeacherStatus | "CURRENT" } = {}, page = 1) {
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
  const total = await ctx.db.staffMember.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / STAFF_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const rows = await ctx.db.staffMember.findMany({ where, orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }], skip: (current - 1) * STAFF_PAGE_SIZE, take: STAFF_PAGE_SIZE, select: CARD });
  return { rows, total, page: current, pageCount };
}

export async function getStaff(ctx: TenantContext, staffId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const row = await ctx.db.staffMember.findFirst({
    where: { id: staffId },
    select: { ...CARD, ...AUDITED_SELECT, user: { select: { id: true, email: true, isActive: true, lastLoginAt: true, activatedAt: true } } },
  });
  if (!row) throw new NotFoundError("That staff member was not found.");
  return row;
}

/** Save a staff member; returns the id. */
export async function saveStaff(ctx: TenantContext, input: StaffInput): Promise<string> {
  return (await saveStaffDetails(ctx, input)).id;
}

/** Save a staff member, and say whether their sign-in email was corrected. */
export async function saveStaffDetails(ctx: TenantContext, input: StaffInput): Promise<{ id: string; emailMove: EmailMove }> {
  let emailMove: EmailMove = null;
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { staffId, grants: asked, status, roleProfileId: askedProfile, role: askedRole, ...fields } = input;
  // The role profile decides the designation underneath.
  const profile = await resolveRoleProfile(ctx, { roleProfileId: askedProfile, role: askedRole });
  const role = profile.baseRole;
  const existingRow = staffId ? await ctx.db.staffMember.findFirst({ where: { id: staffId }, select: { grants: true, role: true, ...AUDITED_SELECT } }) : null;
  // The plan decides which designations this campus may have, and how many.
  if (!existingRow || existingRow.role !== role) {
    await assertRoleAvailable(ctx, role);
    await assertWithinLimit(ctx, role);
    if (!existingRow) await assertWithinLimit(ctx, "STAFF");
  }
  // Grants asked for; otherwise a new person starts with the role's defaults
  // and an existing one keeps theirs. Anything the designation can never hold
  // (Students or Transport for a Librarian) is never stored.
  const grants = asked ? allowedGrants(role, asked) : staffId ? (existingRow ? allowedGrants(role, existingRow.grants) : undefined) : allowedGrants(role, profile.defaultGrants);
  // Grants sent with the details are the admin's own choice.
  const data = { ...fields, role, roleProfileId: profile.id, ...(grants ? { grants } : {}), ...(asked ? { grantsCustomized: true } : {}) };
  try {
    let id: string;
    if (staffId) {
      const existing = await ctx.db.staffMember.findFirst({ where: { id: staffId }, select: { userId: true, grants: true, status: true } });
      if (!existing) throw new NotFoundError("That staff member was not found.");
      await assertLoginEmailFree(existing.userId, fields.email);
      if (existing.userId && !fields.email) {
        // No email sent (a partial save, an import): the record keeps the address they sign in with.
        const login = await ctx.db.user.findFirst({ where: { id: existing.userId }, select: { email: true } });
        fields.email = login?.email ?? null;
        data.email = fields.email;
      }
      await ctx.db.staffMember.updateMany({ where: { id: staffId }, data });
      id = staffId;
      if (existing.userId) {
        // The login carries the person's name.
        await ctx.db.user.updateMany({
          where: { id: existing.userId, role: "NON_TEACHING_STAFF" },
          data: { firstName: fields.firstName, lastName: fields.lastName, phone: fields.phone },
        });
        // A corrected email moves the sign-in address too.
        emailMove = await moveLoginEmail(ctx, existing.userId, fields.email);
      }
      // A status sent with the details (CSV-era forms, the API) is recorded
      // like any other change: dated today, with its effect on the login.
      if (status && status !== existing.status) {
        await changeEmployeeStatus(ctx, "STAFF", staffId, status, { effectiveDate: today(), reason: "Changed on the staff details", remarks: null, confirmReturn: true });
      }
      if (grants && !sameSet(grants, existing.grants)) await auditGrants(ctx, id, `${fields.firstName} ${fields.lastName}`, grants, existing.grants);
    } else {
      id = (await ctx.db.staffMember.create({ data: { ...data, status: status ?? "ACTIVE", schoolId: ctx.schoolId }, select: { id: true } })).id;
    }
    const changes = existingRow ? fieldChanges(existingRow, { ...data, roleProfileName: profile.name }) : [];
    if (!staffId || changes.length) {
      await recordAudit({
        action: staffId ? "STAFF_UPDATED" : "STAFF_CREATED",
        entityType: "StaffMember",
        entityId: id,
        schoolId: ctx.schoolId,
        actorId: ctx.user.id,
        summary: staffId
          ? `${data.firstName} ${data.lastName}'s record updated: ${changes.map((change) => change.label).join(", ")}.`
          : `${profile.name} ${data.firstName} ${data.lastName} added.`,
        // Old and new values, for the expandable detail on the audit log.
        metadata: staffId ? { changes } : { role: profile.name },
      });
    }
    return { id, emailMove };
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("That employee ID is already in use.");
    throw error;
  }
}

/** The staff fields whose changes are audited, with how they read. */
const AUDITED_FIELDS = {
  firstName: "First name",
  lastName: "Last name",
  employeeId: "Employee ID",
  designation: "Job title",
  department: "Department",
  phone: "Mobile",
  email: "Email",
  joiningDate: "Joining date",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  addressLine: "Address",
  city: "City",
  state: "State",
  postalCode: "PIN code",
  experienceYears: "Experience (years)",
  employmentType: "Employment type",
  emergencyContactName: "Emergency contact",
  emergencyContactPhone: "Emergency contact phone",
  notes: "Notes",
} as const;

const AUDITED_SELECT = Object.fromEntries(Object.keys(AUDITED_FIELDS).map((key) => [key, true])) as { [K in keyof typeof AUDITED_FIELDS]: true };

function shown(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** What changed between the stored record and the save, field by field. Fields the save did not send are unchanged. */
function fieldChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
  return (Object.keys(AUDITED_FIELDS) as Array<keyof typeof AUDITED_FIELDS>)
    .filter((key) => after[key] !== undefined && shown(before[key]) !== shown(after[key]))
    .map((key) => ({ field: key, label: AUDITED_FIELDS[key], old: shown(before[key]), new: shown(after[key]) }));
}

/** Record what was added and taken away, in words, for the Access history and the audit log. */
export async function auditGrants(ctx: TenantContext, staffId: string, name: string, grants: readonly string[], previous: readonly string[] = []) {
  const label = (key: string) => grantDef(key)?.label ?? key;
  const added = grants.filter((key) => !previous.includes(key));
  const removed = previous.filter((key) => !grants.includes(key));
  if (added.length) {
    await recordAudit({
      action: "STAFF_PERMISSION_ADDED",
      entityType: "StaffMember",
      entityId: staffId,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `${name} given: ${added.map(label).join(", ")}.`,
      metadata: { added, grants },
    });
  }
  if (removed.length) {
    await recordAudit({
      action: "STAFF_PERMISSION_REMOVED",
      entityType: "StaffMember",
      entityId: staffId,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `${name} no longer has: ${removed.map(label).join(", ")}.`,
      metadata: { removed, grants },
    });
  }
}

/**
 * Set exactly what one staff member may do. Grants their designation can
 * never hold are refused, not silently dropped, so the admin sees why.
 */
export async function setStaffGrants(ctx: TenantContext, staffId: string, asked: readonly string[]): Promise<StaffGrant[]> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const staff = await ctx.db.staffMember.findFirst({ where: { id: staffId }, select: { id: true, role: true, firstName: true, lastName: true, grants: true } });
  if (!staff) throw new NotFoundError("That staff member was not found.");
  const wanted = cleanGrants(asked);
  const grants = allowedGrants(staff.role, wanted);
  const refused = wanted.filter((key) => !grants.includes(key));
  if (refused.length) {
    throw new ValidationError("Please correct the highlighted fields.", {
      grants: [`A ${STAFF_ROLE_NAMES[staff.role as BaseStaffRole].toLowerCase()} can never have: ${refused.map((key) => grantDef(key)?.label ?? key).join(", ")}.`],
    });
  }
  if (!sameSet(grants, staff.grants)) {
    // Set by hand: from now on the admin's choice, never widened by role updates.
    await ctx.db.staffMember.updateMany({ where: { id: staff.id }, data: { grants, grantsCustomized: true } });
    await auditGrants(ctx, staff.id, fullName(staff), grants, staff.grants);
  }
  return grants;
}

/** What changed in someone's access, newest first: the Access history on their profile. */
export async function staffAccessHistory(ctx: TenantContext, staffId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.auditLog.findMany({
    where: { schoolId: ctx.schoolId, entityType: "StaffMember", entityId: staffId, action: { in: ["STAFF_PERMISSIONS_CHANGED", "STAFF_PERMISSION_ADDED", "STAFF_PERMISSION_REMOVED", "STAFF_PERMISSIONS_RESET", "STAFF_ROLE_CHANGED", "STAFF_SAVED", "STAFF_CREATED", "STAFF_UPDATED", "PORTAL_ACCESS_GRANTED", "STAFF_SUBSTITUTION_SAVED", "STAFF_SUBSTITUTION_ENDED"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, action: true, summary: true, createdAt: true, actor: { select: { firstName: true, lastName: true, email: true } } },
  });
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

/**
 * Give a staff member a login. The role is always NON_TEACHING_STAFF — set
 * here, never taken from the request — and they activate it themselves from
 * the email; nobody else sees the password.
 */
export async function grantStaffPortal(ctx: TenantContext, staffId: string, email: string): Promise<LoginInvite> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const staff = await ctx.db.staffMember.findFirst({
    where: { id: staffId },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, status: true, userId: true },
  });
  if (!staff) throw new NotFoundError("That staff member was not found.");
  if (staff.userId) throw new ConflictError("This staff member already has a login. Send a login email instead.");
  if (!employeeMaySignIn(staff.status)) throw new ConflictError("Only current staff can be given a login.");

  const { userId } = await createPortalUser(ctx, {
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
    throw new ConflictError("This staff member already has a login. Send a login email instead.");
  }

  await recordAudit({
    action: "PORTAL_ACCESS_GRANTED",
    entityType: "StaffMember",
    entityId: staff.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Staff login ${email} created, pending activation.`,
  });
  return { ...(await sendActivation(userId, ctx.user.id)), label: `Login for ${staff.firstName} ${staff.lastName}` };
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
    const phoneRaw = v["phone"] || null;
    // Same rule as the forms: +91 by default, at most 10 digits; stored as "+91 9876543210".
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    if (phoneRaw && !phone) problems.push(`phone is invalid — ${phoneErrorFor(phoneRaw).toLowerCase()}`);
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

export type StaffDayStatus = "PRESENT" | "LATE" | "ABSENT" | "ON_LEAVE";

/**
 * The School Admin's picture of non-teaching staff today: how many there are,
 * who is in, out or on leave, and how many of each designation. Counts and
 * names only — no phone numbers or personal details. "On leave" covers a mark
 * of ON_LEAVE and approved leave not yet marked.
 */
export async function staffOverview(ctx: TenantContext, date: Date = today()) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [staff, marks, leave] = await Promise.all([
    ctx.db.staffMember.findMany({ where: { status: { in: [...CURRENT_EMPLOYEE] } }, select: { id: true, role: true } }),
    ctx.db.staffAttendance.findMany({ where: { date }, select: { staffMemberId: true, status: true } }),
    ctx.db.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: date }, endDate: { gte: date }, staffMemberId: { not: null } },
      select: { staffMemberId: true },
    }),
  ]);
  const current = new Set(staff.map((row) => row.id));
  const statusById: Map<string, StaffDayStatus> = new Map(marks.filter((mark) => current.has(mark.staffMemberId)).map((mark) => [mark.staffMemberId, mark.status]));
  for (const row of leave) if (row.staffMemberId && current.has(row.staffMemberId) && !statusById.has(row.staffMemberId)) statusById.set(row.staffMemberId, "ON_LEAVE");

  const counts = { total: staff.length, present: 0, late: 0, absent: 0, onLeave: 0, notMarked: 0 };
  for (const row of staff) {
    const status = statusById.get(row.id);
    if (status === "PRESENT") counts.present += 1;
    else if (status === "LATE") counts.late += 1;
    else if (status === "ABSENT") counts.absent += 1;
    else if (status === "ON_LEAVE") counts.onLeave += 1;
    else counts.notMarked += 1;
  }
  const byRole = new Map<StaffRole, number>();
  for (const row of staff) byRole.set(row.role, (byRole.get(row.role) ?? 0) + 1);
  return {
    counts,
    byRole: STAFF_ROLES.filter((role) => byRole.has(role)).map((role) => ({ role, count: byRole.get(role)! })),
    /** Today's status per current staff member (absent from the map = not marked). */
    today: statusById,
  };
}

/**
 * One staff member's attendance for a month and their leave history, for the
 * School Admin's staff page. The month is the one containing `month` (any day
 * of it); the register itself is still marked on Attendance → Staff.
 */
export async function staffRecord(ctx: TenantContext, staffId: string, month: Date = today()) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const from = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
  const staff = await ctx.db.staffMember.findFirst({ where: { id: staffId }, select: { id: true } });
  if (!staff) throw new NotFoundError("That staff member was not found.");
  const [days, leave] = await Promise.all([
    ctx.db.staffAttendance.findMany({
      where: { staffMemberId: staffId, date: { gte: from, lte: to } },
      orderBy: { date: "desc" },
      select: { date: true, status: true, remarks: true },
    }),
    ctx.db.leaveRequest.findMany({
      where: { staffMemberId: staffId },
      orderBy: { startDate: "desc" },
      take: 20,
      select: { id: true, type: true, startDate: true, endDate: true, status: true, reason: true },
    }),
  ]);
  const counts: Record<StaffDayStatus, number> = { PRESENT: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0 };
  for (const day of days) counts[day.status] += 1;
  return { from, to, days, counts, leave };
}

/**
 * A staff member's work assignments, for the Work tab: the routes they drive
 * or attend (vehicle, stops, riders) and how many loans they have issued and
 * payments they have taken — whatever applies to them.
 */
export async function staffAssignments(ctx: TenantContext, staffId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const staff = await ctx.db.staffMember.findFirst({ where: { id: staffId }, select: { id: true, userId: true } });
  if (!staff) throw new NotFoundError("That staff member was not found.");
  const [routes, loansIssued, paymentsTaken] = await Promise.all([
    ctx.db.transportRoute.findMany({
      where: { OR: [{ driverId: staff.id }, { attendantId: staff.id }] },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        startPoint: true,
        endPoint: true,
        driverId: true,
        vehicle: { select: { registrationNo: true, capacity: true } },
        _count: { select: { stops: true, students: { where: { status: "ACTIVE" } } } },
      },
    }),
    staff.userId ? ctx.db.bookIssue.count({ where: { issuedById: staff.userId } }) : 0,
    staff.userId ? ctx.db.feePayment.count({ where: { recordedById: staff.userId, voidedAt: null } }) : 0,
  ]);
  return {
    routes: routes.map(({ driverId, _count, ...route }) => ({ ...route, as: driverId === staff.id ? ("Driver" as const) : ("Attendant" as const), stops: _count.stops, riders: _count.students })),
    loansIssued,
    paymentsTaken,
  };
}

/** How many current people each role has — teachers under "TEACHER" — for the workspace cards. */
export async function staffCountsByRole(ctx: TenantContext): Promise<Record<string, number>> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [staff, teachers] = await Promise.all([
    ctx.db.staffMember.groupBy({ by: ["role"], where: { status: { in: ["ACTIVE", "ON_LEAVE"] } }, _count: { _all: true } }),
    ctx.db.teacher.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
  ]);
  return { ...Object.fromEntries(staff.map((row) => [row.role, row._count._all])), TEACHER: teachers };
}
