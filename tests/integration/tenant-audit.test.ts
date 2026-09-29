/**
 * Tenant-isolation audit: Alpha Public School vs Beta Public School.
 *
 * Everything here goes through the server — the real API route handlers with
 * each admin's own credentials, or the services the pages and Server Actions
 * call — never the UI. A test passes only if the other school's records are
 * absent from the response itself, not merely hidden on screen.
 *
 * Every Beta record is named "B-…" and every Alpha record "A-…", so a leak is
 * caught by searching the whole response body for the other school's marker.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError, NotFoundError } from "@/lib/errors";
import { addDays, today } from "@/lib/dates";
import { createApiToken } from "@/server/auth/api-token";
import type { TenantContext } from "@/server/auth/current-user";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { classStrength, genderSplit } from "@/server/analytics/school";
import { schoolTracker } from "@/server/analytics/platform";
import { schoolReport, todayOverview } from "@/server/attendance/service";
import { listExpenses, removeExpense } from "@/server/finance/expenses";
import { chargeStudent, listFeePositions, listPayments, recordPayment, removePayment } from "@/server/finance/fees";
import { financeOverview, resolveFinanceRange } from "@/server/finance/overview";
import { listSalaryPayments, paySalary } from "@/server/finance/salary";
import { parentOptions } from "@/server/people/parents";
import { forSchool } from "@/server/tenancy/scope";

import { GET as listStudentsRoute, POST as createStudentRoute } from "@/app/api/v1/students/route";
import {
  DELETE as deleteStudentRoute,
  GET as getStudentRoute,
  PUT as putStudentRoute,
} from "@/app/api/v1/students/[studentId]/route";
import { POST as enrollRoute } from "@/app/api/v1/students/[studentId]/enrollments/route";
import { POST as linkGuardianRoute } from "@/app/api/v1/students/[studentId]/guardians/route";
import { GET as listTeachersRoute } from "@/app/api/v1/teachers/route";
import { GET as getTeacherRoute } from "@/app/api/v1/teachers/[teacherId]/route";
import { POST as assignRoute } from "@/app/api/v1/teachers/[teacherId]/assignments/route";
import { GET as searchGuardiansRoute } from "@/app/api/v1/guardians/route";
import { PUT as putGuardianRoute } from "@/app/api/v1/guardians/[parentId]/route";
import { PATCH as patchClassRoute } from "@/app/api/v1/classes/[classId]/route";
import { GET as listClassesRoute } from "@/app/api/v1/classes/route";
import { GET as getSectionRoute } from "@/app/api/v1/sections/[sectionId]/route";
import { GET as listSectionsRoute } from "@/app/api/v1/sections/route";
import { PATCH as patchSubjectRoute } from "@/app/api/v1/subjects/[subjectId]/route";
import { GET as listSubjectsRoute } from "@/app/api/v1/subjects/route";
import { GET as getRegisterRoute, POST as markAttendanceRoute } from "@/app/api/v1/attendance/route";
import { GET as attendanceReportRoute } from "@/app/api/v1/reports/attendance/route";
import { GET as getTimetableRoute, POST as createSlotRoute } from "@/app/api/v1/timetable/route";
import { DELETE as deleteSlotRoute } from "@/app/api/v1/timetable/[slotId]/route";
import { GET as getNoticeRoute } from "@/app/api/v1/notices/[noticeId]/route";
import { GET as listNoticesRoute } from "@/app/api/v1/notices/route";
import { GET as getAdmissionRoute } from "@/app/api/v1/admissions/[applicationId]/route";
import { GET as listAdmissionsRoute } from "@/app/api/v1/admissions/route";
import { GET as platformSchoolsRoute } from "@/app/api/v1/platform/schools/route";
import { GET as platformSchoolRoute } from "@/app/api/v1/platform/schools/[schoolId]/route";

import { apiRequest, callApi } from "../helpers/api";
import { type AuditSchool, createAlphaBetaFixture, destroyAlphaBetaFixture } from "../helpers/alpha-beta-fixture";

let alpha: AuditSchool;
let beta: AuditSchool;
const token: Record<"A" | "B" | "SUPER", string> = { A: "", B: "", SUPER: "" };
let superUserId = "";

/** Markers only the other school's records carry. */
const FOREIGN: Record<"A" | "B", RegExp> = {
  A: /B-(Student|Teacher|Parent|Class|Section|Mathematics|Notice|Homework|Expense|Applicant|ADM|EMP)|Beta Public School/,
  B: /A-(Student|Teacher|Parent|Class|Section|Mathematics|Notice|Homework|Expense|Applicant|ADM|EMP)|Alpha Public School/,
};

function actorFor(school: AuditSchool): SessionUser {
  return {
    id: school.adminUserId,
    email: `admin@${school.key}.test`,
    role: "SCHOOL_ADMIN",
    firstName: `${school.key}-Admin`,
    lastName: "User",
    schoolId: school.schoolId,
    schoolSlug: `tenant-audit-${school.key.toLowerCase()}`,
    schoolName: school.name,
    schoolStatus: "ACTIVE",
  };
}

function ctxFor(school: AuditSchool): TenantContext {
  const user = actorFor(school);
  return { user, schoolId: school.schoolId, schoolSlug: user.schoolSlug!, schoolName: school.name, db: forSchool(school.schoolId) };
}

type Handler<P> = Parameters<typeof callApi<P & Record<string, string>>>[0];

/** Call a route as `who`, and return status plus the body as text for leak checks. */
async function call<P extends Record<string, string>>(
  who: "A" | "B" | "SUPER",
  handler: Handler<P>,
  url: string,
  params?: P,
  init: { method?: string; body?: unknown } = {},
) {
  const result = await callApi(handler, apiRequest(url, { ...init, token: token[who] }), params);
  return { ...result, text: JSON.stringify(result.body) };
}

beforeAll(async () => {
  ({ alpha, beta } = await createAlphaBetaFixture());

  const superUser = await prisma.user.create({
    data: {
      email: "super@tenant-audit.test",
      passwordHash: "not-a-real-hash",
      role: "SUPER_ADMIN",
      firstName: "Platform",
      lastName: "Owner",
    },
  });
  superUserId = superUser.id;

  token.A = (await createApiToken(actorFor(alpha), { name: "audit A", scope: "FULL", expiresAt: null })).token;
  token.B = (await createApiToken(actorFor(beta), { name: "audit B", scope: "FULL", expiresAt: null })).token;
  token.SUPER = (
    await createApiToken(
      {
        id: superUser.id,
        email: superUser.email,
        role: "SUPER_ADMIN",
        firstName: "Platform",
        lastName: "Owner",
        schoolId: null,
        schoolSlug: null,
        schoolName: null,
        schoolStatus: null,
      },
      { name: "audit super", scope: "READ", expiresAt: null },
    )
  ).token;
}, 90_000);

afterAll(async () => {
  await prisma.apiToken.deleteMany({ where: { userId: superUserId } });
  await prisma.user.deleteMany({ where: { id: superUserId } });
  await destroyAlphaBetaFixture();
  await prisma.$disconnect();
});

// Both directions of every rule: [who asks, own school, the other school].
const PAIRS = () =>
  [
    ["A", alpha, beta],
    ["B", beta, alpha],
  ] as const;

// -----------------------------------------------------------------------------
// 1. Super Admin
// -----------------------------------------------------------------------------

describe("Super Admin sees both schools", () => {
  it("lists Alpha and Beta with their own teacher and student counts", async () => {
    const list = await call("SUPER", platformSchoolsRoute, "/api/v1/platform/schools?q=Public School");
    expect(list.status).toBe(200);
    expect(list.text).toContain("Alpha Public School");
    expect(list.text).toContain("Beta Public School");

    for (const school of [alpha, beta]) {
      const detail = await call("SUPER", platformSchoolRoute, `/api/v1/platform/schools/${school.schoolId}`, {
        schoolId: school.schoolId,
      });
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ school: { name: school.name, _count: { students: 3, teachers: 2 } } });
    }

    const tracker = await schoolTracker(
      { id: superUserId, email: "", role: "SUPER_ADMIN", firstName: "", lastName: "", schoolId: null, schoolSlug: null, schoolName: null, schoolStatus: null },
      { q: "Public School" },
    );
    const byName = Object.fromEntries(tracker.rows.map((row) => [row.name, row]));
    expect(byName["Alpha Public School"]).toMatchObject({ students: 3, teachers: 2, revenueMinor: 10_000_00 });
    expect(byName["Beta Public School"]).toMatchObject({ students: 3, teachers: 2, revenueMinor: 7_000_00 });
  });

  it("is refused to a School Admin", async () => {
    const res = await call("A", platformSchoolsRoute, "/api/v1/platform/schools");
    expect(res.status).toBe(403);
  });
});

// -----------------------------------------------------------------------------
// 2–3, 5–6. Lists contain only the caller's school (TESTS 5, 6)
// -----------------------------------------------------------------------------

describe("every list is the caller's school only", () => {
  it.each(["A", "B"] as const)("School %s admin: students, teachers, classes, sections, subjects, notices, admissions", async (who) => {
    const own = who === "A" ? alpha : beta;

    const students = await call(who, listStudentsRoute, "/api/v1/students");
    expect(students.status).toBe(200);
    expect((students.body.data as Array<{ firstName: string }>).map((s) => s.firstName).sort()).toEqual(
      [1, 2, 3].map((n) => `${who}-Student-${n}`),
    );

    const teachers = await call(who, listTeachersRoute, "/api/v1/teachers");
    expect((teachers.body.data as Array<{ firstName: string }>).map((t) => t.firstName).sort()).toEqual([
      `${who}-Teacher-1`,
      `${who}-Teacher-2`,
    ]);

    for (const [handler, url] of [
      [listClassesRoute, "/api/v1/classes"],
      [listSectionsRoute, "/api/v1/sections"],
      [listSubjectsRoute, "/api/v1/subjects"],
      [listNoticesRoute, "/api/v1/notices"],
      [listAdmissionsRoute, "/api/v1/admissions"],
      [getTimetableRoute, `/api/v1/timetable?section=${own.sectionId}`],
      [getRegisterRoute, `/api/v1/attendance?section=${own.sectionId}&date=${addDays(today(), -2).toISOString().slice(0, 10)}`],
      [attendanceReportRoute, "/api/v1/reports/attendance"],
    ] as const) {
      const res = await call(who, handler as unknown as Handler<Record<string, string>>, url);
      expect(res.status, url).toBe(200);
      expect(res.text, url).toContain(`${who}-`);
      expect(res.text, url).not.toMatch(FOREIGN[who]);
    }
  });
});

// -----------------------------------------------------------------------------
// TESTS 1–4, 9–10. Direct IDs across the boundary
// -----------------------------------------------------------------------------

describe("direct IDs", () => {
  it.each(["A", "B"] as const)("School %s admin can open its own student and teacher", async (who) => {
    const own = who === "A" ? alpha : beta;
    const student = await call(who, getStudentRoute, `/api/v1/students/${own.studentIds[0]}`, { studentId: own.studentIds[0]! });
    expect(student.status).toBe(200);
    expect(student.text).toContain(`${who}-Student-1`);

    const teacher = await call(who, getTeacherRoute, `/api/v1/teachers/${own.teacherIds[0]}`, { teacherId: own.teacherIds[0]! });
    expect(teacher.status).toBe(200);
    expect(teacher.text).toContain(`${who}-Teacher-1`);
  });

  it("refuses every other-school record by ID, in both directions, without leaking it", async () => {
    for (const [who, , other] of PAIRS()) {
      const probes = [
        await call(who, getStudentRoute, `/api/v1/students/${other.studentIds[0]}`, { studentId: other.studentIds[0]! }),
        await call(who, putStudentRoute, `/api/v1/students/${other.studentIds[0]}`, { studentId: other.studentIds[0]! }, {
          method: "PUT",
          body: { firstName: "Hacked", lastName: "Pupil", gender: "MALE" },
        }),
        await call(who, deleteStudentRoute, `/api/v1/students/${other.studentIds[1]}`, { studentId: other.studentIds[1]! }, { method: "DELETE" }),
        await call(who, getTeacherRoute, `/api/v1/teachers/${other.teacherIds[0]}`, { teacherId: other.teacherIds[0]! }),
        await call(who, getSectionRoute, `/api/v1/sections/${other.sectionId}`, { sectionId: other.sectionId }),
        await call(who, patchClassRoute, `/api/v1/classes/${other.classId}`, { classId: other.classId }, { method: "PATCH", body: { isActive: false } }),
        await call(who, patchSubjectRoute, `/api/v1/subjects/${other.subjectId}`, { subjectId: other.subjectId }, { method: "PATCH", body: { isActive: false } }),
        await call(who, getRegisterRoute, `/api/v1/attendance?section=${other.sectionId}`),
        await call(who, attendanceReportRoute, `/api/v1/reports/attendance?section=${other.sectionId}`),
        await call(who, getTimetableRoute, `/api/v1/timetable?section=${other.sectionId}`),
        await call(who, getTimetableRoute, `/api/v1/timetable?teacher=${other.teacherIds[0]}`),
        await call(who, deleteSlotRoute, `/api/v1/timetable/${other.slotId}`, { slotId: other.slotId }, { method: "DELETE" }),
        await call(who, getNoticeRoute, `/api/v1/notices/${other.noticeId}`, { noticeId: other.noticeId }),
        await call(who, getAdmissionRoute, `/api/v1/admissions/${other.admissionId}`, { applicationId: other.admissionId }),
        await call(who, putGuardianRoute, `/api/v1/guardians/${other.parentId}`, { parentId: other.parentId }, {
          method: "PUT",
          body: { firstName: "Hacked", lastName: "Guardian", phone: "+91 90000 99999" },
        }),
      ];

      for (const probe of probes) {
        expect([403, 404, 422], probe.text).toContain(probe.status);
        expect(probe.text).not.toMatch(FOREIGN[who]);
      }
    }

    // And nothing on the other side changed.
    expect(await prisma.student.count({ where: { firstName: "Hacked" } })).toBe(0);
    expect(await prisma.parent.count({ where: { firstName: "Hacked" } })).toBe(0);
    expect(await prisma.student.count({ where: { schoolId: { in: [alpha.schoolId, beta.schoolId] } } })).toBe(6);
    expect(await prisma.class.count({ where: { id: { in: [alpha.classId, beta.classId] }, isActive: false } })).toBe(0);
    expect(await prisma.timetableSlot.count({ where: { id: { in: [alpha.slotId, beta.slotId] } } })).toBe(2);
  });

  it("refuses other-school money by ID", async () => {
    for (const [who, own, other] of PAIRS()) {
      await expect(removeExpense(ctxFor(own), other.expenseId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(removePayment(ctxFor(own), other.paymentId)).rejects.toBeInstanceOf(NotFoundError);
      void who;
    }
    expect(await prisma.expense.count({ where: { id: { in: [alpha.expenseId, beta.expenseId] } } })).toBe(2);
    expect(await prisma.feePayment.count({ where: { id: { in: [alpha.paymentId, beta.paymentId] } } })).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// TESTS 11–12. Search, pagination, filters, dropdowns
// -----------------------------------------------------------------------------

describe("search never crosses schools", () => {
  it("returns nothing for the other school's names, admission numbers or parents", async () => {
    for (const [who, own, other] of PAIRS()) {
      const theirs = other.key;
      for (const q of [`${theirs}-Student-1`, `${theirs}-ADM-2`, "Student", "Pupil"]) {
        const res = await call(who, listStudentsRoute, `/api/v1/students?q=${encodeURIComponent(q)}`);
        expect(res.status).toBe(200);
        expect(res.text).not.toMatch(FOREIGN[who]);
      }
      // Pagination and filters can't widen it either — including another school's section as a filter.
      const paged = await call(who, listStudentsRoute, `/api/v1/students?page=2`);
      expect(paged.text).not.toMatch(FOREIGN[who]);
      const filtered = await call(who, listStudentsRoute, `/api/v1/students?section=${other.sectionId}`);
      expect(filtered.body.data).toEqual([]);

      const teachers = await call(who, listTeachersRoute, `/api/v1/teachers?q=${theirs}-Teacher`);
      expect(teachers.body.data).toEqual([]);

      const guardians = await call(who, searchGuardiansRoute, `/api/v1/guardians?q=${theirs}-Parent`);
      expect(guardians.body.data).toEqual([]);
      const allGuardians = await call(who, searchGuardiansRoute, `/api/v1/guardians?q=Guardian`);
      expect(allGuardians.text).not.toMatch(FOREIGN[who]);

      // The parent picker and the fee search behind the finance pages.
      expect(JSON.stringify(await parentOptions(ctxFor(own), "Parent"))).not.toMatch(FOREIGN[who]);
      const fees = await listFeePositions(ctxFor(own), { q: `${theirs}-Student` });
      expect(fees.rows).toEqual([]);
    }
  });
});

// -----------------------------------------------------------------------------
// TESTS 7–8. Dashboard aggregation
// -----------------------------------------------------------------------------

describe("dashboard figures are the school's own", () => {
  it.each(["A", "B"] as const)("School %s: 3 students, 2 teachers, own attendance and money", async (who) => {
    const own = who === "A" ? alpha : beta;
    const ctx = ctxFor(own);

    // The same queries the admin dashboard runs.
    expect(await ctx.db.student.count({ where: { status: "ACTIVE" } })).toBe(3);
    expect(await ctx.db.teacher.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } })).toBe(2);
    expect(await genderSplit(ctx)).toMatchObject({ boys: 2, girls: 1 });
    expect((await classStrength(ctx, own.academicSessionId)).map((row) => row.value)).toEqual([3]);
    expect((await todayOverview(ctx, own.academicSessionId)).sections).toBe(1);

    const report = await schoolReport(ctx, own.academicSessionId, addDays(today(), -7), today());
    expect(JSON.stringify(report)).not.toMatch(FOREIGN[who]);

    const finance = await financeOverview(ctx, resolveFinanceRange({ range: "today" }));
    expect(finance.today).toEqual({
      feesMinor: who === "A" ? 10_000_00 : 7_000_00,
      expensesMinor: who === "A" ? 1_000_00 : 2_000_00,
      salaryMinor: who === "A" ? 25_000_00 : 30_000_00,
    });
    expect(finance.pending.pendingMinor).toBe(who === "A" ? 20_000_00 : 23_000_00);

    expect(JSON.stringify(await listPayments(ctx))).not.toMatch(FOREIGN[who]);
    expect(JSON.stringify(await listExpenses(ctx))).not.toMatch(FOREIGN[who]);
    expect((await listSalaryPayments(ctx)).map((row) => row.teacher.firstName)).toEqual([`${who}-Teacher-1`]);
  });
});

// -----------------------------------------------------------------------------
// TEST 13. Cross-school relationships are rejected
// -----------------------------------------------------------------------------

describe("cross-school relationships", () => {
  it("rejects linking the other school's teacher, student, section, subject or parent", async () => {
    for (const [who, own, other] of PAIRS()) {
      const attempts = [
        // Other school's teacher into my section/subject.
        await call(who, assignRoute, `/api/v1/teachers/${other.teacherIds[1]}/assignments`, { teacherId: other.teacherIds[1]! }, {
          method: "POST",
          body: { subjectId: own.subjectId, sectionId: own.sectionId },
        }),
        // My teacher into the other school's section.
        await call(who, assignRoute, `/api/v1/teachers/${own.teacherIds[1]}/assignments`, { teacherId: own.teacherIds[1]! }, {
          method: "POST",
          body: { subjectId: other.subjectId, sectionId: other.sectionId },
        }),
        // Other school's student into my section.
        await call(who, enrollRoute, `/api/v1/students/${other.studentIds[2]}/enrollments`, { studentId: other.studentIds[2]! }, {
          method: "POST",
          body: { academicSessionId: own.academicSessionId, sectionId: own.sectionId },
        }),
        // My student into the other school's section.
        await call(who, enrollRoute, `/api/v1/students/${own.studentIds[2]}/enrollments`, { studentId: own.studentIds[2]! }, {
          method: "POST",
          body: { academicSessionId: other.academicSessionId, sectionId: other.sectionId },
        }),
        // Other school's parent onto my student.
        await call(who, linkGuardianRoute, `/api/v1/students/${own.studentIds[0]}/guardians`, { studentId: own.studentIds[0]! }, {
          method: "POST",
          body: { guardianMode: "existing", existingParentId: other.parentId, relationship: "FATHER" },
        }),
        // Attendance for the other school's student, filed under my section.
        await call(who, markAttendanceRoute, "/api/v1/attendance", undefined, {
          method: "POST",
          body: { sectionId: own.sectionId, date: today().toISOString().slice(0, 10), entries: [{ studentId: other.studentIds[0], status: "PRESENT" }] },
        }),
        // Attendance in the other school's section.
        await call(who, markAttendanceRoute, "/api/v1/attendance", undefined, {
          method: "POST",
          body: { sectionId: other.sectionId, date: today().toISOString().slice(0, 10), entries: [{ studentId: other.studentIds[0], status: "PRESENT" }] },
        }),
        // A timetable period in my section taught by the other school's teacher.
        await call(who, createSlotRoute, "/api/v1/timetable", undefined, {
          method: "POST",
          body: { sectionId: own.sectionId, subjectId: own.subjectId, teacherId: other.teacherIds[0], dayOfWeek: "SATURDAY", startMinute: "11:00", endMinute: "11:45" },
        }),
      ];

      for (const attempt of attempts) {
        expect(attempt.status, attempt.text).toBeGreaterThanOrEqual(400);
        expect(attempt.status, attempt.text).toBeLessThan(500);
      }
    }

    // Money across the boundary, through the services the finance pages use.
    for (const [, own, other] of PAIRS()) {
      await expect(
        recordPayment(ctxFor(own), { studentId: other.studentIds[1]!, amountMinor: 100, paidOn: today(), method: "CASH", receiptNo: `X-${other.key}`, notes: null }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        paySalary(ctxFor(own), { teacherId: other.teacherIds[1]!, amountMinor: 100, paidOn: today(), forMonth: today(), method: "CASH", reference: null, notes: null }),
      ).rejects.toBeInstanceOf(NotFoundError);
      const heads = await prisma.feeHead.findMany({ where: { schoolId: own.schoolId }, select: { id: true } });
      await expect(
        chargeStudent(ctxFor(own), { studentId: other.studentIds[1]!, feeHeadId: heads[0]!.id, amountMinor: 100, dueOn: today(), notes: null }),
      ).rejects.toBeInstanceOf(AppError);
    }

    // The database holds no link between the two schools anywhere.
    const ids = { A: alpha.schoolId, B: beta.schoolId };
    const crossEnrollments = await prisma.studentEnrollment.count({
      where: {
        OR: [
          { schoolId: ids.A, studentId: { in: beta.studentIds } },
          { schoolId: ids.B, studentId: { in: alpha.studentIds } },
          { schoolId: ids.A, sectionId: beta.sectionId },
          { schoolId: ids.B, sectionId: alpha.sectionId },
        ],
      },
    });
    expect(crossEnrollments).toBe(0);
    expect(await prisma.studentAttendance.count({ where: { date: today(), schoolId: { in: [ids.A, ids.B] } } })).toBe(0);
    expect(await prisma.parentStudent.count({ where: { parentId: beta.parentId, studentId: { in: alpha.studentIds } } })).toBe(0);
    expect(await prisma.parentStudent.count({ where: { parentId: alpha.parentId, studentId: { in: beta.studentIds } } })).toBe(0);
    expect(await prisma.teacherSubjectAssignment.count({ where: { schoolId: ids.A, teacherId: { in: beta.teacherIds } } })).toBe(0);
    expect(await prisma.teacherSubjectAssignment.count({ where: { schoolId: ids.B, teacherId: { in: alpha.teacherIds } } })).toBe(0);
  });

  it("is also refused by the database itself, whatever the application does", async () => {
    // Bypass every service: a raw insert linking Beta's student to Alpha's section.
    await expect(
      prisma.studentEnrollment.create({
        data: {
          schoolId: alpha.schoolId,
          studentId: beta.studentIds[0]!,
          academicSessionId: alpha.academicSessionId,
          classId: alpha.classId,
          sectionId: alpha.sectionId,
        },
      }),
    ).rejects.toThrow();
  });
});

// -----------------------------------------------------------------------------
// 6, 14. The client's schoolId is never trusted
// -----------------------------------------------------------------------------

describe("a schoolId sent by the client is ignored", () => {
  it("reads: ?schoolId= of the other school still returns only the caller's school", async () => {
    for (const [who, , other] of PAIRS()) {
      const res = await call(who, listStudentsRoute, `/api/v1/students?schoolId=${other.schoolId}`);
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(FOREIGN[who]);
      expect((res.body.data as unknown[]).length).toBe(3);
    }
  });

  it("writes: a body carrying the other school's schoolId lands in the caller's own school", async () => {
    const res = await call("A", createStudentRoute, "/api/v1/students", undefined, {
      method: "POST",
      body: {
        schoolId: beta.schoolId,
        firstName: "A-Tampered",
        lastName: "Pupil",
        sectionId: alpha.sectionId,
        guardianMode: "new",
        parentFirstName: "A-Tampered",
        parentLastName: "Guardian",
        parentPhone: "+91 90000 12345",
        relationship: "FATHER",
      },
    });
    expect(res.status, res.text).toBe(201);
    const created = await prisma.student.findFirstOrThrow({ where: { firstName: "A-Tampered" } });
    expect(created.schoolId).toBe(alpha.schoolId);
    await prisma.parentStudent.deleteMany({ where: { studentId: created.id } });
    await prisma.studentEnrollment.deleteMany({ where: { studentId: created.id } });
    await prisma.student.delete({ where: { id: created.id } });
  });

  it("the other school's student id together with its schoolId is still refused", async () => {
    const res = await call("A", getStudentRoute, `/api/v1/students/${beta.studentIds[0]}?schoolId=${beta.schoolId}`, {
      studentId: beta.studentIds[0]!,
    });
    expect(res.status).toBe(404);
    expect(res.text).not.toMatch(FOREIGN.A);
  });

  it("the scoped client keeps a smuggled schoolId as an extra filter, so it matches nothing", async () => {
    const db = forSchool(alpha.schoolId);
    expect(await db.student.findMany({ where: { schoolId: beta.schoolId } })).toEqual([]);
    expect(await db.student.count({ where: { OR: [{ schoolId: beta.schoolId }, { firstName: { startsWith: "B-" } }] } })).toBe(0);
    expect(await db.teacher.findUnique({ where: { id: beta.teacherIds[0]! } })).toBeNull();
    const updated = await db.student.updateMany({ where: { id: { in: beta.studentIds } }, data: { firstName: "Hacked" } });
    expect(updated.count).toBe(0);
  });
});
