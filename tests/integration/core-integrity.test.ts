/**
 * Data-integrity fixes from the October audit:
 *
 *   * a fee correction never silently deletes a concession, and charging a
 *     class again never undoes a child's corrected amount;
 *   * students on long leave stay on the attendance register;
 *   * a student who returns takes a seat again (a full section refuses);
 *   * a student keeps at least one guardian; the primary passes on;
 *   * the student search finds a full name; the CSV keeps the gender filter;
 *   * class strength counts students on leave and lists empty classes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ConflictError } from "@/lib/errors";
import { getRegister } from "@/server/attendance/register";
import { prisma } from "@/server/db/prisma";
import { grantConcession } from "@/server/finance/concessions";
import { chargeSection, chargeStudent, createFeeHead } from "@/server/finance/fees";
import { changeStudentStatus } from "@/server/people/lifecycle";
import { listStudents, unlinkGuardian } from "@/server/people/students";
import { classStrengthReport, studentListReport } from "@/server/reports/exports";

import { adminOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
const due = (days: number) => addDays(today(), days);
const options = { effectiveDate: today(), reason: null, remarks: null, confirmReturn: true };

beforeAll(async () => {
  ({ schoolA } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("fees", () => {
  it("re-raising a head with fewer instalments is refused when a dropped instalment carries a concession", async () => {
    const admin = adminOf(schoolA);
    const head = await createFeeHead(admin, { name: "Integrity tuition", note: null });
    const studentId = schoolA.studentIds[0]!;
    await chargeStudent(admin, { studentId, feeHeadId: head.id, amountMinor: 30_000_00, dueOn: due(10), notes: null, installments: [due(10), due(40), due(70)] });
    const third = await prisma.feeCharge.findFirstOrThrow({ where: { studentId, feeHeadId: head.id, installmentNo: 3 } });
    await grantConcession(admin, { chargeId: third.id, kind: "FIXED", amountRupees: 1000, reason: "Sibling" });
    await expect(chargeStudent(admin, { studentId, feeHeadId: head.id, amountMinor: 30_000_00, dueOn: due(10), notes: null, installments: [due(10), due(40)] })).rejects.toThrow(/has a concession/);
    // Nothing changed: three instalments, the concession still there.
    expect(await prisma.feeCharge.count({ where: { studentId, feeHeadId: head.id } })).toBe(3);
    expect(await prisma.feeConcession.count({ where: { feeChargeId: third.id } })).toBe(1);
  });

  it("charging a class again leaves children who already have the head (and their corrections) alone", async () => {
    const admin = adminOf(schoolA);
    const head = await createFeeHead(admin, { name: "Integrity transport", note: null });
    const corrected = schoolA.studentIds[1]!;
    await chargeStudent(admin, { studentId: corrected, feeHeadId: head.id, amountMinor: 500_00, dueOn: due(5), notes: "Half route" });
    const { charged, skipped } = await chargeSection(admin, { sectionId: schoolA.sectionId, feeHeadId: head.id, amountMinor: 1_000_00, dueOn: due(5) });
    expect(skipped).toBe(1);
    expect(charged).toBe(schoolA.studentIds.length - 1);
    expect((await prisma.feeCharge.findFirstOrThrow({ where: { studentId: corrected, feeHeadId: head.id } })).amountMinor).toBe(500_00);
  });
});

describe("students and attendance", () => {
  it("a student on long leave stays on the register, shown as on leave", async () => {
    const admin = adminOf(schoolA);
    const studentId = schoolA.studentIds[2]!;
    await changeStudentStatus(admin, studentId, "ON_LEAVE", options);
    const register = await getRegister(admin, schoolA.sectionId, today());
    const row = register.rows.find((entry) => entry.studentId === studentId);
    expect(row?.leave).toMatch(/long leave/);
    await changeStudentStatus(admin, studentId, "ACTIVE", options);
  });

  it("a student who left cannot come back into a full section", async () => {
    const admin = adminOf(schoolA);
    const studentId = schoolA.studentIds[1]!;
    await changeStudentStatus(admin, studentId, "WITHDRAWN", { ...options, reason: "Moved city" });
    const active = await prisma.studentEnrollment.count({ where: { sectionId: schoolA.sectionId, status: "ACTIVE" } });
    await prisma.section.update({ where: { id: schoolA.sectionId }, data: { capacity: active } });
    await expect(changeStudentStatus(admin, studentId, "ACTIVE", options)).rejects.toBeInstanceOf(ConflictError);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).status).toBe("WITHDRAWN");
    await prisma.section.update({ where: { id: schoolA.sectionId }, data: { capacity: null } });
    await changeStudentStatus(admin, studentId, "ACTIVE", options);
    expect((await prisma.studentEnrollment.findFirstOrThrow({ where: { studentId, sectionId: schoolA.sectionId } })).status).toBe("ACTIVE");
  });

  it("the last guardian cannot be removed; removing the primary passes it on", async () => {
    const admin = adminOf(schoolA);
    const studentId = schoolA.studentIds[0]!;
    const only = await prisma.parentStudent.findFirstOrThrow({ where: { studentId } });
    await expect(unlinkGuardian(admin, only.id)).rejects.toThrow(/at least one parent or guardian/);

    const second = await prisma.parent.create({ data: { schoolId: schoolA.schoolId, firstName: "Second", lastName: "Guardian", phone: "+91 9000011111" } });
    await prisma.parentStudent.create({ data: { schoolId: schoolA.schoolId, parentId: second.id, studentId, relationship: "MOTHER", isPrimary: false } });
    await unlinkGuardian(admin, only.id);
    const left = await prisma.parentStudent.findMany({ where: { studentId } });
    expect(left).toEqual([expect.objectContaining({ parentId: second.id, isPrimary: true })]);
    // Put the fixture back as it was.
    await prisma.parentStudent.create({ data: { schoolId: schoolA.schoolId, parentId: schoolA.parentId, studentId, relationship: "GUARDIAN", isPrimary: true } });
    await prisma.parentStudent.deleteMany({ where: { parentId: second.id } });
    await prisma.parent.delete({ where: { id: second.id } });
  });

  it("the search finds a full name, and the CSV keeps the gender filter", async () => {
    const admin = adminOf(schoolA);
    const student = await prisma.student.findUniqueOrThrow({ where: { id: schoolA.studentIds[0]! } });
    const found = await listStudents(admin, { q: `${student.firstName} ${student.lastName}`, status: "CURRENT" });
    expect(found.rows.map((row) => row.id)).toContain(student.id);
    const boys = await studentListReport(admin, { gender: "MALE" });
    const girls = await studentListReport(admin, { gender: "FEMALE" });
    expect(boys.rows.length + girls.rows.length).toBe(schoolA.studentIds.length);
    expect(boys.rows.length).toBeGreaterThan(0);
  });

  it("class strength counts students on leave and lists empty classes", async () => {
    const admin = adminOf(schoolA);
    const empty = await prisma.class.create({ data: { schoolId: schoolA.schoolId, name: "Integrity Class 12", level: 1200 } });
    await changeStudentStatus(admin, schoolA.studentIds[2]!, "ON_LEAVE", options);
    const report = await classStrengthReport(admin);
    expect(report.totals.total).toBe(schoolA.studentIds.length);
    expect(report.rows.find((row) => row.name === "Integrity Class 12")).toMatchObject({ total: 0 });
    await changeStudentStatus(admin, schoolA.studentIds[2]!, "ACTIVE", options);
    await prisma.class.delete({ where: { id: empty.id } });
  });
});

describe("attendance and homework signals", () => {
  it("flags low attendance and a teacher's homework remark, with the reason in words, only within scope", async () => {
    const admin = adminOf(schoolA);
    const studentId = schoolA.studentIds[1]!;
    const sessionId = schoolA.academicSessionId;
    // Five more marked days for this student (plus the fixture's one present day): 4 absent, 1 leave, 1 present.
    for (const [back, status] of [[4, "ABSENT"], [5, "ABSENT"], [6, "ABSENT"], [7, "ABSENT"], [8, "EXCUSED"], [9, "PRESENT"]] as const) {
      await prisma.studentAttendance.upsert({
        where: { schoolId_studentId_date: { schoolId: schoolA.schoolId, studentId, date: addDays(today(), -back) } },
        create: { schoolId: schoolA.schoolId, academicSessionId: sessionId, studentId, sectionId: schoolA.sectionId, date: addDays(today(), -back), status, markedByUserId: schoolA.adminUserId },
        update: { status },
      });
    }
    await prisma.studentRemark.create({ data: { schoolId: schoolA.schoolId, academicSessionId: sessionId, studentId: schoolA.studentIds[0]!, teacherId: schoolA.teacherId, homeworkHabit: "FREQUENTLY_MISSING" } });

    const { attendanceHomeworkSignals, attentionByClass } = await import("@/server/exams/student-signals");
    const { rows } = await attendanceHomeworkSignals(admin);
    const low = rows.find((row) => row.studentId === studentId);
    // Present 2 of 6 counted days (leave not counted) = 33%.
    expect(low?.reasons[0]?.text).toMatch(/Attendance 33% over the last 30 days — 4 absent out of 6 marked days/);
    expect(rows.find((row) => row.studentId === schoolA.studentIds[0])?.reasons.map((reason) => reason.code)).toContain("HOMEWORK");

    // The class teacher sees them; a parent or student sees nothing.
    const { teacherOf, contextFor } = await import("../helpers/context");
    expect((await attendanceHomeworkSignals(teacherOf(schoolA))).rows.map((row) => row.studentId)).toContain(studentId);
    expect((await attendanceHomeworkSignals(contextFor(schoolA, schoolA.parentUserId, "PARENT"))).rows).toEqual([]);
    // Asking for a section the teacher does not teach returns nothing.
    expect((await attendanceHomeworkSignals(teacherOf(schoolA), { sectionId: schoolA.unassignedSectionId })).rows).toEqual([]);

    const byClass = await attentionByClass(admin);
    expect(byClass.find((row) => row.sectionId === schoolA.sectionId)).toMatchObject({ attendance: 1, homework: 1 });
  });
});

describe("daily collection", () => {
  it("totals today's non-void payments by method and by who took them", async () => {
    const admin = adminOf(schoolA);
    const { recordPayment, voidPayment } = await import("@/server/finance/fees");
    const { dailyCollection } = await import("@/server/finance/fee-reports");
    const before = await dailyCollection(admin);
    const studentId = schoolA.studentIds[0]!;
    await recordPayment(admin, { studentId, amountMinor: 1_000_00, paidOn: today(), method: "CASH", receiptNo: "DC-1", referenceNo: null, notes: null } as never);
    await recordPayment(admin, { studentId, amountMinor: 500_00, paidOn: today(), method: "UPI", receiptNo: "DC-2", referenceNo: "UTR1", notes: null } as never);
    const third = await recordPayment(admin, { studentId, amountMinor: 200_00, paidOn: today(), method: "CASH", receiptNo: "DC-3", referenceNo: null, notes: null } as never);
    await voidPayment(admin, third.id, "Entered twice");
    const after = await dailyCollection(admin);
    expect(after.totalMinor - before.totalMinor).toBe(1_500_00);
    expect(after.receipts - before.receipts).toBe(2);
    expect(after.voided - before.voided).toBe(1);
    expect(after.byMethod.find((row) => row.method === "UPI")?.amountMinor).toBeGreaterThanOrEqual(500_00);
    // A teacher has no fee permission.
    const { teacherOf } = await import("../helpers/context");
    await expect(dailyCollection(teacherOf(schoolA))).rejects.toThrow();
  });
});
