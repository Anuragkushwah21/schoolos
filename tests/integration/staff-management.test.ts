/**
 * Staff management: the creation wizard, role and permission changes,
 * documents, account activation, workspaces and the audit trail.
 *
 *   * The School Admin keeps every operation; staff hold only what is ticked.
 *     A school with no accountant still collects fees — as the admin.
 *   * The wizard creates profile, role, permissions, login, salary and
 *     documents in one go; a bad file refuses the lot and leaves nothing.
 *   * Activation links are single-use and expire; disabled staff cannot sign in.
 *   * Role changes keep or reset custom permissions as asked; defaults restore.
 *   * Audit entries name the real actor and their role, with module and the
 *     old and new values; they survive deactivation.
 *   * School B reaches none of School A's staff, documents or audit entries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { STAFF_ROLE_DEFAULT_GRANTS, permissionSummary } from "@/lib/staff-access";
import { staffSchema } from "@/lib/validation/operations";
import { staffProfileSchema } from "@/lib/validation/staff-profile";
import { listSchoolAudit } from "@/server/audit/school";
import { redeemAccountLink } from "@/server/auth/account-links";
import { authenticate } from "@/server/auth/login";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { listFeePositions, recordPayment } from "@/server/finance/fees";
import { getStaff, saveStaff, setStaffGrants } from "@/server/operations/staff";
import { setLoginAccess } from "@/server/people/lifecycle";
import { listRoleProfiles } from "@/server/staff/roles";
import {
  addStaffDocument,
  archiveStaffDocument,
  changeStaffRole,
  createStaffProfile,
  listStaffDocuments,
  readStaffDocument,
  restoreRoleDefaults,
  staffAuditLog,
  staffPermissionSummary,
} from "@/server/staff/profiles";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { owe } from "../helpers/fees";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";
import { sentMail, tokenFrom } from "../helpers/mail";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let roles: Awaited<ReturnType<typeof listRoleProfiles>>;
let rahul: { staffId: string; userId: string; ctx: TenantContext };

const PDF = (name = "aadhaar.pdf") => new File([Buffer.from("%PDF-1.4\n% staff doc\n")], name, { type: "application/pdf" });
const roleId = (base: string) => roles.find((role) => role.baseRole === base && !role.isCustom)!.id;
const profile = (extra: Record<string, unknown>) =>
  staffProfileSchema.parse({
    fullName: "Rahul Sharma",
    email: "rahul.sharma@sm-test.test",
    phone: "98765 33333",
    designation: "Accountant",
    dateOfBirth: "1990-05-12",
    addressLine: "12 MG Road",
    city: "Indore",
    experienceYears: "6",
    joiningDate: "2026-06-01",
    employmentType: "FULL_TIME",
    salaryMinor: "25,000",
    roleProfileId: roleId("ACCOUNTANT"),
    // The role's defaults, less one, plus one it does not have by default.
    grants: [...STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT, "students.directory"].filter((key) => key !== "fees.reports"),
    createLogin: "on",
    ...extra,
  });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // A payment is only taken against a fee: the first two students owe one.
  for (const studentId of schoolA.studentIds.slice(0, 2)) await owe(adminOf(schoolA), studentId, 1_00_000_00);
  roles = await listRoleProfiles(adminOf(schoolA));
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("the School Admin needs no staff to work", () => {
  it("collects a fee with no accountant on staff, recorded as the School Admin", async () => {
    const { id } = await recordPayment(adminOf(schoolA), { studentId: schoolA.studentIds[0]!, amountMinor: 5_000_00, paidOn: today(), method: "CASH", notes: null, receiptNo: `REC-T-${Math.random().toString(36).slice(2, 8)}` });
    const entry = await prisma.auditLog.findFirst({ where: { schoolId: schoolA.schoolId, action: "FEE_PAYMENT_RECORDED", metadata: { path: ["paymentId"], equals: id } } });
    expect(entry).toMatchObject({ actorId: schoolA.adminUserId, actorRole: "School Admin", module: "Fees" });
  });
});

describe("the creation wizard", () => {
  it("refuses the whole thing for one bad file, leaving nothing behind", async () => {
    const bad = new File([Buffer.from("not a pdf")], "x.pdf", { type: "application/pdf" });
    await expect(createStaffProfile(adminOf(schoolA), profile({}), { documents: [{ type: "AADHAAR", label: null, file: bad }] })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.staffMember.count({ where: { schoolId: schoolA.schoolId, firstName: "Rahul" } })).toBe(0);
    expect(await prisma.user.count({ where: { email: "rahul.sharma@sm-test.test" } })).toBe(0);
  });

  it("creates profile, role, custom permissions, login, salary and documents together", async () => {
    sentMail.length = 0;
    const { staffId, invite } = await createStaffProfile(adminOf(schoolA), profile({}), { documents: [{ type: "AADHAAR", label: null, file: PDF() }] });
    expect(invite?.email).toBe("rahul.sharma@sm-test.test");
    const staff = await prisma.staffMember.findUniqueOrThrow({ where: { id: staffId }, include: { user: true, documents: true, salaries: true } });
    expect(staff).toMatchObject({ firstName: "Rahul", lastName: "Sharma", role: "ACCOUNTANT", city: "Indore", experienceYears: 6, employmentType: "FULL_TIME", status: "ACTIVE" });
    expect(staff.employeeId).toMatch(/^STF-\d{4}$/);
    expect(staff.user).toMatchObject({ role: "NON_TEACHING_STAFF", activatedAt: null });
    expect(staff.documents).toHaveLength(1);
    expect(staff.salaries[0]?.amountMinor).toBe(25_000_00);
    // The mail carries a single-use link to choose a password — never a password.
    expect(sentMail.at(-1)?.text).toMatch(/\/activate\?token=/);
    rahul = { staffId, userId: staff.userId!, ctx: contextFor(schoolA, staff.userId!, "NON_TEACHING_STAFF") };

    const summary = await staffPermissionSummary(adminOf(schoolA), staffId);
    expect(summary.added).toEqual(["students.directory"]);
    expect(summary.removed).toEqual(["fees.reports"]);
    expect(summary.effective).toHaveLength(STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT.length);
  });

  it("refuses a permission the role can never hold, and only the School Admin may create", async () => {
    await expect(
      createStaffProfile(adminOf(schoolA), profile({ fullName: "Sec One", email: "sec1@sm-test.test", roleProfileId: roleId("SECURITY"), grants: ["fees.view"] })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createStaffProfile(teacherOf(schoolA), profile({ email: "x@sm-test.test" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createStaffProfile(rahul.ctx, profile({ email: "y@sm-test.test" }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("activation and sign-in", () => {
  it("activates once; the same link and an expired link are refused", async () => {
    const token = tokenFrom("rahul.sharma@sm-test.test", "activate");
    await redeemAccountLink(token, "ACTIVATION", "Rahul-pass-123", "Rahul-pass-123");
    await expect(redeemAccountLink(token, "ACTIVATION", "Another-pass-1", "Another-pass-1")).rejects.toBeInstanceOf(ValidationError);
    expect((await authenticate("rahul.sharma@sm-test.test", "Rahul-pass-123")).ok).toBe(true);
    const activated = await prisma.auditLog.findFirst({ where: { schoolId: schoolA.schoolId, action: "ACCOUNT_ACTIVATED", actorId: rahul.userId } });
    expect(activated?.actorRole).toBe("Accountant");

    const { invite } = await createStaffProfile(adminOf(schoolA), profile({ fullName: "Late Comer", email: "late@sm-test.test" }));
    expect(invite).toBeTruthy();
    await prisma.accountToken.updateMany({ where: { user: { email: "late@sm-test.test" } }, data: { expiresAt: addDays(new Date(), -1) } });
    await expect(redeemAccountLink(tokenFrom("late@sm-test.test", "activate"), "ACTIVATION", "Late-pass-123", "Late-pass-123")).rejects.toBeInstanceOf(ValidationError);
  });

  it("a disabled login cannot sign in; its history stays", async () => {
    await setLoginAccess(adminOf(schoolA), { person: "STAFF", personId: rahul.staffId, enabled: false, reason: "Test" });
    expect((await authenticate("rahul.sharma@sm-test.test", "Rahul-pass-123")).ok).toBe(false);
    expect((await staffAuditLog(adminOf(schoolA), rahul.staffId)).length).toBeGreaterThan(3);
    await setLoginAccess(adminOf(schoolA), { person: "STAFF", personId: rahul.staffId, enabled: true, reason: null });
    expect((await authenticate("rahul.sharma@sm-test.test", "Rahul-pass-123")).ok).toBe(true);
  });
});

describe("what staff may do", () => {
  it("staff reach only what is granted, even calling the services directly; the admin keeps everything", async () => {
    await expect(listFeePositions(rahul.ctx)).resolves.toHaveProperty("rows");
    await setStaffGrants(adminOf(schoolA), rahul.staffId, ["expenses.view"]);
    await expect(listFeePositions(rahul.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPayment(rahul.ctx, { studentId: schoolA.studentIds[0]!, amountMinor: 100, paidOn: today(), method: "CASH", notes: null, receiptNo: `REC-T-${Math.random().toString(36).slice(2, 8)}` })).rejects.toBeInstanceOf(ForbiddenError);
    // The admin is never reduced by any staff setting.
    await expect(listFeePositions(adminOf(schoolA))).resolves.toHaveProperty("rows");
    await restoreRoleDefaults(adminOf(schoolA), rahul.staffId);
    expect((await staffPermissionSummary(adminOf(schoolA), rahul.staffId)).added).toEqual([]);
  });

  it("a fee collected by the accountant is recorded as the accountant", async () => {
    const { id } = await recordPayment(rahul.ctx, { studentId: schoolA.studentIds[1]!, amountMinor: 2_000_00, paidOn: today(), method: "UPI", notes: null, receiptNo: `REC-T-${Math.random().toString(36).slice(2, 8)}` });
    const entry = await prisma.auditLog.findFirst({ where: { schoolId: schoolA.schoolId, action: "FEE_PAYMENT_RECORDED", metadata: { path: ["paymentId"], equals: id } } });
    expect(entry).toMatchObject({ actorId: rahul.userId, actorRole: "Accountant", module: "Fees" });
  });

  it("changes role keeping or resetting custom permissions, and audits it", async () => {
    await setStaffGrants(adminOf(schoolA), rahul.staffId, [...STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT, "students.directory"]);
    const kept = await changeStaffRole(adminOf(schoolA), { staffId: rahul.staffId, roleProfileId: roleId("RECEPTIONIST"), keepCustom: true });
    // Receptionist defaults already include the directory; the accountant's fee work is not carried as "custom".
    expect(kept.effective).toEqual(expect.arrayContaining(STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST));
    const reset = await changeStaffRole(adminOf(schoolA), { staffId: rahul.staffId, roleProfileId: roleId("ACCOUNTANT"), keepCustom: false });
    expect(reset.effective.sort()).toEqual([...STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT].sort());
    const log = await staffAuditLog(adminOf(schoolA), rahul.staffId, { by: "ABOUT" });
    expect(log.some((row) => row.action === "STAFF_ROLE_CHANGED" && /Accountant → Receptionist/.test(row.summary))).toBe(true);
    expect(log.some((row) => row.action === "STAFF_PERMISSION_REMOVED")).toBe(true);
    expect(permissionSummary("ACCOUNTANT", STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT, [...STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT, "students.directory"]).added).toEqual(["students.directory"]);
  });
});

describe("editing and documents", () => {
  it("records each edited field with old and new values", async () => {
    const before = await getStaff(adminOf(schoolA), rahul.staffId);
    await saveStaff(
      adminOf(schoolA),
      staffSchema.parse({ staffId: rahul.staffId, employeeId: before.employeeId, firstName: "Rahul", lastName: "Sharma", roleProfileId: before.roleProfileId, phone: before.phone ?? "", designation: before.designation ?? "", addressLine: "45 New Palasia", email: "rahul.sharma@sm-test.test" }),
    );
    const entry = await prisma.auditLog.findFirst({ where: { schoolId: schoolA.schoolId, action: "STAFF_UPDATED", entityId: rahul.staffId }, orderBy: { createdAt: "desc" } });
    expect((entry?.metadata as { changes: unknown[] }).changes).toContainEqual(expect.objectContaining({ label: "Address", old: "12 MG Road", new: "45 New Palasia" }));
    expect(entry?.actorRole).toBe("School Admin");
  });

  it("documents are private to the School Admin of the same school; archiving keeps them", async () => {
    const id = await addStaffDocument(adminOf(schoolA), { staffId: rahul.staffId, type: "PAN", label: null, notes: null, file: PDF("pan.pdf") });
    expect((await readStaffDocument(adminOf(schoolA), id)).fileName).toBe("pan.pdf");
    await expect(readStaffDocument(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readStaffDocument(rahul.ctx, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(readStaffDocument(teacherOf(schoolA), id)).rejects.toBeInstanceOf(ForbiddenError);
    await archiveStaffDocument(adminOf(schoolA), id);
    expect((await listStaffDocuments(adminOf(schoolA), rahul.staffId)).some((doc) => doc.id === id)).toBe(false);
    expect((await listStaffDocuments(adminOf(schoolA), rahul.staffId, { archived: true })).some((doc) => doc.id === id)).toBe(true);
  });
});

describe("audit trail and isolation", () => {
  it("filters by person, role and module, and names the real actor", async () => {
    const byRahul = await listSchoolAudit(adminOf(schoolA), { actorId: rahul.userId });
    expect(byRahul.rows.every((row) => row.actor?.name === "Rahul Sharma")).toBe(true);
    const fees = await listSchoolAudit(adminOf(schoolA), { module: "Fees", actorRole: "Accountant" });
    expect(fees.rows.length).toBeGreaterThan(0);
    const staffModule = await listSchoolAudit(adminOf(schoolA), { module: "Staff" });
    expect(staffModule.rows.some((row) => row.action === "STAFF_CREATED")).toBe(true);
  });

  it("keeps the history after deactivation", async () => {
    const count = (await staffAuditLog(adminOf(schoolA), rahul.staffId)).length;
    await prisma.staffMember.update({ where: { id: rahul.staffId }, data: { status: "INACTIVE" } });
    expect((await staffAuditLog(adminOf(schoolA), rahul.staffId)).length).toBeGreaterThanOrEqual(count);
  });

  it("School B reaches none of School A's staff, documents or audit entries", async () => {
    await expect(getStaff(adminOf(schoolB), rahul.staffId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(staffAuditLog(adminOf(schoolB), rahul.staffId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(staffPermissionSummary(adminOf(schoolB), rahul.staffId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(changeStaffRole(adminOf(schoolB), { staffId: rahul.staffId, roleProfileId: roleId("RECEPTIONIST"), keepCustom: true })).rejects.toBeInstanceOf(Error);
    expect((await listSchoolAudit(adminOf(schoolB), { q: "Rahul" })).rows).toHaveLength(0);
    await expect(addStaffDocument(adminOf(schoolB), { staffId: rahul.staffId, type: "OTHER", label: null, notes: null, file: PDF() })).rejects.toBeInstanceOf(NotFoundError);
  });
});
