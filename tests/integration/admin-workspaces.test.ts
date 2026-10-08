/**
 * The School Admin runs the whole school; hired staff get a workspace and
 * responsibilities, never the admin's authority.
 *
 *   * The admin reaches every workspace's work before and after staff are
 *     hired for it, and the staff member's grants never reduce the admin.
 *   * Each role starts in its own workspace (Accountant → Finance,
 *     Receptionist → Front Desk, Security → Gate only) and can be customised.
 *   * Attendance is final only on an explicit Submit: opening and saving a
 *     draft submit nothing, and parents and students see only submitted
 *     attendance. The admin's correction names the student, old → new, the
 *     admin and the reason.
 *   * Another school reaches none of it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ForbiddenError } from "@/lib/errors";
import { staffNav } from "@/lib/nav";
import { STAFF_ROLE_DEFAULT_GRANTS, STAFF_ROLE_WORKSPACE } from "@/lib/staff-access";
import { listEnquiries } from "@/server/admissions/enquiries";
import { listApplications } from "@/server/admissions/service";
import { getRegister, markAttendance, saveRegisterDraft } from "@/server/attendance/register";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { listExpenses } from "@/server/finance/expenses";
import { listFeePositions, listPayments } from "@/server/finance/fees";
import { getPayroll } from "@/server/finance/payroll";
import { listBooks } from "@/server/operations/library";
import { listRoutes } from "@/server/operations/transport";
import { listVisitors } from "@/server/operations/visitors";
import { getChildAttendance } from "@/server/parent/child";
import { getMyAttendance } from "@/server/student/me";
import { setStaffGrants } from "@/server/operations/staff";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
type Person = { id: string; ctx: TenantContext; grants: string[] };
const people: Record<string, Person> = {};

async function hire(key: string, role: "ACCOUNTANT" | "RECEPTIONIST" | "SECURITY" | "LIBRARIAN" | "DRIVER") {
  const user = await prisma.user.create({ data: { email: `${key}@aw-test.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: key, lastName: "W", schoolId: schoolA.schoolId } });
  const staff = await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "W", role, grants: STAFF_ROLE_DEFAULT_GRANTS[role] } });
  people[role] = { id: staff.id, ctx: contextFor(schoolA, user.id, "NON_TEACHING_STAFF"), grants: STAFF_ROLE_DEFAULT_GRANTS[role] };
}

/** One read per workspace, as the admin would open it. */
const workspaceReads = (ctx: TenantContext) => [
  listFeePositions(ctx),
  listPayments(ctx, {}),
  listExpenses(ctx, {}),
  getPayroll(ctx, today()),
  listEnquiries(ctx),
  listApplications(ctx),
  listVisitors(ctx),
  listBooks(ctx),
  listRoutes(ctx),
];

function schoolDay(): Date {
  let day = today();
  while (day.getUTCDay() === 0) day = addDays(day, -1);
  return day;
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("the School Admin runs everything, before and after hiring", () => {
  it("reaches every workspace with no staff hired", async () => {
    for (const read of workspaceReads(adminOf(schoolA))) await expect(read).resolves.toBeDefined();
  });

  it("keeps every workspace after hiring staff for them; their grants never reduce the admin", async () => {
    for (const role of ["ACCOUNTANT", "RECEPTIONIST", "SECURITY", "LIBRARIAN", "DRIVER"] as const) await hire(`aw-${role.toLowerCase()}`, role);
    // Even with the accountant's responsibilities taken away entirely, the admin still collects.
    await setStaffGrants(adminOf(schoolA), people.ACCOUNTANT!.id, []);
    for (const read of workspaceReads(adminOf(schoolA))) await expect(read).resolves.toBeDefined();
    await setStaffGrants(adminOf(schoolA), people.ACCOUNTANT!.id, STAFF_ROLE_DEFAULT_GRANTS.ACCOUNTANT);
  });
});

describe("each role starts in its own workspace", () => {
  const hrefs = (grants: string[]) => staffNav(grants).map((item) => item.href);

  it("Accountant → Finance; Receptionist → Front Desk; Security → Gate only; Librarian → Library", () => {
    expect(STAFF_ROLE_WORKSPACE.ACCOUNTANT).toBe("Finance");
    expect(hrefs(people.ACCOUNTANT!.grants)).toEqual(expect.arrayContaining(["/staff/finance", "/staff/fees"]));
    expect(STAFF_ROLE_WORKSPACE.RECEPTIONIST).toBe("Front Desk");
    expect(hrefs(people.RECEPTIONIST!.grants)).toEqual(expect.arrayContaining(["/staff/enquiries", "/staff/admissions"]));
    expect(hrefs(people.RECEPTIONIST!.grants)).not.toContain("/staff/finance");
    expect(STAFF_ROLE_WORKSPACE.SECURITY).toBe("Gate & Security");
    const security = hrefs(people.SECURITY!.grants);
    expect(security).toContain("/staff/visitors");
    for (const other of ["/staff/finance", "/staff/fees", "/staff/enquiries", "/staff/students", "/staff/library"]) expect(security).not.toContain(other);
    expect(hrefs(people.LIBRARIAN!.grants)).toContain("/staff/library");
  });

  it("staff are held to their responsibilities on the server", async () => {
    await expect(listFeePositions(people.ACCOUNTANT!.ctx)).resolves.toBeDefined();
    await expect(listFeePositions(people.RECEPTIONIST!.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listEnquiries(people.SECURITY!.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listVisitors(people.SECURITY!.ctx)).resolves.toBeDefined();
    await expect(listRoutes(people.DRIVER!.ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a custom responsibility adds to the role default without changing the role", async () => {
    await setStaffGrants(adminOf(schoolA), people.RECEPTIONIST!.id, [...STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST, "visitors.view"]);
    await expect(listVisitors(people.RECEPTIONIST!.ctx)).resolves.toBeDefined();
    expect(STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST).not.toContain("visitors.view");
  });
});

describe("attendance is final only on Submit", () => {
  const date = schoolDay();
  const parent = () => contextFor(schoolA, schoolA.parentUserId, "PARENT");
  const student = () => contextFor(schoolA, schoolA.studentUserId, "STUDENT");

  it("opening and saving a draft submit nothing; parents and students see nothing yet", async () => {
    await prisma.studentAttendance.deleteMany({ where: { schoolId: schoolA.schoolId, date } });
    await getRegister(teacherOf(schoolA), schoolA.sectionId, date);
    await saveRegisterDraft(teacherOf(schoolA), { sectionId: schoolA.sectionId, date, entries: schoolA.studentIds.map((studentId) => ({ studentId, status: "ABSENT" as const, remarks: null })) });
    expect((await getRegister(teacherOf(schoolA), schoolA.sectionId, date)).phase).toBe("DRAFT");
    expect(await prisma.studentAttendance.count({ where: { schoolId: schoolA.schoolId, date } })).toBe(0);
    const child = await getChildAttendance(parent(), schoolA.studentIds[0]!);
    expect(JSON.stringify(child)).not.toContain(date.toISOString());
    const mine = await getMyAttendance(student());
    expect(JSON.stringify(mine)).not.toContain(date.toISOString());
  });

  it("the teacher's Submit makes it visible; the admin's correction is audited with names, old → new and reason", async () => {
    await markAttendance(teacherOf(schoolA), { sectionId: schoolA.sectionId, date, entries: schoolA.studentIds.map((studentId) => ({ studentId, status: "ABSENT" as const, remarks: null })) });
    expect(JSON.stringify(await getChildAttendance(parent(), schoolA.studentIds[0]!))).toContain(date.toISOString());

    await markAttendance(adminOf(schoolA), {
      sectionId: schoolA.sectionId,
      date,
      entries: [{ studentId: schoolA.studentIds[0]!, status: "PRESENT", remarks: null }],
      reason: "Parent confirmed attendance",
    });
    const audit = await prisma.auditLog.findFirst({ where: { schoolId: schoolA.schoolId, action: "ATTENDANCE_CORRECTED" }, orderBy: { createdAt: "desc" } });
    expect(audit).toMatchObject({ actorId: schoolA.adminUserId, actorRole: "School Admin", module: "Attendance" });
    expect(audit?.summary).toMatch(/Absent → Present/);
    expect(audit?.summary).toMatch(/Reason: Parent confirmed attendance/);
    expect((audit?.metadata as { changes: Array<{ old: string; new: string }> }).changes[0]).toMatchObject({ old: "Absent", new: "Present" });
  });
});

describe("tenant isolation across workspaces", () => {
  it("another school's admin and staff see none of School A", async () => {
    const enquiryB = await listEnquiries(adminOf(schoolB));
    expect(enquiryB.every((row) => row.id)).toBe(true);
    const fees = await listFeePositions(adminOf(schoolB));
    expect(JSON.stringify(fees)).not.toContain(schoolA.studentIds[0]!);
    expect((await listVisitors(adminOf(schoolB))).rows).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { schoolId: schoolB.schoolId, action: "ATTENDANCE_CORRECTED" } })).toBe(0);
  });
});
