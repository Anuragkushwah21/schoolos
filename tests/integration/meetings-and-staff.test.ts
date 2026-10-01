/**
 * Meetings (invitations, not bookings) and non-teaching staff logins.
 *
 * For each: who is invited and who is not, the date-aware status, what the
 * office may still change, what a staff login can and cannot open, and that
 * nothing crosses from one school to another.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today, toDateInput } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { roleHomePath } from "@/lib/roles";
import { meetingStatus, schoolNow } from "@/lib/time-status";
import { noticeSchema } from "@/lib/validation/communication";
import { meetingSchema } from "@/lib/validation/meetings";
import { staffSchema } from "@/lib/validation/operations";
import { getStaffAlerts } from "@/server/alerts/feeds";
import { authenticate } from "@/server/auth/login";
import { createSession, validateSessionToken } from "@/server/auth/session";
import { assertAdminOrStaffPermission, requireStaffSelf, staffPermissions } from "@/server/auth/staff-access";
import {
  cancelMeeting,
  deleteMeeting,
  getMeetingForAdmin,
  listMeetingsForAdmin,
  myMeetings,
  saveMeeting,
} from "@/server/communication/meetings";
import { noticesFor, saveNotice } from "@/server/communication/notices";
import { prisma } from "@/server/db/prisma";
import { listBooks } from "@/server/operations/library";
import { getStaff, grantStaffPortal, listStaff, saveStaff } from "@/server/operations/staff";
import { listRoutes } from "@/server/operations/transport";
import { getParentAlerts } from "@/server/parent/alerts";
import { resetPortalPassword } from "@/server/people/accounts";
import { listStudents } from "@/server/people/students";
import { staffStudentDirectory } from "@/server/staff/portal";

import { redeemAccountLink } from "@/server/auth/account-links";
import { activate, tokenFrom } from "../helpers/mail";
import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");

/** A staff member with a login in each school, filled in by the staff suite. */
const staff: Record<"A" | "B", { staffId: string; userId: string; email: string; password: string }> = {} as never;
const staffOf = (school: SeededSchool) => contextFor(school, staff[school === schoolA ? "A" : "B"].userId, "NON_TEACHING_STAFF");

const future = (days = 5) => toDateInput(addDays(today(), days));
const meeting = (overrides: Record<string, unknown> = {}) =>
  meetingSchema.parse({ title: "Meeting", date: future(), startMinute: "10:00", endMinute: "11:00", audiences: ["PARENTS"], scope: "SCHOOL", ...overrides });
const idsOf = async (ctx: ReturnType<typeof contextFor>) => {
  const { upcoming, past } = await myMeetings(ctx);
  return [...upcoming, ...past].map((row) => row.id);
};

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

// -----------------------------------------------------------------------------
// Staff logins
// -----------------------------------------------------------------------------

describe("non-teaching staff", () => {
  it("is created by the School Admin and given a NON_TEACHING_STAFF login linked to the record", async () => {
    for (const [key, school] of [["A", schoolA], ["B", schoolB]] as const) {
      const staffId = await saveStaff(
        adminOf(school),
        staffSchema.parse({ employeeId: `NT-${key}`, firstName: "Sunita", lastName: key, role: "OFFICE_STAFF", department: "Library", phone: "+91 90000 11111" }),
      );
      const email = `staff-${key.toLowerCase()}@iso-test-staff.test`;
      await grantStaffPortal(adminOf(school), staffId, email);
      const record = await prisma.staffMember.findUniqueOrThrow({ where: { id: staffId }, include: { user: true } });
      expect(record.user?.role).toBe("NON_TEACHING_STAFF");
      expect(record.user?.schoolId).toBe(school.schoolId);
      expect(record.department).toBe("Library");
      expect(record.permissions).toEqual([]);
      staff[key] = { staffId, userId: record.userId!, email, password: await activate(email) };
    }
  });

  it("signs in with the common login and lands on the staff dashboard", async () => {
    const outcome = await authenticate(staff.A.email, staff.A.password);
    expect(outcome).toMatchObject({ ok: true, schoolId: schoolA.schoolId });
    expect(await authenticate(staff.A.email, "wrong-password")).toMatchObject({ ok: false, reason: "INVALID_CREDENTIALS" });

    const { token } = await createSession(staff.A.userId);
    const session = await validateSessionToken(token);
    expect(session?.role).toBe("NON_TEACHING_STAFF");
    expect(session?.schoolId).toBe(schoolA.schoolId);
    expect(roleHomePath(session!.role)).toBe("/staff/dashboard");
  });

  it("refuses a second login, a teacher issuing one, and another school's staff id", async () => {
    await expect(grantStaffPortal(adminOf(schoolA), staff.A.staffId, "again@iso-test-staff.test")).rejects.toBeInstanceOf(ConflictError);
    const spare = await saveStaff(adminOf(schoolA), staffSchema.parse({ employeeId: "NT-A2", firstName: "Raju", lastName: "A", role: "DRIVER" }));
    await expect(grantStaffPortal(teacherOf(schoolA), spare, "x@iso-test-staff.test")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(grantStaffPortal(adminOf(schoolB), spare, "x@iso-test-staff.test")).rejects.toBeInstanceOf(NotFoundError);
    // An email already used by any account is refused, even another school's.
    await expect(grantStaffPortal(adminOf(schoolA), spare, staff.B.email)).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.staffMember.findUniqueOrThrow({ where: { id: spare }, select: { userId: true } })).toEqual({ userId: null });
  });

  it("sees their own profile and nothing of the School Admin's", async () => {
    const self = await requireStaffSelf(staffOf(schoolA));
    expect(self).toMatchObject({ id: staff.A.staffId, role: "OFFICE_STAFF" });

    // A designation grants nothing by itself (Librarian is the one exception: it always runs the library).
    await expect(listBooks(staffOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listRoutes(staffOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staffStudentDirectory(staffOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    // Admin-only services refuse the role outright.
    await expect(listStudents(staffOf(schoolA), {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listStaff(staffOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getStaff(staffOf(schoolA), staff.A.staffId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listMeetingsForAdmin(staffOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveMeeting(staffOf(schoolA), meeting())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveStaff(staffOf(schoolA), staffSchema.parse({ staffId: staff.A.staffId, employeeId: "NT-A", firstName: "S", lastName: "A", role: "OFFICE_STAFF", permissions: ["VIEW_STUDENTS"] }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resetPortalPassword(staffOf(schoolA), staff.A.userId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("opens exactly the modules the admin grants, within their own school", async () => {
    await saveStaff(
      adminOf(schoolA),
      staffSchema.parse({ staffId: staff.A.staffId, employeeId: "NT-A", firstName: "Sunita", lastName: "A", role: "OFFICE_STAFF", permissions: ["", "VIEW_STUDENTS"] }),
    );
    expect(await staffPermissions(staffOf(schoolA))).toEqual(["VIEW_STUDENTS"]);

    const directory = await staffStudentDirectory(staffOf(schoolA));
    expect(directory.rows.map((row) => row.admissionNumber).sort()).toEqual(["ADM1", "ADM2", "ADM3"]);
    expect(directory.rows[0]?.guardian?.phone).toBeTruthy();
    // No fee, mark or attendance data is carried.
    expect(Object.keys(directory.rows[0]!)).toEqual(["id", "name", "admissionNumber", "section", "rollNumber", "guardian"]);
    await expect(listBooks(staffOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    // School B's staff member holds nothing of A's grant.
    await expect(staffStudentDirectory(staffOf(schoolB))).rejects.toBeInstanceOf(ForbiddenError);

    // Saving without a permissions field (CSV/API style) leaves them alone…
    await saveStaff(adminOf(schoolA), staffSchema.parse({ staffId: staff.A.staffId, employeeId: "NT-A", firstName: "Sunita", lastName: "A", role: "OFFICE_STAFF" }));
    expect(await staffPermissions(staffOf(schoolA))).toEqual(["VIEW_STUDENTS"]);
    // …and the form's empty marker revokes them all.
    await saveStaff(adminOf(schoolA), staffSchema.parse({ staffId: staff.A.staffId, employeeId: "NT-A", firstName: "Sunita", lastName: "A", role: "OFFICE_STAFF", permissions: "" }));
    await expect(assertAdminOrStaffPermission(staffOf(schoolA), "VIEW_STUDENTS")).rejects.toBeInstanceOf(ForbiddenError);

    await saveStaff(adminOf(schoolA), staffSchema.parse({ staffId: staff.A.staffId, employeeId: "NT-A", firstName: "Sunita", lastName: "A", role: "OFFICE_STAFF", permissions: ["VIEW_LIBRARY", "VIEW_TRANSPORT"] }));
    await expect(listBooks(staffOf(schoolA))).resolves.toEqual([]);
    await expect(listRoutes(staffOf(schoolA))).resolves.toEqual([]);
  });

  it("signs out and locks the login while the staff member is inactive", async () => {
    const base = { staffId: staff.A.staffId, employeeId: "NT-A", firstName: "Sunita", lastName: "A", role: "OFFICE_STAFF" };
    const { token } = await createSession(staff.A.userId);
    await saveStaff(adminOf(schoolA), staffSchema.parse({ ...base, status: "INACTIVE" }));
    expect(await validateSessionToken(token)).toBeNull();
    expect(await authenticate(staff.A.email, staff.A.password)).toMatchObject({ ok: false, reason: "ACCOUNT_DISABLED" });
    expect(await staffPermissions(staffOf(schoolA))).toEqual([]);

    await saveStaff(adminOf(schoolA), staffSchema.parse({ ...base, status: "ACTIVE" }));
    expect(await authenticate(staff.A.email, staff.A.password)).toMatchObject({ ok: true });
  });

  it("lets the admin reset a staff password, but not another school's", async () => {
    await expect(resetPortalPassword(adminOf(schoolB), staff.A.userId)).rejects.toBeInstanceOf(NotFoundError);
    // The admin sends a reset link; the staff member chooses the new password.
    const invite = await resetPortalPassword(adminOf(schoolA), staff.A.userId);
    expect(invite.delivered).toBe(true);
    await redeemAccountLink(tokenFrom(staff.A.email, "reset-password"), "PASSWORD_RESET", "Reset-password-2", "Reset-password-2");
    expect(await authenticate(staff.A.email, "Reset-password-2")).toMatchObject({ ok: true });
    staff.A.password = "Reset-password-2";
  });

  it("sees whole-school notices for everyone or for staff, never class notices", async () => {
    const ctx = adminOf(schoolA);
    const forStaff = await saveNotice(ctx, noticeSchema.parse({ title: "Staff briefing", body: "Tea at 4.", audience: "NON_TEACHING_STAFF", status: "PUBLISHED" }));
    const forTeachers = await saveNotice(ctx, noticeSchema.parse({ title: "Teachers only", body: "Marks due.", audience: "TEACHERS", status: "PUBLISHED" }));
    const forSection = await saveNotice(ctx, noticeSchema.parse({ title: "10-A trip", body: "Bus at 8.", audience: "ALL", status: "PUBLISHED", scope: "SECTION", sectionId: schoolA.sectionId }));
    const seen = (await noticesFor(staffOf(schoolA))).map((row) => row.id);
    expect(seen).toContain(forStaff);
    expect(seen).not.toContain(forTeachers);
    expect(seen).not.toContain(forSection);
    expect((await noticesFor(teacherOf(schoolA))).map((row) => row.id)).not.toContain(forStaff);
    expect((await noticesFor(staffOf(schoolB))).map((row) => row.id)).not.toContain(forStaff);
    expect(() => noticeSchema.parse({ title: "x", body: "y", audience: "NON_TEACHING_STAFF", status: "PUBLISHED", scope: "SECTION", sectionId: schoolA.sectionId })).toThrow();
  });
});

// -----------------------------------------------------------------------------
// Meetings
// -----------------------------------------------------------------------------

describe("meeting audiences", () => {
  it("reaches exactly the groups chosen, school-wide", async () => {
    const admin = adminOf(schoolA);
    const families = await saveMeeting(admin, meeting({ title: "Families", audiences: ["PARENTS", "STUDENTS"] }));
    const teachers = await saveMeeting(admin, meeting({ title: "Teachers", audiences: ["TEACHERS"] }));
    const staffOnly = await saveMeeting(admin, meeting({ title: "Staff", audiences: ["NON_TEACHING_STAFF"] }));
    const everyone = await saveMeeting(admin, meeting({ title: "Everyone", audiences: ["PARENTS", "STUDENTS", "TEACHERS", "NON_TEACHING_STAFF"] }));

    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: everyone } })).audiences).toEqual(["ALL"]);
    const parent = await idsOf(parentOf(schoolA));
    const student = await idsOf(studentOf(schoolA));
    const teacher = await idsOf(teacherOf(schoolA));
    const member = await idsOf(staffOf(schoolA));

    expect(parent).toEqual(expect.arrayContaining([families, everyone]));
    expect(parent).not.toContain(teachers);
    expect(parent).not.toContain(staffOnly);
    expect(student).toEqual(expect.arrayContaining([families, everyone]));
    expect(teacher).toEqual(expect.arrayContaining([teachers, everyone]));
    expect(teacher).not.toContain(families);
    expect(teacher).not.toContain(staffOnly);
    expect(member).toEqual(expect.arrayContaining([staffOnly, everyone]));
    expect(member).not.toContain(families);
    expect(member).not.toContain(teachers);

    // Nobody in school B sees any of school A's meetings.
    for (const ctx of [parentOf(schoolB), studentOf(schoolB), teacherOf(schoolB), staffOf(schoolB), adminOf(schoolB)]) {
      const seen = ctx.user.role === "SCHOOL_ADMIN" ? (await listMeetingsForAdmin(ctx)).rows.map((row) => row.id) : await idsOf(ctx);
      expect(seen).not.toEqual(expect.arrayContaining([families]));
      for (const id of [families, teachers, staffOnly, everyone]) expect(seen).not.toContain(id);
    }
  });

  it("targets a section's families and teachers only", async () => {
    const admin = adminOf(schoolA);
    const mine = await saveMeeting(admin, meeting({ title: "10-A families", audiences: ["PARENTS", "TEACHERS"], scope: "SECTIONS", sectionIds: [schoolA.sectionId] }));
    const other = await saveMeeting(admin, meeting({ title: "Other section", audiences: ["PARENTS", "STUDENTS", "TEACHERS"], scope: "SECTIONS", sectionIds: [schoolA.unassignedSectionId] }));

    expect(await idsOf(parentOf(schoolA))).toContain(mine);
    expect(await idsOf(teacherOf(schoolA))).toContain(mine);
    // Students were not a chosen group.
    expect(await idsOf(studentOf(schoolA))).not.toContain(mine);
    // Nobody here has a child in, or teaches, the other section.
    for (const ctx of [parentOf(schoolA), studentOf(schoolA), teacherOf(schoolA)]) expect(await idsOf(ctx)).not.toContain(other);

    const detail = await getMeetingForAdmin(admin, mine);
    expect(detail.sectionIds).toEqual([schoolA.sectionId]);
    expect(detail.audience).toMatch(/Parents \+ Teachers/);
  });

  it("targets selected people: teachers, staff, and students or their guardians", async () => {
    const admin = adminOf(schoolA);
    const people = await saveMeeting(
      admin,
      meeting({ title: "Selected", audiences: ["TEACHERS", "NON_TEACHING_STAFF", "PARENTS"], scope: "PEOPLE", teacherIds: [schoolA.teacherId], staffIds: [staff.A.staffId], studentAdmissionNumbers: "adm2" }),
    );
    expect(await idsOf(teacherOf(schoolA))).toContain(people);
    expect(await idsOf(staffOf(schoolA))).toContain(people);
    // ADM2's guardian is invited; ADM1 (the student login) is not, and Students was not ticked.
    expect(await idsOf(parentOf(schoolA))).toContain(people);
    expect(await idsOf(studentOf(schoolA))).not.toContain(people);

    const detail = await getMeetingForAdmin(admin, people);
    expect(detail.teacherIds).toEqual([schoolA.teacherId]);
    expect(detail.staffIds).toEqual([staff.A.staffId]);
    expect(detail.admissionNumbers).toEqual(["ADM2"]);

    const student = await saveMeeting(admin, meeting({ title: "One student", audiences: ["STUDENTS"], scope: "PEOPLE", studentAdmissionNumbers: "ADM1" }));
    expect(await idsOf(studentOf(schoolA))).toContain(student);
    expect(await idsOf(parentOf(schoolA))).not.toContain(student);
  });

  it("refuses invalid or cross-school targets", async () => {
    const admin = adminOf(schoolA);
    const invalid = (overrides: Record<string, unknown>) => expect(saveMeeting(admin, meeting(overrides))).rejects.toBeInstanceOf(ValidationError);
    await invalid({ scope: "SECTIONS", sectionIds: [schoolB.sectionId] });
    await invalid({ audiences: ["TEACHERS"], scope: "PEOPLE", teacherIds: [schoolB.teacherId] });
    await invalid({ audiences: ["NON_TEACHING_STAFF"], scope: "PEOPLE", staffIds: [staff.B.staffId] });
    await invalid({ audiences: ["PARENTS"], scope: "PEOPLE", studentAdmissionNumbers: "NOPE1" });
    // A pick outside the ticked groups.
    await invalid({ audiences: ["PARENTS"], scope: "PEOPLE", teacherIds: [schoolA.teacherId] });
    // Staff are in no section.
    expect(() => meeting({ audiences: ["NON_TEACHING_STAFF"], scope: "SECTIONS", sectionIds: [schoolA.sectionId] })).toThrow();
    expect(() => meeting({ audiences: [] })).toThrow();
    // A teacher cannot call a meeting.
    await expect(saveMeeting(teacherOf(schoolA), meeting())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveMeeting(parentOf(schoolA), meeting())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("notifies invitees through their alert feeds", async () => {
    const admin = adminOf(schoolA);
    await saveMeeting(admin, meeting({ title: "Alert families", date: future(2), audiences: ["PARENTS"] }));
    await saveMeeting(admin, meeting({ title: "Alert staff", date: future(2), audiences: ["NON_TEACHING_STAFF"] }));
    expect((await getParentAlerts(parentOf(schoolA))).some((alert) => alert.kind === "meeting" && alert.title.includes("Alert families"))).toBe(true);
    const staffAlerts = await getStaffAlerts(staffOf(schoolA));
    expect(staffAlerts.some((alert) => alert.title.includes("Alert staff"))).toBe(true);
    expect(staffAlerts.some((alert) => alert.title.includes("Alert families"))).toBe(false);
    expect((await getParentAlerts(parentOf(schoolB))).some((alert) => alert.kind === "meeting")).toBe(false);
  });
});

describe("meeting times and status", () => {
  it("refuses an end before the start and a start already past", async () => {
    expect(() => meeting({ startMinute: "11:00", endMinute: "10:00" })).toThrow(/end after it starts/);
    expect(() => meeting({ startMinute: "11:00", endMinute: "11:00" })).toThrow();
    await expect(saveMeeting(adminOf(schoolA), meeting({ date: toDateInput(addDays(today(), -1)) }))).rejects.toBeInstanceOf(ValidationError);
    if (schoolNow().minutes > 0) {
      await expect(saveMeeting(adminOf(schoolA), meeting({ date: toDateInput(today()), startMinute: "00:00", endMinute: "" }))).rejects.toBeInstanceOf(ValidationError);
    }
    // Later today is fine, when there is a later today.
    if (schoolNow().minutes < 23 * 60 + 58) {
      await expect(saveMeeting(adminOf(schoolA), meeting({ date: toDateInput(today()), startMinute: "23:59", endMinute: "" }))).resolves.toBeTruthy();
    }
  });

  it("moves from UPCOMING to ONGOING to COMPLETED with the clock, and CANCELLED stays", () => {
    const day = today();
    const at = (minutes: number, date = day) => ({ date, minutes });
    const row = { status: "SCHEDULED" as const, date: day, startMinute: 600, endMinute: 660 };
    expect(meetingStatus(row, at(0, addDays(day, -1)))).toBe("UPCOMING");
    expect(meetingStatus(row, at(599))).toBe("UPCOMING");
    expect(meetingStatus(row, at(600))).toBe("ONGOING");
    expect(meetingStatus(row, at(660))).toBe("COMPLETED");
    expect(meetingStatus(row, at(0, addDays(day, 1)))).toBe("COMPLETED");
    // No end time: it runs to the end of its day.
    expect(meetingStatus({ ...row, endMinute: null }, at(1439))).toBe("ONGOING");
    expect(meetingStatus({ ...row, endMinute: null }, at(0, addDays(day, 1)))).toBe("COMPLETED");
    expect(meetingStatus({ ...row, status: "CANCELLED" }, at(0, addDays(day, 5)))).toBe("CANCELLED");
  });

  it("files stored meetings under the right status, and keeps past ones as history", async () => {
    const admin = adminOf(schoolA);
    const upcoming = await saveMeeting(admin, meeting({ title: "Status upcoming", audiences: ["PARENTS"] }));
    const past = await saveMeeting(admin, meeting({ title: "Status past", audiences: ["PARENTS"] }));
    const ongoing = await saveMeeting(admin, meeting({ title: "Status ongoing", audiences: ["PARENTS"] }));
    await prisma.meeting.update({ where: { id: past }, data: { date: addDays(today(), -3) } });
    const now = schoolNow().minutes;
    if (now > 0) await prisma.meeting.update({ where: { id: ongoing }, data: { date: today(), startMinute: 0, endMinute: null } });

    const byStatus = async (status: "UPCOMING" | "ONGOING" | "COMPLETED" | "CANCELLED") => (await listMeetingsForAdmin(admin, { status })).rows.map((row) => row.id);
    expect(await byStatus("UPCOMING")).toContain(upcoming);
    expect(await byStatus("COMPLETED")).toContain(past);
    expect(await byStatus("UPCOMING")).not.toContain(past);
    if (now > 0) expect(await byStatus("ONGOING")).toContain(ongoing);

    const mine = await myMeetings(parentOf(schoolA));
    expect(mine.past.map((row) => row.id)).toContain(past);
    expect(mine.upcoming.map((row) => row.id)).toContain(upcoming);
    expect(mine.past.find((row) => row.id === past)?.timeStatus).toBe("COMPLETED");

    // A held meeting cannot be edited or cancelled — but the School Admin may delete it.
    await expect(saveMeeting(admin, meeting({ meetingId: past }))).rejects.toBeInstanceOf(ConflictError);
    await expect(cancelMeeting(admin, { meetingId: past, reason: null })).rejects.toBeInstanceOf(ConflictError);
    expect(await getMeetingForAdmin(admin, past)).toMatchObject({ canEdit: false, canDelete: true });
    await deleteMeeting(admin, past);
    expect(await prisma.meeting.count({ where: { id: past } })).toBe(0);
    expect((await myMeetings(parentOf(schoolA))).past.map((row) => row.id)).not.toContain(past);
  });

  it("creates, edits, cancels, reschedules and deletes a meeting", async () => {
    const admin = adminOf(schoolA);
    // An upcoming meeting can be deleted straight away.
    const direct = await saveMeeting(admin, meeting({ title: "Delete me", audiences: ["PARENTS"] }));
    await deleteMeeting(admin, direct);
    expect(await prisma.meeting.count({ where: { id: direct } })).toBe(0);

    const id = await saveMeeting(admin, meeting({ title: "To cancel", audiences: ["PARENTS"] }));
    await saveMeeting(admin, meeting({ meetingId: id, title: "Renamed", audiences: ["PARENTS"], location: "Hall" }));
    expect((await getMeetingForAdmin(admin, id)).title).toBe("Renamed");

    await cancelMeeting(admin, { meetingId: id, reason: "Rain" });
    await expect(cancelMeeting(admin, { meetingId: id, reason: null })).rejects.toBeInstanceOf(ConflictError);

    // A cancelled meeting can be rescheduled: saving it makes it active again.
    const resched = await saveMeeting(admin, meeting({ title: "Resched", audiences: ["PARENTS"] }));
    await cancelMeeting(admin, { meetingId: resched, reason: "Clash" });
    await saveMeeting(admin, meeting({ meetingId: resched, title: "Resched", audiences: ["PARENTS"], date: toDateInput(addDays(today(), 5)) }));
    expect(await getMeetingForAdmin(admin, resched)).toMatchObject({ timeStatus: "UPCOMING", cancelReason: null });

    // Invitees still see it, marked cancelled — even once its date has passed.
    const seen = (await myMeetings(parentOf(schoolA))).upcoming.find((row) => row.id === id);
    expect(seen).toMatchObject({ timeStatus: "CANCELLED", cancelReason: "Rain" });
    await prisma.meeting.update({ where: { id }, data: { date: addDays(today(), -2) } });
    expect((await getMeetingForAdmin(admin, id)).timeStatus).toBe("CANCELLED");

    // Another school's admin cannot touch it by id.
    await expect(getMeetingForAdmin(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelMeeting(adminOf(schoolB), { meetingId: id, reason: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteMeeting(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveMeeting(adminOf(schoolB), meeting({ meetingId: id }))).rejects.toBeInstanceOf(NotFoundError);

    await deleteMeeting(admin, id);
    expect(await prisma.meeting.count({ where: { id } })).toBe(0);
  });

  it("cannot link a meeting to another school's rows even bypassing the service", async () => {
    const id = await saveMeeting(adminOf(schoolA), meeting({ title: "Raw link" }));
    await expect(prisma.meetingSection.create({ data: { schoolId: schoolA.schoolId, meetingId: id, sectionId: schoolB.sectionId } })).rejects.toThrow();
    await expect(prisma.meetingRecipient.create({ data: { schoolId: schoolA.schoolId, meetingId: id, userId: schoolB.teacherUserId } })).rejects.toThrow();
    await expect(prisma.meetingStudent.create({ data: { schoolId: schoolA.schoolId, meetingId: id, studentId: schoolB.studentIds[0]! } })).rejects.toThrow();
  });
});
