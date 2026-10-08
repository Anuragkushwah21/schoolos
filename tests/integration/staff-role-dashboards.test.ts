/**
 * Role-specific staff work, all through the one grant system:
 *
 *   * Receptionist (front desk): walk-in enquiries and online applications —
 *     view, add, follow up, move along. Never the fee discussion unless the
 *     admin grants it (a new enquiry is then taken without fee figures), and
 *     never conversion to a student, which stays with the School Admin.
 *   * Accountant: payment history, payroll and the finance reports — each
 *     only with its own permission; take one away and the server refuses.
 *   * Security and support staff can never be given finance permissions.
 *   * Built-in role profiles still on an older shipped default move to the
 *     new default; an edited one is left alone, and no staff member's own
 *     permissions change.
 *   * School B never reaches School A's enquiries or applications.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";
import { createEnquirySchema, type CreateEnquiryInput } from "@/lib/validation/enquiries";
import { admissionApplicationSchema } from "@/lib/validation/website";
import type { TenantContext } from "@/server/auth/current-user";
import { __resetAllRateLimits } from "@/server/auth/rate-limit";
import { addEnquiryFollowUp, convertEnquiryChild, createEnquiry, enquiryCounts, getEnquiry, listEnquiries, saveChildFee, setEnquiryStatus } from "@/server/admissions/enquiries";
import { addFollowUp, applicationCounts, getApplication, listApplications, setApplicationStatus, submitApplication } from "@/server/admissions/service";
import { prisma } from "@/server/db/prisma";
import { listPayments } from "@/server/finance/fees";
import { listSalaries } from "@/server/finance/salary";
import { setStaffGrants } from "@/server/operations/staff";
import { expensesTable, feePaymentsTable, feePositionsTable, salaryPaymentsTable } from "@/server/reports/exports";
import { listRoleProfiles } from "@/server/staff/roles";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
type Person = { id: string; ctx: TenantContext };
let receptionist: Person;
let accountant: Person;
let security: Person;
let support: Person;
let receptionistB: Person;
let slugA: string;

type Role = "ACCOUNTANT" | "RECEPTIONIST" | "SECURITY" | "PEON";

async function addStaff(school: SeededSchool, key: string, role: Role, grants: string[] = STAFF_ROLE_DEFAULT_GRANTS[role]): Promise<Person> {
  const user = await prisma.user.create({ data: { email: `${key}@srd-test.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: key, lastName: "Verma", schoolId: school.schoolId } });
  const staff = await prisma.staffMember.create({ data: { schoolId: school.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Verma", role, grants } });
  return { id: staff.id, ctx: contextFor(school, user.id, "NON_TEACHING_STAFF") };
}

function enquiryForm(extra: Record<string, string> = {}): CreateEnquiryInput {
  return createEnquirySchema.parse({
    parentName: "Meena Joshi",
    relationship: "MOTHER",
    phone: "98111 22334",
    source: "WALK_IN",
    "children.0.firstName": "Kabir",
    "children.0.classId": schoolA.classId,
    "children.0.feeOriginal": "40000",
    "children.0.discountKind": "FIXED",
    "children.0.discountValue": "5000",
    ...extra,
  });
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  slugA = (await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).slug;
  receptionist = await addStaff(schoolA, "srd-rec", "RECEPTIONIST");
  accountant = await addStaff(schoolA, "srd-acc", "ACCOUNTANT");
  security = await addStaff(schoolA, "srd-sec", "SECURITY");
  support = await addStaff(schoolA, "srd-sup", "PEON");
  receptionistB = await addStaff(schoolB, "srd-recb", "RECEPTIONIST");
}, 60_000);

beforeEach(() => __resetAllRateLimits());

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("role defaults", () => {
  it("give each role its own desk and nothing more", () => {
    expect(STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST).toEqual(expect.arrayContaining(["enquiries.view", "enquiries.manage", "admissions.view", "admissions.manage"]));
    expect(STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST).not.toContain("enquiries.fees");
    // The school's accounts: fees, expenses (add & remove), paying salaries, reports.
    expect(STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT).toEqual(expect.arrayContaining(["fees.view", "fees.collect", "fees.reports", "expenses.view", "expenses.create", "expenses.delete", "payroll.view", "payroll.pay"]));
    expect(STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT.some((key) => key.startsWith("enquiries.") || key.startsWith("admissions."))).toBe(false);
    // Security starts with the visitor log, nothing else.
    expect(STAFF_ROLE_DEFAULT_GRANTS.SECURITY).toEqual(["visitors.view", "visitors.manage"]);
    expect(STAFF_ROLE_DEFAULT_GRANTS.PEON).toEqual([]);
  });

  it("never let security or support staff hold finance, whatever the admin ticks", async () => {
    for (const person of [security, support]) {
      await expect(setStaffGrants(adminOf(schoolA), person.id, ["fees.view"])).rejects.toBeInstanceOf(ValidationError);
      await expect(setStaffGrants(adminOf(schoolA), person.id, ["payroll.view"])).rejects.toBeInstanceOf(ValidationError);
      await expect(listPayments(person.ctx, {})).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("receptionist: enquiries", () => {
  let enquiryId: string;

  it("lists, adds and follows up walk-in enquiries", async () => {
    enquiryId = await createEnquiry(receptionist.ctx, enquiryForm());
    expect((await listEnquiries(receptionist.ctx)).some((row) => row.id === enquiryId)).toBe(true);
    await addEnquiryFollowUp(receptionist.ctx, { enquiryId, note: "Called back, visiting Saturday", nextAction: "Campus visit", nextFollowUpOn: addDays(today(), 2), assignedToId: null });
    await setEnquiryStatus(receptionist.ctx, { enquiryId, status: "CONTACTED", reason: null });
    const enquiry = await getEnquiry(receptionist.ctx, enquiryId);
    expect(enquiry.status).toBe("CONTACTED");
    expect((await enquiryCounts(receptionist.ctx)).open).toBeGreaterThanOrEqual(1);
  });

  it("takes the enquiry without fee figures unless the fee discussion is granted", async () => {
    const enquiry = await getEnquiry(receptionist.ctx, enquiryId);
    expect(enquiry.feeStatus).toBe("NOT_STARTED");
    expect(enquiry.children[0]!.finalMinor).toBeNull();
    await expect(saveChildFee(receptionist.ctx, { childId: enquiry.children[0]!.id, feeOriginal: 40_000_00, discountKind: "NONE", discountValue: null, discountReason: null } as never)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("keeps the fee discussion when the admin grants it", async () => {
    await setStaffGrants(adminOf(schoolA), receptionist.id, [...STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST, "enquiries.fees"]);
    const id = await createEnquiry(receptionist.ctx, enquiryForm({ phone: "98111 22335" }));
    expect((await getEnquiry(receptionist.ctx, id)).children[0]!.finalMinor).toBe(3_500_000);
    await setStaffGrants(adminOf(schoolA), receptionist.id, STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST);
  });

  it("cannot admit a child — conversion stays with the School Admin", async () => {
    const enquiry = await getEnquiry(receptionist.ctx, enquiryId);
    await expect(convertEnquiryChild(receptionist.ctx, { enquiryId, childId: enquiry.children[0]!.id, student: {} as never, admissionType: "NEW", confirmNotDuplicate: true } as never)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("loses the desk on the server once the admin turns it off", async () => {
    await setStaffGrants(adminOf(schoolA), receptionist.id, ["enquiries.view"]);
    expect((await listEnquiries(receptionist.ctx)).length).toBeGreaterThan(0);
    await expect(createEnquiry(receptionist.ctx, enquiryForm({ phone: "98111 22336" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addEnquiryFollowUp(receptionist.ctx, { enquiryId, note: "x", nextAction: null, nextFollowUpOn: null, assignedToId: null })).rejects.toBeInstanceOf(ForbiddenError);
    await setStaffGrants(adminOf(schoolA), receptionist.id, []);
    await expect(listEnquiries(receptionist.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await setStaffGrants(adminOf(schoolA), receptionist.id, STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST);
  });

  it("other roles and other schools never reach the enquiries", async () => {
    await expect(listEnquiries(accountant.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listEnquiries(security.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getEnquiry(receptionistB.ctx, enquiryId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listEnquiries(receptionistB.ctx)).some((row) => row.id === enquiryId)).toBe(false);
  });
});

describe("receptionist: online applications", () => {
  let applicationId: string;

  beforeAll(async () => {
    const parsed = admissionApplicationSchema.parse({ studentFirstName: "Tara", studentLastName: "Rao", requestedClassId: schoolA.classId, parentName: "Suresh Rao", parentPhone: "+91 92222 33333" });
    const { applicationNumber } = await submitApplication(slugA, parsed, { ipAddress: "1.1.1.9" });
    applicationId = (await prisma.admissionApplication.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, applicationNumber } })).id;
  });

  it("sees the status and moves an application along", async () => {
    expect((await applicationCounts(receptionist.ctx)).open).toBeGreaterThanOrEqual(1);
    expect((await listApplications(receptionist.ctx)).some((row) => row.id === applicationId)).toBe(true);
    await setApplicationStatus(receptionist.ctx, { applicationId, status: "UNDER_REVIEW", reviewNotes: null });
    await addFollowUp(receptionist.ctx, { applicationId, note: "Documents asked for", nextFollowUpOn: null });
    expect((await getApplication(receptionist.ctx, applicationId)).status).toBe("UNDER_REVIEW");
  });

  it("view-only without the manage permission; nothing for other roles or schools", async () => {
    await setStaffGrants(adminOf(schoolA), receptionist.id, ["admissions.view"]);
    await expect(setApplicationStatus(receptionist.ctx, { applicationId, status: "SHORTLISTED", reviewNotes: null })).rejects.toBeInstanceOf(ForbiddenError);
    await setStaffGrants(adminOf(schoolA), receptionist.id, STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST);
    await expect(listApplications(support.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getApplication(receptionistB.ctx, applicationId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("accountant: finance", () => {
  const from = addDays(today(), -30);
  const to = today();

  it("reads payment history, payroll and every finance report by default", async () => {
    await expect(listPayments(accountant.ctx, {})).resolves.toBeInstanceOf(Array);
    await expect(listSalaries(accountant.ctx)).resolves.toBeTruthy();
    for (const table of [feePositionsTable(accountant.ctx), feePaymentsTable(accountant.ctx, from, to), expensesTable(accountant.ctx, from, to), salaryPaymentsTable(accountant.ctx, from, to)]) {
      await expect(table).resolves.toHaveProperty("rows");
    }
    await setStaffGrants(adminOf(schoolA), accountant.id, STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
  });

  it("each part closes on the server when its permission is turned off", async () => {
    await setStaffGrants(adminOf(schoolA), accountant.id, ["fees.view", "fees.collect"]);
    await expect(feePositionsTable(accountant.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listSalaries(accountant.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listPayments(accountant.ctx, {})).resolves.toBeInstanceOf(Array);
    await setStaffGrants(adminOf(schoolA), accountant.id, ["fees.reports"]);
    // Reports alone do not open expenses or salaries.
    await expect(expensesTable(accountant.ctx, from, to)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(salaryPaymentsTable(accountant.ctx, from, to)).rejects.toBeInstanceOf(ForbiddenError);
    await setStaffGrants(adminOf(schoolA), accountant.id, STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
  });

  it("other roles never reach the finance reports", async () => {
    await expect(feePositionsTable(receptionist.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(feePaymentsTable(security.ctx, from, to)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("role profiles move to the new defaults only when untouched", () => {
  it("upgrades an old built-in default, keeps an edited one, and leaves staff grants alone", async () => {
    await listRoleProfiles(adminOf(schoolA)); // creates the built-ins
    await prisma.staffRoleProfile.updateMany({ where: { schoolId: schoolA.schoolId, baseRole: "RECEPTIONIST", isCustom: false }, data: { defaultGrants: ["students.directory"] } });
    await prisma.staffRoleProfile.updateMany({ where: { schoolId: schoolA.schoolId, baseRole: "ACCOUNTANT", isCustom: false }, data: { defaultGrants: ["fees.view"] } });
    const oldStaff = await addStaff(schoolA, "srd-old", "RECEPTIONIST", ["students.directory"]);
    // The admin set this one by hand: it must never be widened.
    await prisma.staffMember.update({ where: { id: oldStaff.id }, data: { grantsCustomized: true } });

    const roles = await listRoleProfiles(adminOf(schoolA));
    expect(roles.find((role) => role.baseRole === "RECEPTIONIST" && !role.isCustom)!.defaultGrants.sort()).toEqual([...STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST].sort());
    expect(roles.find((role) => role.baseRole === "ACCOUNTANT" && !role.isCustom)!.defaultGrants).toEqual(["fees.view"]);
    expect((await prisma.staffMember.findUniqueOrThrow({ where: { id: oldStaff.id } })).grants).toEqual(["students.directory"]);
  });
});
