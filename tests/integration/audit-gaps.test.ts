/**
 * Gaps found by the September 2026 audit, closed and pinned down here.
 *
 *   * Cross-school access for records no other suite reached: events, notice
 *     writes, staff attendance, remarks, portal logins and API tokens.
 *   * A scoped write can never move a row to another school.
 *   * The School Admin reports and CSV exports describe only the caller's
 *     school, and are closed to everyone else.
 *   * Parent alerts now cover new homework, fees falling due and holidays.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { eventSchema, noticeSchema } from "@/lib/validation/communication";
import { markStaffAttendance } from "@/server/attendance/service";
import { createApiToken, listApiTokens, revokeApiToken } from "@/server/auth/api-token";
import { saveHoliday } from "@/server/calendar/holidays";
import { addRemark } from "@/server/classwork/remarks";
import { createHomework } from "@/server/classwork/homework";
import { deleteEvent, getEvent, saveEvent } from "@/server/communication/events";
import { deleteNotice, getNotice, saveNotice } from "@/server/communication/notices";
import { prisma } from "@/server/db/prisma";
import { chargeStudent, createFeeHead, listFeeHeads, suggestReceiptNo } from "@/server/finance/fees";
import { getParentAlerts } from "@/server/parent/alerts";
import { resetPortalPassword, setPortalUserActive } from "@/server/people/accounts";
import { listStudents } from "@/server/people/students";
import {
  classStrengthReport,
  feePositionsTable,
  staffAttendanceReport,
  studentListReport,
  teacherListReport,
} from "@/server/reports/exports";
import { forSchool } from "@/server/tenancy/scope";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("the tenant scope refuses to move rows between schools", () => {
  it("rejects an update that sets another schoolId, and leaves the row where it was", async () => {
    const db = forSchool(schoolA.schoolId);
    await expect(
      db.student.updateMany({ where: { id: schoolA.studentIds[0]! }, data: { schoolId: schoolB.schoolId } }),
    ).rejects.toThrow(/cannot move between schools/);
    await expect(
      db.student.update({ where: { id: schoolA.studentIds[0]! }, data: { schoolId: schoolB.schoolId } }),
    ).rejects.toThrow(/cannot move between schools/);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: schoolA.studentIds[0]! } })).schoolId).toBe(
      schoolA.schoolId,
    );
    // Restating its own school is harmless.
    await expect(
      db.student.updateMany({ where: { id: schoolA.studentIds[0]! }, data: { schoolId: schoolA.schoolId } }),
    ).resolves.toMatchObject({ count: 1 });
  });
});

describe("cross-school access to records no other suite covered", () => {
  it("events: another school's admin cannot read, edit or delete them", async () => {
    const id = await saveEvent(adminOf(schoolA), eventSchema.parse({ title: "Sports day", date: "2099-01-10" }));
    await expect(getEvent(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveEvent(adminOf(schoolB), { ...eventSchema.parse({ title: "Hijack", date: "2099-01-10" }), eventId: id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteEvent(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getEvent(adminOf(schoolA), id)).title).toBe("Sports day");
  });

  it("notices: another school's admin cannot edit or delete them", async () => {
    const id = await saveNotice(
      adminOf(schoolA),
      noticeSchema.parse({ title: "Exams", body: "From Monday", audience: "ALL", status: "PUBLISHED" }),
    );
    await expect(
      saveNotice(adminOf(schoolB), {
        ...noticeSchema.parse({ title: "Hijack", body: "x", audience: "ALL", status: "PUBLISHED" }),
        noticeId: id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteNotice(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getNotice(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getNotice(adminOf(schoolA), id)).title).toBe("Exams");
  });

  it("staff attendance: a register cannot include another school's teacher", async () => {
    await expect(
      markStaffAttendance(adminOf(schoolA), {
        date: today(),
        entries: [{ teacherId: schoolB.teacherId, status: "ABSENT", remarks: null }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.teacherAttendance.count({ where: { teacherId: schoolB.teacherId, date: today() } })).toBe(0);
  });

  it("remarks: none about another school's child, and none under a subject the teacher does not teach", async () => {
    const note = { understanding: "GOOD" as const, homeworkHabit: null, participation: null, note: null };
    await expect(
      addRemark(teacherOf(schoolA), { ...note, studentId: schoolB.studentIds[0]!, subjectId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const art = await prisma.subject.create({ data: { schoolId: schoolA.schoolId, name: "Art", code: "ART" } });
    await expect(
      addRemark(teacherOf(schoolA), { ...note, studentId: schoolA.studentIds[0]!, subjectId: art.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Another school's subject id is refused the same way.
    await expect(
      addRemark(teacherOf(schoolA), { ...note, studentId: schoolA.studentIds[0]!, subjectId: schoolB.subjectId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Their own subject is fine.
    await expect(
      addRemark(teacherOf(schoolA), { ...note, studentId: schoolA.studentIds[0]!, subjectId: schoolA.subjectId }),
    ).resolves.toHaveProperty("id");
  });

  it("portal logins: another school's admin cannot reset or disable them", async () => {
    await expect(resetPortalPassword(adminOf(schoolB), schoolA.teacherUserId)).rejects.toBeInstanceOf(NotFoundError);
    await setPortalUserActive(adminOf(schoolB), schoolA.parentUserId, false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: schoolA.parentUserId } })).isActive).toBe(true);
  });

  it("API tokens: one school's admin can neither see nor revoke another's", async () => {
    const { id } = await createApiToken(adminOf(schoolA).user, { name: "A export", scope: "READ", expiresAt: null });
    expect((await listApiTokens(adminOf(schoolB).user)).map((token) => token.id)).not.toContain(id);
    await expect(revokeApiToken(adminOf(schoolB).user, id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.apiToken.findUniqueOrThrow({ where: { id } })).revokedAt).toBeNull();
  });

  it("finance reads that had no role check now refuse non-admins", async () => {
    await expect(listFeeHeads(parentOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(suggestReceiptNo(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("reports and exports", () => {
  it("lists only the caller's own school", async () => {
    const students = await studentListReport(adminOf(schoolA));
    const names = students.rows.map((row) => String(row[1]));
    expect(names.length).toBe(schoolA.studentIds.length);
    // Fixture students are surnamed after their school.
    expect(names.every((name) => name.endsWith(" A"))).toBe(true);

    const teachers = await teacherListReport(adminOf(schoolB));
    expect(teachers.rows.every((row) => String(row[1]).length > 0)).toBe(true);
    expect(teachers.rows).toHaveLength(await prisma.teacher.count({ where: { schoolId: schoolB.schoolId } }));

    const strength = await classStrengthReport(adminOf(schoolA));
    expect(strength.totals.total).toBe(schoolA.studentIds.length);
    expect(strength.totals.boys + strength.totals.girls + strength.totals.other).toBe(strength.totals.total);

    const staff = await staffAttendanceReport(adminOf(schoolA), addDays(today(), -30), today());
    expect(staff.map((row) => row.id)).not.toContain(schoolB.teacherId);
  });

  it("closes every report to teachers and parents", async () => {
    await expect(studentListReport(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(classStrengthReport(parentOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(feePositionsTable(parentOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("filters the student list by gender", async () => {
    const boys = await listStudents(adminOf(schoolA), { gender: "MALE", status: "ACTIVE" });
    const expected = await prisma.student.count({ where: { schoolId: schoolA.schoolId, gender: "MALE", status: "ACTIVE" } });
    expect(boys.total).toBe(expected);
    expect(boys.total).toBeLessThan(schoolA.studentIds.length);
  });
});

describe("parent alerts", () => {
  it("announce new homework, overdue fees and an upcoming holiday", async () => {
    await createHomework(teacherOf(schoolA), {
      sectionId: schoolA.sectionId,
      subjectId: schoolA.subjectId,
      title: "Essay on monsoon",
      description: null,
      assignedOn: today(),
      dueOn: addDays(today(), 6),
      status: "PUBLISHED",
    });

    const head = await createFeeHead(adminOf(schoolA), { name: "Tuition", note: null });
    // Charged against a past due date directly, the way a carried-over balance would be.
    await chargeStudent(adminOf(schoolA), {
      studentId: schoolA.studentIds[0]!,
      feeHeadId: head.id,
      amountMinor: 500_000,
      dueOn: addDays(today(), -3),
      notes: null,
    });

    await saveHoliday(adminOf(schoolA), {
      holidayId: null,
      title: "Dussehra",
      description: null,
      startDate: addDays(today(), 5),
      endDate: addDays(today(), 5),
      clearAttendance: false,
    });

    const alerts = await getParentAlerts(parentOf(schoolA));
    expect(alerts.some((a) => a.kind === "new-homework" && a.title.includes("Essay on monsoon"))).toBe(true);
    const fee = alerts.find((a) => a.kind === "fee-due" && a.childId === schoolA.studentIds[0]);
    expect(fee?.title).toContain("overdue");
    expect(fee?.tone).toBe("warning");
    expect(alerts.some((a) => a.kind === "holiday" && a.title.includes("Dussehra"))).toBe(true);

    // School B's parent hears nothing of it.
    const other = await getParentAlerts(parentOf(schoolB));
    expect(other.some((a) => a.title.includes("Dussehra") || a.title.includes("Essay on monsoon"))).toBe(false);
    expect(other.some((a) => a.kind === "fee-due")).toBe(false);
  });

  it("is refused to a non-parent", async () => {
    await expect(getParentAlerts(teacherOf(schoolA))).rejects.toBeInstanceOf(AppError);
  });
});
