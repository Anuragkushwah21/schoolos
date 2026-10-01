/**
 * The daily register workflow and cover for absent people.
 *
 *   * Draft → submitted: drafts never reach StudentAttendance; an AUTO draft
 *     submits itself on the server when its period ends.
 *   * Correction window: min(submitted + 2 h, 23:59:59 that day), IST —
 *     a teacher corrects inside it with a reason, never after; the School
 *     Admin at any time.
 *   * Register cover: a teacher the admin assigns takes that class's register
 *     on that day only, and sees it on their dashboard.
 *   * Staff work cover: an absent staff member's work shows on the
 *     colleague's dashboard; both are kept as history.
 *   * Nothing crosses schools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dateOnly, schoolInstant, today } from "@/lib/dates";
import {
  assignRegisterCover,
  assignWorkCover,
  myRegistersToday,
  myWorkCoversToday,
  registerHistory,
  removeRegisterCover,
  workCoverHistory,
} from "@/server/attendance/cover";
import {
  correctionDeadlineFor,
  finalizeDueRegisters,
  getRegister,
  markAttendance,
  registerPhase,
  saveRegisterDraft,
} from "@/server/attendance/register";
import { attendanceSectionIds } from "@/server/auth/teacher-access";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let other: { id: string; ctx: TenantContext };

async function addTeacher(school: SeededSchool, key: string) {
  const user = await prisma.user.create({
    data: { email: `${key}@iso-test-a.test`, passwordHash: "not-a-real-hash", role: "TEACHER", firstName: key, lastName: "Teacher", schoolId: school.schoolId },
  });
  const teacher = await prisma.teacher.create({
    data: { schoolId: school.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Teacher" },
  });
  return { id: teacher.id, ctx: contextFor(school, user.id, "TEACHER") };
}

const mark = (school: SeededSchool, status: "PRESENT" | "ABSENT" = "PRESENT") =>
  school.studentIds.map((studentId) => ({ studentId, status, remarks: null }));

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  other = await addTeacher(schoolA, "stand-in");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("the correction deadline", () => {
  const day = dateOnly(2026, 9, 28);

  it("is two hours after submission, on the school's clock", () => {
    const submitted = schoolInstant(day, 9 * 60); // 9:00 am IST
    expect(submitted.toISOString()).toBe("2026-09-28T03:30:00.000Z");
    expect(correctionDeadlineFor(submitted, day).toISOString()).toBe(schoolInstant(day, 11 * 60).toISOString());
  });

  it("never crosses midnight", () => {
    const late = schoolInstant(day, 23 * 60 + 30); // 11:30 pm IST
    const deadline = correctionDeadlineFor(late, day);
    expect(deadline.toISOString()).toBe("2026-09-28T18:29:59.000Z"); // 11:59:59 pm IST, not 1:30 am
  });

  it("decides the phase from the stored deadline", () => {
    const submitted = schoolInstant(day, 9 * 60);
    const register = { status: "SUBMITTED" as const, submittedAt: submitted, correctionDeadline: correctionDeadlineFor(submitted, day), finalizeAt: null };
    expect(registerPhase(register, null, day, schoolInstant(day, 10 * 60)).phase).toBe("CORRECTABLE");
    expect(registerPhase(register, null, day, schoolInstant(day, 11 * 60 + 1)).phase).toBe("LOCKED");
    expect(registerPhase(null, null, day).phase).toBe("NOT_TAKEN");
  });
});

describe("draft and automatic submission", () => {
  it("keeps a draft out of the record, then submits it on the server when the period ends", async () => {
    const date = today();
    const teacher = teacherOf(schoolA);
    await saveRegisterDraft(teacher, { sectionId: schoolA.sectionId, date, entries: mark(schoolA, "ABSENT") });

    expect(await prisma.studentAttendance.count({ where: { sectionId: schoolA.sectionId, date } })).toBe(0);
    const draft = await getRegister(teacher, schoolA.sectionId, date);
    expect(draft.phase).toBe("DRAFT");
    expect(draft.rows.every((row) => row.status === "ABSENT")).toBe(true);

    // The period ended ten minutes ago — nobody has the page open.
    const ended = new Date(Date.now() - 10 * 60_000);
    await prisma.attendanceRegister.updateMany({ where: { sectionId: schoolA.sectionId, date }, data: { finalizeAt: ended } });
    // Another school's run touches nothing here.
    expect(await finalizeDueRegisters({ db: adminOf(schoolB).db, schoolId: schoolB.schoolId })).toBe(0);
    expect(await finalizeDueRegisters(adminOf(schoolA))).toBe(1);

    const register = await prisma.attendanceRegister.findFirstOrThrow({ where: { sectionId: schoolA.sectionId, date } });
    expect(register).toMatchObject({ status: "SUBMITTED", autoSubmitted: true, submittedAt: ended });
    expect(register.correctionDeadline).toEqual(correctionDeadlineFor(ended, date));
    expect(await prisma.studentAttendance.count({ where: { sectionId: schoolA.sectionId, date, status: "ABSENT" } })).toBe(schoolA.studentIds.length);
    // A second run does not submit it twice.
    expect(await finalizeDueRegisters(adminOf(schoolA))).toBe(0);
    await expect(saveRegisterDraft(teacher, { sectionId: schoolA.sectionId, date, entries: mark(schoolA) })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("corrections", () => {
  it("lets the teacher correct inside the window with a reason, and only the admin after it", async () => {
    const date = today();
    const teacher = teacherOf(schoolA);
    await expect(markAttendance(teacher, { sectionId: schoolA.sectionId, date, entries: mark(schoolA) })).rejects.toBeInstanceOf(ValidationError);
    const fixed = await markAttendance(teacher, { sectionId: schoolA.sectionId, date, entries: mark(schoolA), reason: "Marked absent by mistake" });
    expect(fixed).toMatchObject({ kind: "CORRECTED", saved: schoolA.studentIds.length });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, action: "ATTENDANCE_CORRECTED" }, orderBy: { createdAt: "desc" } });
    expect(audit.metadata).toMatchObject({ reason: "Marked absent by mistake" });

    // The window closes.
    await prisma.attendanceRegister.updateMany({ where: { sectionId: schoolA.sectionId, date }, data: { correctionDeadline: new Date(Date.now() - 1000) } });
    await expect(
      markAttendance(teacher, { sectionId: schoolA.sectionId, date, entries: mark(schoolA, "ABSENT"), reason: "again" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getRegister(teacher, schoolA.sectionId, date)).editable).toBe(false);
    const byAdmin = await markAttendance(adminOf(schoolA), { sectionId: schoolA.sectionId, date, entries: mark(schoolA, "ABSENT") });
    expect(byAdmin.kind).toBe("CORRECTED");
  });

  it("treats a register taken before tracking as submitted when its marks were saved", async () => {
    // The fixture marked attendance three days ago, with no register row: long past its day.
    const past = addDays(today(), -3);
    const legacy = await getRegister(teacherOf(schoolA), schoolA.sectionId, past);
    expect(legacy.phase).toBe("LOCKED");
    await expect(
      markAttendance(teacherOf(schoolA), { sectionId: schoolA.sectionId, date: past, entries: mark(schoolA, "ABSENT"), reason: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("register cover", () => {
  it("gives another teacher the class for that day only, on their dashboard", async () => {
    const date = today();
    expect(await attendanceSectionIds(other.ctx, schoolA.academicSessionId)).toEqual([]);
    await expect(getRegister(other.ctx, schoolA.unassignedSectionId, date)).rejects.toBeInstanceOf(ForbiddenError);

    await assignRegisterCover(adminOf(schoolA), { sectionId: schoolA.unassignedSectionId, date, teacherId: other.id, reason: "Class teacher on leave" });
    expect(await attendanceSectionIds(other.ctx, schoolA.academicSessionId)).toEqual([schoolA.unassignedSectionId]);
    const mine = await myRegistersToday(other.ctx);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ sectionId: schoolA.unassignedSectionId, reason: "Class teacher on leave" });
    await getRegister(other.ctx, schoolA.unassignedSectionId, date);
    // Not on another day.
    await expect(getRegister(other.ctx, schoolA.unassignedSectionId, addDays(date, -1))).rejects.toBeInstanceOf(ForbiddenError);

    const history = await registerHistory(adminOf(schoolA), { from: date, to: date, sectionId: schoolA.unassignedSectionId });
    expect(history[0]?.cover?.teacher).toBe("stand-in Teacher");

    const cover = await prisma.registerCover.findFirstOrThrow({ where: { sectionId: schoolA.unassignedSectionId, date } });
    await removeRegisterCover(adminOf(schoolA), cover.id);
    expect(await attendanceSectionIds(other.ctx, schoolA.academicSessionId)).toEqual([]);
  });

  it("is School Admin only and stays inside the school", async () => {
    const date = today();
    await expect(
      assignRegisterCover(teacherOf(schoolA), { sectionId: schoolA.unassignedSectionId, date, teacherId: other.id, reason: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      assignRegisterCover(adminOf(schoolB), { sectionId: schoolA.unassignedSectionId, date, teacherId: other.id, reason: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      assignRegisterCover(adminOf(schoolA), { sectionId: schoolA.unassignedSectionId, date, teacherId: schoolA.teacherId === other.id ? "x" : schoolB.teacherId, reason: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("staff work cover", () => {
  it("puts an absent colleague's work on the cover's dashboard, and keeps the history", async () => {
    const date = today();
    const makeStaff = async (key: string) => {
      const user = await prisma.user.create({
        data: { email: `${key}@iso-test-a.test`, passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: key, lastName: "Staff", schoolId: schoolA.schoolId },
      });
      const staff = await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: key.toUpperCase(), firstName: key, lastName: "Staff", role: "OTHER" } });
      return { id: staff.id, ctx: contextFor(schoolA, user.id, "NON_TEACHING_STAFF") };
    };
    const away = await makeStaff("peon");
    const cover = await makeStaff("office");
    await assignWorkCover(adminOf(schoolA), { date, absentStaffMemberId: away.id, coverStaffMemberId: cover.id, duties: "Open the gate at 7:30" });

    expect(await myWorkCoversToday(cover.ctx)).toEqual([expect.objectContaining({ for: "peon Staff", duties: "Open the gate at 7:30" })]);
    expect(await myWorkCoversToday(away.ctx)).toEqual([]);
    expect((await workCoverHistory(adminOf(schoolA), { from: date, to: date }))[0]).toMatchObject({ cover: "office Staff" });
    await expect(
      assignWorkCover(adminOf(schoolA), { date, absentStaffMemberId: away.id, coverStaffMemberId: away.id, duties: "x" }),
    ).rejects.toThrow(/different colleague/);
    await expect(
      assignWorkCover(adminOf(schoolB), { date, absentStaffMemberId: away.id, coverStaffMemberId: cover.id, duties: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await workCoverHistory(adminOf(schoolB), { from: date, to: date })).toEqual([]);
  });
});

describe("staff register for non-teaching staff", () => {
  it("shows teachers and other staff together, saves both, and stays in the school", async () => {
    const { getStaffRegister, markStaffAttendance } = await import("@/server/attendance/service");
    const { myStaffAttendance } = await import("@/server/staff/portal");
    const { staffAttendanceReport } = await import("@/server/reports/exports");
    const { applyForLeave, decideLeave } = await import("@/server/staff/leave");
    const date = today();
    const user = await prisma.user.create({
      data: { email: "clerk@iso-test-a.test", passwordHash: "x", role: "NON_TEACHING_STAFF", firstName: "clerk", lastName: "Staff", schoolId: schoolA.schoolId },
    });
    const clerk = await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "CLK1", firstName: "clerk", lastName: "Staff", role: "OFFICE_STAFF" } });
    const clerkCtx = contextFor(schoolA, user.id, "NON_TEACHING_STAFF");

    const register = await getStaffRegister(adminOf(schoolA), date);
    expect(register.some((row) => row.kind === "TEACHER" && row.teacherId === schoolA.teacherId)).toBe(true);
    expect(register.find((row) => row.staffMemberId === clerk.id)).toMatchObject({ kind: "STAFF", key: `s:${clerk.id}` });
    expect((await getStaffRegister(adminOf(schoolB), date)).some((row) => row.staffMemberId === clerk.id)).toBe(false);

    await markStaffAttendance(adminOf(schoolA), {
      date,
      entries: [
        { teacherId: schoolA.teacherId, status: "PRESENT", remarks: null },
        { staffMemberId: clerk.id, status: "ABSENT", remarks: "Unwell" },
      ],
    });
    expect(await prisma.staffAttendance.findFirst({ where: { staffMemberId: clerk.id, date }, select: { status: true } })).toEqual({ status: "ABSENT" });
    await expect(markStaffAttendance(adminOf(schoolB), { date, entries: [{ staffMemberId: clerk.id, status: "PRESENT", remarks: null }] })).rejects.toBeInstanceOf(NotFoundError);

    // The staff member sees their own marks; the report counts them.
    expect((await myStaffAttendance(clerkCtx)).counts.ABSENT).toBe(1);
    expect((await staffAttendanceReport(adminOf(schoolA), date, date)).find((row) => row.id === `s:${clerk.id}`)?.counts.ABSENT).toBe(1);

    // Approved leave for a staff member fills the staff register for days already reached.
    const { leaveRequestSchema } = await import("@/lib/validation/leave");
    const yesterday = addDays(date, -1);
    const { id } = await applyForLeave(clerkCtx, leaveRequestSchema.parse({ type: "SICK", startDate: yesterday.toISOString().slice(0, 10), endDate: yesterday.toISOString().slice(0, 10), reason: "Fever" }));
    await decideLeave(adminOf(schoolA), { leaveIds: [id], decision: "APPROVED", note: null });
    const marked = await prisma.staffAttendance.findFirst({ where: { staffMemberId: clerk.id, date: yesterday }, select: { status: true } });
    // Yesterday may be a weekly off, when no leave day is counted.
    if (marked) expect(marked.status).toBe("ON_LEAVE");
  });
});
