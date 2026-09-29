/**
 * Targeted notices and the student/teacher alert feeds.
 *
 *   * A notice reaches only its audience, and within it only its class,
 *     section or listed students (for parents: through their children).
 *   * A targeted notice never reaches the public website.
 *   * Targets must belong to the school; nothing crosses schools.
 *   * Students and teachers get their own feeds.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today, toDateInput } from "@/lib/dates";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { noticeSchema } from "@/lib/validation/communication";
import { createExamSchema } from "@/lib/validation/exams";
import { getStudentAlerts, getTeacherAlerts } from "@/server/alerts/feeds";
import type { TenantContext } from "@/server/auth/current-user";
import { noticesFor, publicNotices, saveNotice } from "@/server/communication/notices";
import { prisma } from "@/server/db/prisma";
import { createExams } from "@/server/exams/service";
import { getParentAlerts } from "@/server/parent/alerts";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
/** A parent and child in section B of school A, apart from the fixture family. */
let otherParent: TenantContext;
let otherStudent: TenantContext;
let otherAdmission: string;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");

const notice = (fields: Record<string, unknown>) =>
  noticeSchema.parse({ body: "Details inside", status: "PUBLISHED", audience: "ALL", ...fields });

const titles = async (ctx: TenantContext) => (await noticesFor(ctx)).map((row) => row.title);

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const [parentUser, studentUser] = await Promise.all(
    ["other-parent", "other-student"].map((key, index) =>
      prisma.user.create({
        data: {
          email: `${key}@iso-test-a.test`,
          passwordHash: "not-a-real-hash",
          role: index === 0 ? "PARENT" : "STUDENT",
          firstName: key,
          lastName: "B",
          schoolId: schoolA.schoolId,
        },
      }),
    ),
  );
  const parent = await prisma.parent.create({
    data: { schoolId: schoolA.schoolId, userId: parentUser!.id, firstName: "Other", lastName: "Parent", phone: "9000000099" },
  });
  const student = await prisma.student.create({
    data: { schoolId: schoolA.schoolId, userId: studentUser!.id, admissionNumber: "SECB1", firstName: "Other", lastName: "Child" },
  });
  otherAdmission = "SECB1";
  await prisma.studentEnrollment.create({
    data: {
      schoolId: schoolA.schoolId,
      studentId: student.id,
      academicSessionId: schoolA.academicSessionId,
      classId: (await prisma.section.findUniqueOrThrow({ where: { id: schoolA.unassignedSectionId } })).classId,
      sectionId: schoolA.unassignedSectionId,
    },
  });
  await prisma.parentStudent.create({
    data: { schoolId: schoolA.schoolId, parentId: parent.id, studentId: student.id, relationship: "MOTHER", isPrimary: true },
  });
  otherParent = contextFor(schoolA, parentUser!.id, "PARENT");
  otherStudent = contextFor(schoolA, studentUser!.id, "STUDENT");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("targeting", () => {
  it("reaches one section's students only", async () => {
    await saveNotice(adminOf(schoolA), notice({ title: "Section A trip", audience: "STUDENTS", scope: "SECTION", sectionId: schoolA.sectionId }));
    expect(await titles(studentOf(schoolA))).toContain("Section A trip");
    expect(await titles(otherStudent)).not.toContain("Section A trip");
    // Wrong audience: parents of section A do not get a students-only notice.
    expect(await titles(parentOf(schoolA))).not.toContain("Section A trip");
  });

  it("reaches a whole class across its sections", async () => {
    const classId = (await prisma.section.findUniqueOrThrow({ where: { id: schoolA.sectionId } })).classId;
    await saveNotice(adminOf(schoolA), notice({ title: "Class 10 exams", scope: "CLASS", classId }));
    for (const ctx of [studentOf(schoolA), otherStudent, parentOf(schoolA), otherParent]) {
      expect(await titles(ctx)).toContain("Class 10 exams");
    }
  });

  it("reaches listed students' parents, and nobody else's", async () => {
    await saveNotice(
      adminOf(schoolA),
      notice({ title: "Fee reminder", audience: "PARENTS", scope: "STUDENTS", studentAdmissionNumbers: otherAdmission }),
    );
    expect(await titles(otherParent)).toContain("Fee reminder");
    expect(await titles(parentOf(schoolA))).not.toContain("Fee reminder");
    expect(await titles(otherStudent)).not.toContain("Fee reminder"); // audience is parents
  });

  it("reaches teachers of the targeted section only", async () => {
    await saveNotice(adminOf(schoolA), notice({ title: "10-B staff note", audience: "TEACHERS", scope: "SECTION", sectionId: schoolA.unassignedSectionId }));
    await saveNotice(adminOf(schoolA), notice({ title: "10-A staff note", audience: "TEACHERS", scope: "SECTION", sectionId: schoolA.sectionId }));
    const seen = await titles(teacherOf(schoolA));
    expect(seen).toContain("10-A staff note");
    expect(seen).not.toContain("10-B staff note");
  });

  it("keeps targeted notices off the public website", async () => {
    expect(noticeSchema.safeParse({ title: "x", body: "y", status: "PUBLISHED", audience: "ALL", scope: "SECTION", sectionId: "s", isPublic: "on" }).success).toBe(false);
    await saveNotice(adminOf(schoolA), notice({ title: "Open day", isPublic: "on" }));
    const onSite = (await publicNotices(schoolA.schoolId)).map((row) => row.title);
    expect(onSite).toContain("Open day");
    expect(onSite).not.toContain("Class 10 exams");
  });

  it("refuses targets from another school or unknown admission numbers", async () => {
    await expect(saveNotice(adminOf(schoolA), notice({ title: "x", scope: "SECTION", sectionId: schoolB.sectionId }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const bAdmission = (await prisma.student.findUniqueOrThrow({ where: { id: schoolB.studentIds[0]! } })).admissionNumber + "-B";
    await expect(
      saveNotice(adminOf(schoolA), notice({ title: "x", scope: "STUDENTS", studentAdmissionNumbers: `NOPE1, ${bAdmission}` })),
    ).rejects.toBeInstanceOf(ValidationError);
    // Nothing of school A reaches school B.
    for (const ctx of [adminOf(schoolB), parentOf(schoolB), studentOf(schoolB), teacherOf(schoolB)]) {
      expect(await titles(ctx)).not.toContain("Class 10 exams");
    }
  });
});

describe("alert feeds", () => {
  it("tell a student about a targeted notice and a parent about it through their child", async () => {
    expect((await getStudentAlerts(otherStudent)).some((alert) => alert.title === "Class 10 exams")).toBe(true);
    expect((await getParentAlerts(otherParent)).some((alert) => alert.title === "Fee reminder")).toBe(true);
    expect((await getParentAlerts(parentOf(schoolA))).some((alert) => alert.title === "Fee reminder")).toBe(false);
  });

  it("tell a teacher which exam marks are still to enter", async () => {
    await createExams(
      adminOf(schoolA),
      createExamSchema.parse({
        name: "Unit Exam",
        sectionIds: [schoolA.sectionId],
        startDate: toDateInput(addDays(today(), -3)),
        endDate: toDateInput(addDays(today(), -1)),
        papers: [{ subjectId: schoolA.subjectId, maxMarks: "50" }],
      }),
    );
    const alerts = await getTeacherAlerts(teacherOf(schoolA));
    expect(alerts.some((alert) => alert.kind === "marks-due" && alert.title.includes("Unit Exam"))).toBe(true);
    expect((await getTeacherAlerts(teacherOf(schoolB))).some((alert) => alert.kind === "marks-due")).toBe(false);
  });
});
