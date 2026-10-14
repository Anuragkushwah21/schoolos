/**
 * Receptionist and Security, through the one grant system.
 *
 *   * Receptionist: enquiries (search, add, follow up, status), application
 *     status and the basic student lookup by default — never fees, payroll or
 *     meeting scheduling unless the School Admin grants them. With "Schedule
 *     meetings" they arrange meetings and change only their own; deleting stays
 *     with the admin.
 *   * Security: the visitor log by default — entry, exit, corrections, all
 *     audited, no future times — and never guardians' phones, enquiries,
 *     applications or finance, whatever is ticked.
 *   * Another school sees nothing of either.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, toDateInput, today } from "@/lib/dates";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { STAFF_ROLE_DEFAULT_GRANTS } from "@/lib/staff-access";
import { createEnquirySchema } from "@/lib/validation/enquiries";
import { meetingSchema } from "@/lib/validation/meetings";
import { visitorEntrySchema, visitorUpdateSchema } from "@/lib/validation/visitors";
import { addEnquiryFollowUp, createEnquiry, listEnquiries, setEnquiryStatus } from "@/server/admissions/enquiries";
import { applicationCounts } from "@/server/admissions/service";
import type { TenantContext } from "@/server/auth/current-user";
import { getCalendarEntries, upcomingEntries } from "@/server/calendar/entries";
import { cancelMeeting, deleteMeeting, getMeetingForAdmin, listMeetingsForAdmin, saveMeeting } from "@/server/communication/meetings";
import { prisma } from "@/server/db/prisma";
import { listFeePositions } from "@/server/finance/fees";
import { getPayroll } from "@/server/finance/payroll";
import { setStaffGrants } from "@/server/operations/staff";
import { listVisitors, markVisitorExit, recordVisitorEntry, updateVisitor } from "@/server/operations/visitors";
import { staffStudentDirectory } from "@/server/staff/portal";
import { listRoleProfiles } from "@/server/staff/roles";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
type Person = { id: string; ctx: TenantContext };
let receptionist: Person;
let security: Person;

async function addStaff(key: string, role: "RECEPTIONIST" | "SECURITY", school = () => schoolA): Promise<Person> {
  const s = school();
  const user = await prisma.user.create({ data: { email: `${key}@rs-test.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: key, lastName: "R", schoolId: s.schoolId } });
  const staff = await prisma.staffMember.create({ data: { schoolId: s.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "R", role, grants: STAFF_ROLE_DEFAULT_GRANTS[role] } });
  return { id: staff.id, ctx: contextFor(s, user.id, "NON_TEACHING_STAFF") };
}

const meeting = (overrides: Record<string, unknown> = {}) =>
  meetingSchema.parse({ title: "PTM 10-A", date: toDateInput(addDays(today(), 5)), startMinute: "10:00", endMinute: "11:00", audiences: ["PARENTS"], scope: "SCHOOL", ...overrides });
const visitor = (extra: Record<string, unknown> = {}) =>
  visitorEntrySchema.parse({ name: "Ramesh Gupta", phone: "98765 11111", purpose: "Fee enquiry", personToMeet: "Accounts office", vehicleNo: "mp09 ab 1234", ...extra });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  receptionist = await addStaff("rs-rec", "RECEPTIONIST");
  security = await addStaff("rs-sec", "SECURITY");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("receptionist", () => {
  it("works the front desk by default: enquiries, search, follow-ups, status, applications, basic lookup", async () => {
    const id = await createEnquiry(
      receptionist.ctx,
      createEnquirySchema.parse({ parentName: "Sunita Verma", relationship: "MOTHER", phone: "98765 22222", source: "WALK_IN", "children.0.firstName": "Ira", "children.0.classId": schoolA.classId }),
    );
    expect((await listEnquiries(receptionist.ctx, { q: "Sunita" })).map((row) => row.id)).toContain(id);
    await addEnquiryFollowUp(receptionist.ctx, { enquiryId: id, note: "Called", nextAction: "Visit", nextFollowUpOn: addDays(today(), 1), assignedToId: null });
    await setEnquiryStatus(receptionist.ctx, { enquiryId: id, status: "CONTACTED", reason: null });
    await expect(applicationCounts(receptionist.ctx)).resolves.toHaveProperty("open");
    const directory = await staffStudentDirectory(receptionist.ctx, {});
    expect(JSON.stringify(directory)).not.toMatch(/fee|marks|pendingMinor/i);
  });

  it("never fees, payroll or meeting scheduling unless granted", async () => {
    await expect(listFeePositions(receptionist.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPayroll(receptionist.ctx, today())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveMeeting(receptionist.ctx, meeting())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listMeetingsForAdmin(receptionist.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listVisitors(receptionist.ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("with Schedule meetings: schedules, changes and cancels only their own; never deletes", async () => {
    await setStaffGrants(adminOf(schoolA), receptionist.id, [...STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST, "meetings.schedule"]);
    const mine = await saveMeeting(receptionist.ctx, meeting());
    const admins = await saveMeeting(adminOf(schoolA), meeting({ title: "Staff meeting" }));
    expect((await listMeetingsForAdmin(receptionist.ctx)).rows.map((row) => row.id)).toEqual(expect.arrayContaining([mine, admins]));
    // The organizer is reminded of what they scheduled (a parents-only PTM), on their calendar and "coming up";
    // a meeting they neither scheduled nor were invited to stays off it.
    const calendar = (await getCalendarEntries(receptionist.ctx, today(), addDays(today(), 10))).map((entry) => entry.key);
    expect(calendar).toContain(`MEETING:${mine}`);
    expect(calendar).not.toContain(`MEETING:${admins}`);
    expect((await upcomingEntries(receptionist.ctx, 7)).map((entry) => entry.key)).toContain(`MEETING:${mine}`);
    await saveMeeting(receptionist.ctx, meeting({ meetingId: mine, title: "PTM 10-A (moved)" }));
    expect(await getMeetingForAdmin(receptionist.ctx, mine)).toMatchObject({ canEdit: true, canDelete: false });
    expect(await getMeetingForAdmin(receptionist.ctx, admins)).toMatchObject({ canEdit: false, canCancel: false });
    await expect(saveMeeting(receptionist.ctx, meeting({ meetingId: admins }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelMeeting(receptionist.ctx, { meetingId: admins, reason: null })).rejects.toBeInstanceOf(ForbiddenError);
    await cancelMeeting(receptionist.ctx, { meetingId: mine, reason: "Rescheduling" });
    await expect(deleteMeeting(receptionist.ctx, mine)).rejects.toBeInstanceOf(ForbiddenError);
    await setStaffGrants(adminOf(schoolA), receptionist.id, STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST);
    await expect(saveMeeting(receptionist.ctx, meeting())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("security and the visitor log", () => {
  let visitId: string;

  it("an untouched Security role profile gets the visitor log", async () => {
    await listRoleProfiles(adminOf(schoolA));
    await prisma.staffRoleProfile.updateMany({ where: { schoolId: schoolA.schoolId, baseRole: "SECURITY", isCustom: false }, data: { defaultGrants: [] } });
    const role = (await listRoleProfiles(adminOf(schoolA))).find((row) => row.baseRole === "SECURITY" && !row.isCustom)!;
    expect(role.defaultGrants.sort()).toEqual(["visitors.manage", "visitors.view"]);
  });

  it("logs a visitor in and out", async () => {
    visitId = await recordVisitorEntry(security.ctx, visitor());
    const log = await listVisitors(security.ctx);
    expect(log.rows.find((row) => row.id === visitId)).toMatchObject({ status: "INSIDE", vehicleNo: "MP09 AB 1234", personToMeet: "Accounts office" });
    expect(log.inside).toBe(1);
    await markVisitorExit(security.ctx, { visitorId: visitId });
    expect((await listVisitors(security.ctx)).rows.find((row) => row.id === visitId)?.status).toBe("LEFT");
    // Searchable by vehicle or mobile.
    expect((await listVisitors(security.ctx, { q: "MP09" })).rows).toHaveLength(1);
  });

  it("stamps entry and exit with now — no other day or time can be sent; corrections are audited with old and new", async () => {
    // A date and time sent by the browser are ignored: the visit is stamped "now".
    const before = Date.now();
    const id = await recordVisitorEntry(security.ctx, visitorEntrySchema.parse({ name: "Sunil Rao", phone: "98765 22222", purpose: "Delivery", personToMeet: "Office", entryAt: "2026-01-01T09:00" }));
    const row = await prisma.visitor.findUniqueOrThrow({ where: { id } });
    expect(row.entryAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.entryAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    await markVisitorExit(security.ctx, { visitorId: id });
    const out = await prisma.visitor.findUniqueOrThrow({ where: { id } });
    expect(out.exitAt!.getTime()).toBeGreaterThanOrEqual(out.entryAt.getTime());
    expect(out.exitAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    // A correction changes details and status, never the stamped times.
    const stamped = await prisma.visitor.findUniqueOrThrow({ where: { id: visitId } });
    const base = { visitorId: visitId, name: "Ramesh Gupta", phone: "98765 11111", purpose: "Fee enquiry", personToMeet: "Principal", vehicleNo: "MP09 AB 1234", status: "LEFT" };
    await updateVisitor(security.ctx, visitorUpdateSchema.parse({ ...base, entryAt: "2026-01-01T09:00", exitAt: "2026-01-01T10:00" }));
    const corrected = await prisma.visitor.findUniqueOrThrow({ where: { id: visitId } });
    expect(corrected.entryAt.getTime()).toBe(stamped.entryAt.getTime());
    expect(corrected.exitAt?.getTime()).toBe(stamped.exitAt?.getTime());
    const audit = await prisma.auditLog.findFirst({ where: { schoolId: schoolA.schoolId, action: "VISITOR_UPDATED", entityId: visitId } });
    expect(audit?.summary).toMatch(/personToMeet: Accounts office → Principal/);
    expect(audit?.summary).not.toMatch(/entryAt|exitAt/);
    expect(await prisma.auditLog.count({ where: { schoolId: schoolA.schoolId, action: { in: ["VISITOR_ENTERED", "VISITOR_EXITED"] }, entityId: visitId } })).toBe(2);
  });

  it("records someone turned away, closed at once", async () => {
    const id = await recordVisitorEntry(security.ctx, visitor({ name: "Unknown caller", denied: "on" }));
    expect((await listVisitors(security.ctx)).rows.find((row) => row.id === id)).toMatchObject({ status: "DENIED" });
  });

  it("security never reaches guardian phones, enquiries, applications or finance", async () => {
    for (const grant of ["students.contact", "enquiries.view", "admissions.view", "fees.view", "payroll.view", "meetings.schedule"]) {
      await expect(setStaffGrants(adminOf(schoolA), security.id, ["visitors.view", grant])).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(listEnquiries(security.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(applicationCounts(security.ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("view-only without Record entry & exit; the admin controls it", async () => {
    await setStaffGrants(adminOf(schoolA), receptionist.id, [...STAFF_ROLE_DEFAULT_GRANTS.RECEPTIONIST, "visitors.view"]);
    await expect(listVisitors(receptionist.ctx)).resolves.toHaveProperty("rows");
    await expect(recordVisitorEntry(receptionist.ctx, visitor())).rejects.toBeInstanceOf(ForbiddenError);
    await setStaffGrants(adminOf(schoolA), security.id, []);
    await expect(listVisitors(security.ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordVisitorEntry(adminOf(schoolA), visitor({ name: "Admin logged" }))).resolves.toBeTruthy();
  });

  it("another school sees nothing", async () => {
    expect((await listVisitors(adminOf(schoolB), { q: "Ramesh" })).rows).toHaveLength(0);
    await expect(markVisitorExit(adminOf(schoolB), { visitorId: visitId })).rejects.toBeInstanceOf(NotFoundError);
  });
});
