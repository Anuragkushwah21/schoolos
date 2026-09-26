/**
 * The REST API's own guarantees: who gets in, what a token may do, and that a
 * token from one school cannot see or change another's records.
 *
 * These call the real Route Handlers, so the wrapper — authentication, role
 * check, tenant scoping, read-only enforcement, error mapping — is what is
 * under test, not a stand-in for it.
 */
import { createHash, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SessionUser } from "@/server/auth/session";
import { createApiToken } from "@/server/auth/api-token";
import { prisma } from "@/server/db/prisma";

import { GET as getMe } from "@/app/api/v1/me/route";
import { GET as listStudents, POST as createStudentRoute } from "@/app/api/v1/students/route";
import { GET as getStudent, PUT as putStudent } from "@/app/api/v1/students/[studentId]/route";
import { POST as createTeacherRoute } from "@/app/api/v1/teachers/route";
import { DELETE as deleteTeacherRoute } from "@/app/api/v1/teachers/[teacherId]/route";
import { GET as listSectionsRoute } from "@/app/api/v1/sections/route";
import { GET as getMyTimetable } from "@/app/api/v1/me/timetable/route";
import { GET as getChildTodayRoute } from "@/app/api/v1/me/children/[studentId]/today/route";
import { GET as getChildResultsRoute } from "@/app/api/v1/me/children/[studentId]/results/route";
import { GET as getChildRemarksRoute } from "@/app/api/v1/me/children/[studentId]/remarks/route";
import { GET as getChildReportRoute } from "@/app/api/v1/me/children/[studentId]/report/route";
import { GET as getMyAlertsRoute } from "@/app/api/v1/me/alerts/route";
import { GET as listPlatformSchools } from "@/app/api/v1/platform/schools/route";
import { GET as getPublicSchoolRoute } from "@/app/api/v1/public/schools/[slug]/route";
import { POST as submitApplicationRoute } from "@/app/api/v1/public/schools/[slug]/applications/route";
import { __resetAllRateLimits } from "@/server/auth/rate-limit";

import { adminOf } from "../helpers/context";
import { apiRequest, callApi } from "../helpers/api";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let slugA: string;

/** Tokens minted for the fixture's people. */
const tokens = {
  adminAFull: "",
  adminARead: "",
  adminBFull: "",
  teacherA: "",
  parentA: "",
  superAdmin: "",
  revoked: "",
  expired: "",
};

let superAdmin: SessionUser;

function studentBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Api",
    lastName: "Created",
    sectionId: schoolA.sectionId,
    // A student needs a parent, so the body carries one.
    guardianMode: "new",
    parentFirstName: "Api",
    parentLastName: "Guardian",
    parentPhone: "+91 90000 12345",
    relationship: "FATHER",
    ...overrides,
  };
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } });
  slugA = school.slug;

  const superUser = await prisma.user.create({
    data: {
      email: "super@api-test.test",
      passwordHash: "not-a-real-hash",
      role: "SUPER_ADMIN",
      firstName: "Api",
      lastName: "Owner",
    },
  });
  superAdmin = {
    id: superUser.id,
    email: superUser.email,
    role: "SUPER_ADMIN",
    firstName: superUser.firstName,
    lastName: superUser.lastName,
    schoolId: null,
    schoolSlug: null,
    schoolName: null,
    schoolStatus: null,
  };

  const mint = async (user: SessionUser, scope: "READ" | "FULL", expiresAt: Date | null = null) =>
    (await createApiToken(user, { name: `test ${scope}`, scope, expiresAt })).token;

  /**
   * Only admins can mint tokens through the API, so a teacher's token is
   * written directly — the point is to prove the wrapper still refuses it the
   * endpoints a teacher may not use.
   */
  const mintFor = async (userId: string, schoolId: string | null) => {
    const raw = `sos_${randomBytes(32).toString("base64url")}`;
    await prisma.apiToken.create({
      data: {
        name: "test teacher",
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        prefix: raw.slice(0, 8),
        scope: "FULL",
        userId,
        schoolId,
      },
    });
    return raw;
  };

  tokens.adminAFull = await mint(adminOf(schoolA).user, "FULL");
  tokens.adminARead = await mint(adminOf(schoolA).user, "READ");
  tokens.adminBFull = await mint(adminOf(schoolB).user, "FULL");
  tokens.teacherA = await mintFor(schoolA.teacherUserId, schoolA.schoolId);
  tokens.parentA = await mintFor(schoolA.parentUserId, schoolA.schoolId);
  tokens.superAdmin = await mint(superAdmin, "FULL");

  tokens.revoked = await mint(adminOf(schoolA).user, "FULL");
  const revoked = await prisma.apiToken.findFirstOrThrow({
    where: { userId: schoolA.adminUserId },
    orderBy: { createdAt: "desc" },
  });
  await prisma.apiToken.update({ where: { id: revoked.id }, data: { revokedAt: new Date() } });

  tokens.expired = await mint(adminOf(schoolA).user, "FULL");
  const expired = await prisma.apiToken.findFirstOrThrow({
    where: { userId: schoolA.adminUserId },
    orderBy: { createdAt: "desc" },
  });
  await prisma.apiToken.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });

  __resetAllRateLimits();
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.user.deleteMany({ where: { email: "super@api-test.test" } });
  await prisma.$disconnect();
});

describe("authentication", () => {
  it("refuses a call with no credentials", async () => {
    const { status, body } = await callApi(getMe, apiRequest("/api/v1/me"));
    expect(status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHENTICATED");
  });

  it("refuses an unknown, revoked or expired token alike", async () => {
    for (const token of ["sos_not-a-real-token", tokens.revoked, tokens.expired]) {
      const { status } = await callApi(getMe, apiRequest("/api/v1/me", { token }));
      expect(status).toBe(401);
    }
  });

  it("identifies the caller a valid token acts as", async () => {
    const { status, body } = await callApi(getMe, apiRequest("/api/v1/me", { token: tokens.adminAFull }));
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      user: { id: schoolA.adminUserId, role: "SCHOOL_ADMIN" },
      school: { id: schoolA.schoolId },
      auth: { via: "token", scope: "FULL" },
    });
  });

  it("stops working when the token's owner is deactivated", async () => {
    await prisma.user.update({ where: { id: schoolA.adminUserId }, data: { isActive: false } });
    const { status } = await callApi(getMe, apiRequest("/api/v1/me", { token: tokens.adminAFull }));
    expect(status).toBe(401);
    await prisma.user.update({ where: { id: schoolA.adminUserId }, data: { isActive: true } });
  });

  it("stops working when the token's school is suspended", async () => {
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { status: "SUSPENDED" } });
    const { status } = await callApi(getMe, apiRequest("/api/v1/me", { token: tokens.adminAFull }));
    expect(status).toBe(401);
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { status: "ACTIVE" } });
  });
});

describe("token scope", () => {
  it("lets a read-only token read", async () => {
    const { status, body } = await callApi(
      listStudents,
      apiRequest("/api/v1/students", { token: tokens.adminARead }),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("refuses a read-only token on writes", async () => {
    const { status, body } = await callApi(
      createStudentRoute,
      apiRequest("/api/v1/students", {
        method: "POST",
        token: tokens.adminARead,
        body: studentBody(),
      }),
    );
    expect(status).toBe(403);
    expect(body.error?.message).toMatch(/read-only/i);
    expect(await prisma.student.count({ where: { firstName: "Api" } })).toBe(0);
  });

  it("lets a full token write", async () => {
    const { status, body } = await callApi(
      createStudentRoute,
      apiRequest("/api/v1/students", {
        method: "POST",
        token: tokens.adminAFull,
        body: studentBody({ rollNumber: "91" }),
      }),
    );
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ firstName: "Api", schoolId: schoolA.schoolId });
  });
});

describe("roles", () => {
  it("refuses a teacher the admin's endpoints", async () => {
    const { status, body } = await callApi(
      listStudents,
      apiRequest("/api/v1/students", { token: tokens.teacherA }),
    );
    expect(status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
  });

  it("gives a teacher their own week", async () => {
    const { status } = await callApi(
      getMyTimetable,
      apiRequest("/api/v1/me/timetable", { token: tokens.teacherA }),
    );
    expect(status).toBe(200);
  });

  it("refuses a School Admin the platform endpoints", async () => {
    const { status } = await callApi(
      listPlatformSchools,
      apiRequest("/api/v1/platform/schools", { token: tokens.adminAFull }),
    );
    expect(status).toBe(403);
  });

  it("refuses a Super Admin the school endpoints", async () => {
    // The platform owner governs schools; it does not read their students.
    const { status, body } = await callApi(
      listStudents,
      apiRequest("/api/v1/students", { token: tokens.superAdmin }),
    );
    expect(status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
  });

  it("lets the Super Admin list schools", async () => {
    const { status, body } = await callApi(
      listPlatformSchools,
      apiRequest("/api/v1/platform/schools", { token: tokens.superAdmin }),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe("tenant isolation", () => {
  it("lists only the token's own school", async () => {
    const a = await callApi(listStudents, apiRequest("/api/v1/students", { token: tokens.adminAFull }));
    const b = await callApi(listStudents, apiRequest("/api/v1/students", { token: tokens.adminBFull }));

    const namesA = (a.body.data as Array<{ id: string }>).map((row) => row.id);
    const namesB = (b.body.data as Array<{ id: string }>).map((row) => row.id);

    expect(namesA).toEqual(expect.arrayContaining(schoolA.studentIds));
    expect(namesB).toEqual(expect.arrayContaining(schoolB.studentIds));
    expect(namesA.filter((id) => namesB.includes(id))).toHaveLength(0);
  });

  it("reports another school's record as missing, not forbidden", async () => {
    const { status, body } = await callApi(
      getStudent,
      apiRequest(`/api/v1/students/${schoolB.studentIds[0]}`, { token: tokens.adminAFull }),
      { studentId: schoolB.studentIds[0]! },
    );
    expect(status).toBe(404);
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  it("refuses to write to another school's record", async () => {
    const before = await prisma.student.findUniqueOrThrow({ where: { id: schoolB.studentIds[0]! } });
    const { status } = await callApi(
      putStudent,
      apiRequest(`/api/v1/students/${schoolB.studentIds[0]}`, {
        method: "PUT",
        token: tokens.adminAFull,
        body: {
          firstName: "Hijacked",
          lastName: "Record",
          admissionNumber: before.admissionNumber,
          status: "ACTIVE",
        },
      }),
      { studentId: schoolB.studentIds[0]! },
    );
    expect(status).toBe(404);

    const after = await prisma.student.findUniqueOrThrow({ where: { id: schoolB.studentIds[0]! } });
    expect(after.firstName).toBe(before.firstName);
  });

  it("ignores another school's session id in a query", async () => {
    const { status, body } = await callApi(
      listSectionsRoute,
      apiRequest(`/api/v1/sections?session=${schoolB.academicSessionId}`, { token: tokens.adminAFull }),
    );
    expect(status).toBe(200);
    // School B's session resolves to nothing here, so the current one is used.
    const sections = body.data as Array<{ id: string }>;
    expect(sections.map((section) => section.id)).not.toContain(schoolB.sectionId);
  });
});

describe("deleting a teacher", () => {
  async function addTeacher(email: string): Promise<string> {
    const { status, body } = await callApi(
      createTeacherRoute,
      apiRequest("/api/v1/teachers", {
        method: "POST",
        token: tokens.adminAFull,
        body: { firstName: "Api", lastName: "Teacher", email },
      }),
    );
    expect(status).toBe(201);
    return (body.data as { teacherId: string }).teacherId;
  }

  it("erases a teacher who has no record yet", async () => {
    const teacherId = await addTeacher("api.delete@iso-test-a.test");

    const { status, body } = await callApi(
      deleteTeacherRoute,
      apiRequest(`/api/v1/teachers/${teacherId}`, {
        method: "DELETE",
        token: tokens.adminAFull,
      }),
      { teacherId },
    );
    expect(status).toBe(200);
    expect(body.data).toEqual({ deleted: true });
    await expect(prisma.teacher.findUnique({ where: { id: teacherId } })).resolves.toBeNull();
  });

  it("answers 409 for a teacher whose history cannot be undone", async () => {
    const teacherId = await addTeacher("api.keep@iso-test-a.test");
    await prisma.teacherAttendance.create({
      data: {
        schoolId: schoolA.schoolId,
        teacherId,
        date: new Date(Date.UTC(2026, 8, 1)),
        status: "PRESENT",
      },
    });

    const { status, body } = await callApi(
      deleteTeacherRoute,
      apiRequest(`/api/v1/teachers/${teacherId}`, {
        method: "DELETE",
        token: tokens.adminAFull,
      }),
      { teacherId },
    );
    expect(status).toBe(409);
    expect(body.error?.message).toMatch(/Inactive/);
    await expect(prisma.teacher.findUnique({ where: { id: teacherId } })).resolves.not.toBeNull();
  });

  it("reports another school's teacher as missing", async () => {
    const { status, body } = await callApi(
      deleteTeacherRoute,
      apiRequest(`/api/v1/teachers/${schoolB.teacherId}`, {
        method: "DELETE",
        token: tokens.adminAFull,
      }),
      { teacherId: schoolB.teacherId },
    );
    expect(status).toBe(404);
    expect(body.error?.code).toBe("NOT_FOUND");
    await expect(
      prisma.teacher.findUnique({ where: { id: schoolB.teacherId } }),
    ).resolves.not.toBeNull();
  });

  it("refuses a read-only token", async () => {
    const teacherId = await addTeacher("api.readonly@iso-test-a.test");

    const { status } = await callApi(
      deleteTeacherRoute,
      apiRequest(`/api/v1/teachers/${teacherId}`, {
        method: "DELETE",
        token: tokens.adminARead,
      }),
      { teacherId },
    );
    expect(status).toBe(403);
    await expect(prisma.teacher.findUnique({ where: { id: teacherId } })).resolves.not.toBeNull();
  });
});

describe("the parent portal over the API", () => {
  /**
   * The question §24 of the spec asks, asked of the real handlers: if the
   * `studentId` in the path is changed, does another child's record come back?
   *
   * Each route is called with three ids — the guardian's own child, another
   * family's child in the same school, and a child in another school — and only
   * the first may answer.
   */
  const ROUTES = [
    { name: "today", handler: getChildTodayRoute },
    { name: "results", handler: getChildResultsRoute },
    { name: "remarks", handler: getChildRemarksRoute },
    { name: "report", handler: getChildReportRoute },
  ] as const;

  let ownChild: string;
  let strangerChild: string;

  beforeAll(async () => {
    ownChild = schoolA.studentIds[0]!;

    // Another family in school A: same school, same section, different guardian.
    const otherParent = await prisma.parent.create({
      data: { schoolId: schoolA.schoolId, firstName: "Other", lastName: "Family", phone: "+91 98888 11111" },
    });
    const child = await prisma.student.create({
      data: { schoolId: schoolA.schoolId, admissionNumber: "ADM7300", firstName: "Other", lastName: "Child" },
    });
    await prisma.studentEnrollment.create({
      data: {
        schoolId: schoolA.schoolId,
        studentId: child.id,
        academicSessionId: schoolA.academicSessionId,
        classId: schoolA.classId,
        sectionId: schoolA.sectionId,
        rollNumber: "77",
      },
    });
    await prisma.parentStudent.create({
      data: {
        schoolId: schoolA.schoolId,
        parentId: otherParent.id,
        studentId: child.id,
        relationship: "GUARDIAN",
      },
    });
    strangerChild = child.id;
  });

  it("answers for the guardian's own child", async () => {
    for (const route of ROUTES) {
      const { status, body } = await callApi(
        route.handler,
        apiRequest(`/api/v1/me/children/${ownChild}/${route.name}`, { token: tokens.parentA }),
        { studentId: ownChild },
      );
      expect(status, `${route.name} must answer for a linked child`).toBe(200);
      expect(body.data).toBeTruthy();
    }
  });

  it("reports another family's child as missing, not forbidden", async () => {
    for (const route of ROUTES) {
      const { status, body } = await callApi(
        route.handler,
        apiRequest(`/api/v1/me/children/${strangerChild}/${route.name}`, { token: tokens.parentA }),
        { studentId: strangerChild },
      );
      expect(status, `${route.name} must refuse an unlinked child`).toBe(404);
      expect(body.error?.code).toBe("NOT_FOUND");
    }
  });

  it("reports another school's child identically, so probing reveals nothing", async () => {
    for (const route of ROUTES) {
      const { status } = await callApi(
        route.handler,
        apiRequest(`/api/v1/me/children/${schoolB.studentIds[0]!}/${route.name}`, {
          token: tokens.parentA,
        }),
        { studentId: schoolB.studentIds[0]! },
      );
      expect(status, `${route.name} must refuse another school's child`).toBe(404);
    }
  });

  it("refuses a guardian's token on an admin endpoint", async () => {
    const { status, body } = await callApi(
      listStudents,
      apiRequest("/api/v1/students", { token: tokens.parentA }),
    );
    expect(status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
  });

  it("refuses an admin's token on the guardian endpoints", async () => {
    const { status } = await callApi(
      getChildTodayRoute,
      apiRequest(`/api/v1/me/children/${ownChild}/today`, { token: tokens.adminAFull }),
      { studentId: ownChild },
    );
    expect(status).toBe(403);
  });

  it("derives alerts for the guardian's own children only", async () => {
    const { status, body } = await callApi(
      getMyAlertsRoute,
      apiRequest("/api/v1/me/alerts", { token: tokens.parentA }),
    );
    expect(status).toBe(200);
    const alerts = body.data as Array<{ childId: string | null }>;
    const ids = new Set(alerts.map((alert) => alert.childId).filter(Boolean));
    for (const id of ids) {
      expect(schoolA.studentIds).toContain(id);
    }
  });
});

describe("input handling", () => {
  it("returns field-level errors with 422", async () => {
    const { status, body } = await callApi(
      createStudentRoute,
      apiRequest("/api/v1/students", {
        method: "POST",
        token: tokens.adminAFull,
        body: { firstName: "", lastName: "", guardianMode: "new" },
      }),
    );
    expect(status).toBe(422);
    expect(body.error?.code).toBe("VALIDATION");
    expect(Object.keys(body.error?.fieldErrors ?? {})).toEqual(
      expect.arrayContaining(["firstName", "lastName", "sectionId"]),
    );
  });

  it("rejects a body that is not JSON", async () => {
    const request = apiRequest("/api/v1/students", { method: "POST", token: tokens.adminAFull });
    request.headers.set("content-type", "application/json");
    const { status } = await callApi(createStudentRoute, request);
    expect(status).toBe(422);
  });

  it("takes the id from the path, not the body", async () => {
    const target = schoolA.studentIds[0]!;
    const before = await prisma.student.findUniqueOrThrow({ where: { id: target } });

    const { status } = await callApi(
      putStudent,
      apiRequest(`/api/v1/students/${target}`, {
        method: "PUT",
        token: tokens.adminAFull,
        body: {
          // A forged id in the body must be ignored.
          studentId: schoolB.studentIds[0],
          firstName: before.firstName,
          lastName: "Renamed",
          admissionNumber: before.admissionNumber,
          status: "ACTIVE",
        },
      }),
      { studentId: target },
    );

    expect(status).toBe(200);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: target } })).lastName).toBe("Renamed");
    expect((await prisma.student.findUniqueOrThrow({ where: { id: schoolB.studentIds[0]! } })).lastName).not.toBe(
      "Renamed",
    );
  });
});

describe("public endpoints", () => {
  it("serves an active school and hides a suspended one", async () => {
    const ok = await callApi(getPublicSchoolRoute, apiRequest(`/api/v1/public/schools/${slugA}`), {
      slug: slugA,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ school: { slug: slugA } });

    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { status: "SUSPENDED" } });
    const hidden = await callApi(getPublicSchoolRoute, apiRequest(`/api/v1/public/schools/${slugA}`), {
      slug: slugA,
    });
    expect(hidden.status).toBe(404);
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { status: "ACTIVE" } });
  });

  it("accepts an application without any credentials", async () => {
    __resetAllRateLimits();
    const { status, body } = await callApi(
      submitApplicationRoute,
      apiRequest(`/api/v1/public/schools/${slugA}/applications`, {
        method: "POST",
        body: {
          studentFirstName: "Api",
          studentLastName: "Applicant",
          requestedClassId: schoolA.classId,
          parentName: "Api Parent",
          parentPhone: "+91 98888 77777",
        },
      }),
      { slug: slugA },
    );

    expect(status).toBe(201);
    expect(body.data).toMatchObject({ applicationNumber: expect.stringMatching(/^APP-/) });
    // Applying creates no student until an administrator accepts it.
    expect(await prisma.student.count({ where: { firstName: "Api", lastName: "Applicant" } })).toBe(0);
  });

  it("refuses a class from another school on a public application", async () => {
    __resetAllRateLimits();
    const { status } = await callApi(
      submitApplicationRoute,
      apiRequest(`/api/v1/public/schools/${slugA}/applications`, {
        method: "POST",
        body: {
          studentFirstName: "Wrong",
          studentLastName: "School",
          requestedClassId: schoolB.classId,
          parentName: "Api Parent",
          parentPhone: "+91 98888 77777",
        },
      }),
      { slug: slugA },
    );
    expect(status).toBe(422);
  });
});
