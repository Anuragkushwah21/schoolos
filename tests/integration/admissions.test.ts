/**
 * Public admissions and the review that turns an application into a student.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { admissionApplicationSchema } from "@/lib/validation/website";
import { __resetAllRateLimits } from "@/server/auth/rate-limit";
import { prisma } from "@/server/db/prisma";
import { acceptApplication, listApplications, setApplicationStatus, submitApplication } from "@/server/admissions/service";
import { getPublicSchool } from "@/server/website/public";

import { adminOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let slugA: string;

function application(overrides: Record<string, string> = {}) {
  return admissionApplicationSchema.parse({
    studentFirstName: "Tanvi",
    studentLastName: "Shah",
    requestedClassId: schoolA.classId,
    parentName: "Rekha Shah",
    parentPhone: "+91 91111 22222",
    ...overrides,
  });
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } });
  slugA = school.slug;
}, 60_000);

beforeEach(() => __resetAllRateLimits());

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("public submission", () => {
  it("stores an application against the school in the slug, with a number", async () => {
    const { applicationNumber } = await submitApplication(slugA, application(), { ipAddress: "1.1.1.1" });
    expect(applicationNumber).toMatch(/^APP-\d{4}-\d{4}$/);

    const row = await prisma.admissionApplication.findFirstOrThrow({ where: { applicationNumber } });
    expect(row.schoolId).toBe(schoolA.schoolId);
    expect(row.status).toBe("SUBMITTED");

    // Nothing is created in the school's records until it is accepted.
    expect(await prisma.student.count({ where: { schoolId: schoolA.schoolId, firstName: "Tanvi" } })).toBe(0);
  });

  it("refuses a class belonging to another school", async () => {
    await expect(
      submitApplication(slugA, application({ requestedClassId: schoolB.classId }), { ipAddress: "1.1.1.2" }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("refuses a school that is not active, and hides its website", async () => {
    await prisma.school.update({ where: { id: schoolB.schoolId }, data: { status: "SUSPENDED" } });
    const schoolBRow = await prisma.school.findUniqueOrThrow({ where: { id: schoolB.schoolId } });

    expect(await getPublicSchool(schoolBRow.slug)).toBeNull();
    await expect(
      submitApplication(schoolBRow.slug, application({ requestedClassId: schoolB.classId }), { ipAddress: "1.1.1.3" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await prisma.school.update({ where: { id: schoolB.schoolId }, data: { status: "ACTIVE" } });
  });

  it("discards a honeypot submission", async () => {
    const before = await prisma.admissionApplication.count();
    await submitApplication(slugA, application({ website: "http://spam.example" }), { ipAddress: "1.1.1.4" });
    expect(await prisma.admissionApplication.count()).toBe(before);
  });
});

describe("review", () => {
  it("accepts an application, creating the student, guardian and enrollment", async () => {
    const { applicationNumber } = await submitApplication(
      slugA,
      application({ studentFirstName: "Kiran", parentPhone: "+91 93333 44444" }),
      { ipAddress: "1.1.2.1" },
    );
    const app = await prisma.admissionApplication.findFirstOrThrow({ where: { applicationNumber } });

    const { studentId } = await acceptApplication(adminOf(schoolA), {
      applicationId: app.id,
      sectionId: schoolA.sectionId,
      rollNumber: "44",
      admissionNumber: null,
      reviewNotes: "Seats available",
    });

    const student = await prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      include: { enrollments: true, parents: { include: { parent: true } } },
    });
    expect(student.firstName).toBe("Kiran");
    expect(student.schoolId).toBe(schoolA.schoolId);
    expect(student.enrollments[0]?.sectionId).toBe(schoolA.sectionId);
    expect(student.parents[0]?.parent.phone).toBe("+91 93333 44444");

    const decided = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: app.id } });
    expect(decided.status).toBe("ACCEPTED");
    expect(decided.createdStudentId).toBe(studentId);

    // A second decision on the same application is refused.
    await expect(
      setApplicationStatus(adminOf(schoolA), { applicationId: app.id, status: "REJECTED", reviewNotes: null }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("reuses an existing guardian with the same phone, so siblings share one", async () => {
    const { applicationNumber } = await submitApplication(
      slugA,
      application({ studentFirstName: "Sibling", parentPhone: "+91 93333 44444" }),
      { ipAddress: "1.1.2.2" },
    );
    const app = await prisma.admissionApplication.findFirstOrThrow({ where: { applicationNumber } });

    const { studentId } = await acceptApplication(adminOf(schoolA), {
      applicationId: app.id,
      sectionId: schoolA.sectionId,
      rollNumber: "45",
      admissionNumber: null,
      reviewNotes: null,
    });

    const parents = await prisma.parent.findMany({
      where: { schoolId: schoolA.schoolId, phone: "+91 93333 44444" },
      include: { children: true },
    });
    expect(parents).toHaveLength(1);
    expect(parents[0]?.children.map((c) => c.studentId)).toContain(studentId);
  });

  it("refuses a section from a different academic session", async () => {
    const other = await prisma.academicSession.create({
      data: {
        schoolId: schoolA.schoolId,
        name: "2028-29",
        startDate: new Date(Date.UTC(2028, 3, 1)),
        endDate: new Date(Date.UTC(2029, 2, 31)),
      },
    });
    const otherSection = await prisma.section.create({
      data: {
        schoolId: schoolA.schoolId,
        academicSessionId: other.id,
        classId: schoolA.classId,
        name: "Z",
      },
    });

    const { applicationNumber } = await submitApplication(slugA, application({ studentFirstName: "Wrong" }), {
      ipAddress: "1.1.2.3",
    });
    const app = await prisma.admissionApplication.findFirstOrThrow({ where: { applicationNumber } });

    await expect(
      acceptApplication(adminOf(schoolA), {
        applicationId: app.id,
        sectionId: otherSection.id,
        rollNumber: null,
        admissionNumber: null,
        reviewNotes: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never lists another school's applications", async () => {
    const rows = await listApplications(adminOf(schoolB));
    expect(rows.every((row) => row.studentFirstName !== "Tanvi")).toBe(true);
  });
});
