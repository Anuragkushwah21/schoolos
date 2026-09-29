/**
 * Payroll, complaints, the school audit log and room
 * clashes in the timetable.
 *
 * For each: the business rule on the server, the roles that may and may not
 * act, and that nothing crosses from one school to another.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, dateOnly, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { listSchoolAudit } from "@/server/audit/school";
import { handleComplaint, bulkComplaintStatus, getComplaint, listComplaints, raiseComplaint } from "@/server/communication/complaints";
import { prisma } from "@/server/db/prisma";
import { getPayroll, payPayroll } from "@/server/finance/payroll";
import { setSalary } from "@/server/finance/salary";
import { createSlot } from "@/server/timetable/service";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");
const thisMonth = () => dateOnly(today().getUTCFullYear(), today().getUTCMonth() + 1, 1);

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("payroll", () => {
  beforeAll(async () => {
    await setSalary(adminOf(schoolA), {
      teacherId: schoolA.teacherId,
      salaryType: "MONTHLY",
      amountMinor: 3_000_000,
      allowancesMinor: 200_000,
      deductionsMinor: 100_000,
      effectiveFrom: addDays(thisMonth(), -40),
      notes: null,
    });
  });

  it("works out what is due from the salary structure", async () => {
    const payroll = await getPayroll(adminOf(schoolA), thisMonth());
    const row = payroll.rows.find((item) => item.teacherId === schoolA.teacherId);
    expect(row?.dueMinor).toBe(3_100_000);
    expect(row?.payment).toBeNull();
    expect((await getPayroll(adminOf(schoolB), thisMonth())).rows.map((item) => item.teacherId)).not.toContain(schoolA.teacherId);
  });

  it("pays a batch once, with adjusted amounts, and never twice", async () => {
    const input = {
      month: thisMonth(),
      paidOn: today(),
      method: "BANK_TRANSFER" as const,
      reference: "NEFT-1",
      entries: [{ teacherId: schoolA.teacherId, amountMinor: 3_050_000 }],
    };
    await expect(payPayroll(adminOf(schoolA), { ...input, paidOn: addDays(today(), 1) })).rejects.toBeInstanceOf(AppError);
    await payPayroll(adminOf(schoolA), input);
    expect((await getPayroll(adminOf(schoolA), thisMonth())).rows.find((row) => row.teacherId === schoolA.teacherId)?.payment?.amountMinor).toBe(
      3_050_000,
    );
    await expect(payPayroll(adminOf(schoolA), input)).rejects.toBeInstanceOf(ConflictError);
  });

  it("is School Admin only and cannot pay another school's teacher", async () => {
    const input = { month: thisMonth(), paidOn: today(), method: "CASH" as const, reference: null, entries: [{ teacherId: schoolA.teacherId, amountMinor: 1 }] };
    await expect(getPayroll(teacherOf(schoolA), thisMonth())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payPayroll(parentOf(schoolA), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payPayroll(adminOf(schoolB), input)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("complaints", () => {
  let complaintId: string;

  it("lets a parent raise one about their own child only", async () => {
    const input = { category: "TRANSPORT" as const, priority: "HIGH" as const, subject: "Bus late", description: "Every morning", studentId: schoolA.studentIds[0]! };
    complaintId = (await raiseComplaint(parentOf(schoolA), input)).id;
    await expect(raiseComplaint(parentOf(schoolA), { ...input, studentId: schoolB.studentIds[0]! })).rejects.toBeInstanceOf(NotFoundError);
    await expect(raiseComplaint(teacherOf(schoolA), { ...input, studentId: null })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows it to the office and its raiser, and to a teacher only once assigned", async () => {
    expect((await listComplaints(adminOf(schoolA))).map((row) => row.id)).toContain(complaintId);
    expect((await listComplaints(teacherOf(schoolA))).map((row) => row.id)).not.toContain(complaintId);
    await expect(getComplaint(teacherOf(schoolA), complaintId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getComplaint(studentOf(schoolA), complaintId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getComplaint(adminOf(schoolB), complaintId)).rejects.toBeInstanceOf(NotFoundError);

    await handleComplaint(adminOf(schoolA), { complaintId, status: "IN_PROGRESS", assignedToId: schoolA.teacherUserId, response: null });
    expect((await getComplaint(teacherOf(schoolA), complaintId)).status).toBe("IN_PROGRESS");

    // The teacher responds but cannot reassign.
    await expect(
      handleComplaint(teacherOf(schoolA), { complaintId, status: "RESOLVED", assignedToId: schoolA.adminUserId, response: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await handleComplaint(teacherOf(schoolA), { complaintId, status: "RESOLVED", assignedToId: schoolA.teacherUserId, response: "Route changed" });
    const seen = await getComplaint(parentOf(schoolA), complaintId);
    expect(seen.response).toBe("Route changed");
    expect(seen.resolvedAt).not.toBeNull();
  });

  it("assigns only this school's staff, and bulk updates stay in the school", async () => {
    await expect(
      handleComplaint(adminOf(schoolA), { complaintId, status: "OPEN", assignedToId: schoolB.teacherUserId, response: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      handleComplaint(adminOf(schoolA), { complaintId, status: "OPEN", assignedToId: schoolA.parentUserId, response: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(bulkComplaintStatus(adminOf(schoolB), { complaintIds: [complaintId], status: "CLOSED" })).rejects.toBeInstanceOf(NotFoundError);
    await bulkComplaintStatus(adminOf(schoolA), { complaintIds: [complaintId], status: "CLOSED" });
    expect((await getComplaint(adminOf(schoolA), complaintId)).status).toBe("CLOSED");
  });
});

describe("school audit log", () => {
  it("shows the school its own entries only, to the School Admin only", async () => {
    const mine = await listSchoolAudit(adminOf(schoolA), { area: "COMMUNICATION" });
    expect(mine.rows.some((row) => row.action === "COMPLAINT_RAISED")).toBe(true);
    // The complaint's text never reaches the log.
    expect(mine.rows.every((row) => !row.summary.includes("Every morning"))).toBe(true);
    const theirs = await listSchoolAudit(adminOf(schoolB), {});
    expect(theirs.rows.some((row) => row.action === "COMPLAINT_RAISED")).toBe(false);
    await expect(listSchoolAudit(teacherOf(schoolA), {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("timetable rooms", () => {
  it("refuses two classes in one room at the same time", async () => {
    const subjectB = await prisma.subject.create({ data: { schoolId: schoolA.schoolId, name: "Art", code: "ART" } });
    const other = await prisma.user.create({
      data: { email: "room-teacher@iso-test-a.test", passwordHash: "x", role: "TEACHER", firstName: "Room", lastName: "Teacher", schoolId: schoolA.schoolId },
    });
    const otherTeacher = await prisma.teacher.create({
      data: { schoolId: schoolA.schoolId, userId: other.id, employeeId: "ROOM1", firstName: "Room", lastName: "Teacher" },
    });
    await createSlot(adminOf(schoolA), {
      sectionId: schoolA.sectionId,
      subjectId: schoolA.subjectId,
      teacherId: schoolA.teacherId,
      dayOfWeek: "TUESDAY",
      startMinute: 600,
      endMinute: 645,
      room: "Lab 1",
    });
    await expect(
      createSlot(adminOf(schoolA), {
        sectionId: schoolA.unassignedSectionId,
        subjectId: subjectB.id,
        teacherId: otherTeacher.id,
        dayOfWeek: "TUESDAY",
        startMinute: 620,
        endMinute: 665,
        room: " lab 1 ",
      }),
    ).rejects.toThrow(/Room Lab 1|Room lab 1/);
    // A different room at the same time is fine.
    await createSlot(adminOf(schoolA), {
      sectionId: schoolA.unassignedSectionId,
      subjectId: subjectB.id,
      teacherId: otherTeacher.id,
      dayOfWeek: "TUESDAY",
      startMinute: 620,
      endMinute: 665,
      room: "Lab 2",
    });
  });
});
