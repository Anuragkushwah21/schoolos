/**
 * Public applications: a parent applies for one or more children through the
 * school's admission page — each child their own application, checked on the
 * server (open dates, classes on offer, the stream rule, the school's extra
 * questions). The office moves it submitted → under review → shortlisted →
 * approved, and only then converts it, linking the family's existing parent
 * and never converting twice.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { publicApplicationSchema } from "@/lib/validation/enquiries";
import { createStudentSchema } from "@/lib/validation/school";
import { savePortalSettings } from "@/server/admissions/portal";
import { conversionPlan, convertApplication, getApplication, listApplications, setApplicationArchived, setApplicationStatus, submitApplications } from "@/server/admissions/service";
import { __resetAllRateLimits } from "@/server/auth/rate-limit";
import { prisma } from "@/server/db/prisma";

import { adminOf, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let slugA: string;
let parentDigits: string;
const cls: Record<string, string> = {};
let science: string;
const meta = { ipAddress: "10.9.9.9" };

function apply(children: Array<Record<string, string>>, extra: Record<string, string> = {}) {
  const raw: Record<string, string> = { parentName: "Ramesh Sharma", parentRelationship: "FATHER", parentPhone: "90000 12345", ...extra };
  children.forEach((child, index) => {
    for (const [key, value] of Object.entries(child)) raw[`children.${index}.${key}`] = value;
  });
  return publicApplicationSchema.parse(raw);
}

const portal = (overrides: Record<string, unknown> = {}) => ({
  opensOn: null,
  closesOn: null,
  instructions: null,
  mapUrl: null,
  websiteUrl: null,
  highlights: null,
  classIds: [],
  fields: [],
  ...overrides,
});

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  slugA = (await prisma.school.findUniqueOrThrow({ where: { id: schoolA.schoolId } })).slug;
  parentDigits = (await prisma.parent.findUniqueOrThrow({ where: { id: schoolA.parentId } })).phone.replace(/\D/g, "").slice(-10);
  for (const [name, level] of [["Class 8", 8], ["Class 9", 9], ["Class 11", 11]] as const) {
    cls[name] = (await prisma.class.create({ data: { schoolId: schoolA.schoolId, name, level } })).id;
  }
  science = (await prisma.stream.create({ data: { schoolId: schoolA.schoolId, name: "Science" } })).id;
}, 60_000);

beforeEach(() => __resetAllRateLimits());

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("applying for several children", () => {
  it("makes one application per child, with their own numbers, tied together as a family", async () => {
    const { applicationNumbers } = await submitApplications(
      slugA,
      apply([
        { firstName: "Aarav", lastName: "Sharma", classId: cls["Class 8"]! },
        { firstName: "Anaya", lastName: "Sharma", classId: cls["Class 9"]! },
        { firstName: "Riya", lastName: "Sharma", classId: cls["Class 11"]!, streamId: science },
      ]),
      meta,
    );
    expect(applicationNumbers).toHaveLength(3);
    expect(new Set(applicationNumbers).size).toBe(3);
    expect(applicationNumbers.every((number) => /^APP-\d{4}-\d{5}$/.test(number))).toBe(true);
    const rows = await prisma.admissionApplication.findMany({ where: { applicationNumber: { in: applicationNumbers } } });
    expect(new Set(rows.map((row) => row.familyKey)).size).toBe(1);
    expect(rows[0]!.familyKey).not.toBeNull();
    const listed = (await listApplications(adminOf(schoolA), { q: "Sharma" })).filter((row) => applicationNumbers.includes(row.applicationNumber));
    expect(listed.every((row) => row.siblings === 3 && row.status === "SUBMITTED")).toBe(true);
    const one = await getApplication(adminOf(schoolA), rows[0]!.id);
    expect(one.siblings).toHaveLength(2);
  });

  it("checks the stream rule on the server: required for 11–12, optional for 9–10, none up to 8", async () => {
    await expect(submitApplications(slugA, apply([{ firstName: "R", lastName: "S", classId: cls["Class 11"]! }]), meta)).rejects.toMatchObject({
      fieldErrors: { "children.0.streamId": [expect.stringMatching(/Choose a stream/)] },
    });
    await expect(submitApplications(slugA, apply([{ firstName: "R", lastName: "S", classId: cls["Class 8"]!, streamId: science }]), meta)).rejects.toBeInstanceOf(ValidationError);
    const ok = await submitApplications(slugA, apply([{ firstName: "Nine", lastName: "S", classId: cls["Class 9"]! }, { firstName: "Ten", lastName: "S", classId: schoolA.classId }]), meta);
    expect(ok.applicationNumbers).toHaveLength(2);
    // A class from another school is refused.
    await expect(submitApplications(slugA, apply([{ firstName: "X", lastName: "Y", classId: schoolB.classId }]), meta)).rejects.toBeInstanceOf(ValidationError);
  });

  it("follows the admission page settings: dates, classes on offer and the school's own questions", async () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000);
    await savePortalSettings(adminOf(schoolA), portal({ opensOn: new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate())) }));
    await expect(submitApplications(slugA, apply([{ firstName: "Early", lastName: "S", classId: cls["Class 8"]! }]), meta)).rejects.toBeInstanceOf(AppError);

    await savePortalSettings(adminOf(schoolA), portal({ classIds: [cls["Class 8"]!], fields: [{ label: "Transport needed?", kind: "SELECT", options: "Yes\nNo", required: true }] }));
    await expect(submitApplications(slugA, apply([{ firstName: "Nine", lastName: "S", classId: cls["Class 9"]! }]), meta, { q1: "Yes" })).rejects.toBeInstanceOf(ValidationError);
    await expect(submitApplications(slugA, apply([{ firstName: "Eight", lastName: "S", classId: cls["Class 8"]! }]), meta)).rejects.toMatchObject({ fieldErrors: { "custom.q1": [expect.any(String)] } });
    await expect(submitApplications(slugA, apply([{ firstName: "Eight", lastName: "S", classId: cls["Class 8"]! }]), meta, { q1: "Maybe" })).rejects.toBeInstanceOf(ValidationError);
    const { applicationNumbers } = await submitApplications(slugA, apply([{ firstName: "Eight", lastName: "S", classId: cls["Class 8"]! }]), meta, { q1: "Yes" });
    const row = await prisma.admissionApplication.findFirstOrThrow({ where: { applicationNumber: applicationNumbers[0] } });
    expect(row.customAnswers).toEqual([{ key: "q1", label: "Transport needed?", value: "Yes" }]);

    // Only School A's own admin can change School A's page.
    await expect(savePortalSettings(teacherOf(schoolA), portal())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(savePortalSettings(adminOf(schoolA), portal({ classIds: [schoolB.classId] }))).rejects.toBeInstanceOf(ValidationError);
    await savePortalSettings(adminOf(schoolA), portal());
  });
});

describe("review and conversion", () => {
  it("converts only an approved application, links the existing parent (no duplicate), and never twice", async () => {
    const { applicationNumbers } = await submitApplications(slugA, apply([{ firstName: "Amit", lastName: "Sharma", classId: schoolA.classId }], { parentPhone: "+91 " + parentDigits }), meta);
    const app = await prisma.admissionApplication.findFirstOrThrow({ where: { applicationNumber: applicationNumbers[0] } });
    const input = createStudentSchema.parse({ firstName: "Amit", lastName: "Sharma", sectionId: schoolA.sectionId, guardianMode: "existing", existingParentId: schoolA.parentId, relationship: "FATHER" });

    expect((await conversionPlan(adminOf(schoolA), app.id)).open).toBe(false);
    await expect(convertApplication(adminOf(schoolA), app.id, input, { admissionType: "NEW", confirmNotDuplicate: false })).rejects.toBeInstanceOf(ConflictError);

    for (const status of ["UNDER_REVIEW", "SHORTLISTED", "APPROVED"] as const) {
      await setApplicationStatus(adminOf(schoolA), { applicationId: app.id, status, reviewNotes: null });
      expect((await getApplication(adminOf(schoolA), app.id)).status).toBe(status);
    }
    const plan = await conversionPlan(adminOf(schoolA), app.id);
    expect(plan.open).toBe(true);
    expect(plan.matchingParents.map((row) => row.id)).toEqual([schoolA.parentId]);

    const parentsBefore = await prisma.parent.count({ where: { schoolId: schoolA.schoolId } });
    const result = await convertApplication(adminOf(schoolA), app.id, input, { admissionType: "TRANSFER", confirmNotDuplicate: false });
    expect(await prisma.parent.count({ where: { schoolId: schoolA.schoolId } })).toBe(parentsBefore);
    expect(await prisma.parentStudent.count({ where: { parentId: schoolA.parentId, studentId: result.studentId } })).toBe(1);
    expect(await getApplication(adminOf(schoolA), app.id)).toMatchObject({ status: "CONVERTED", createdStudentId: result.studentId });
    await expect(convertApplication(adminOf(schoolA), app.id, input, { admissionType: "NEW", confirmNotDuplicate: false })).rejects.toBeInstanceOf(ConflictError);
    await expect(setApplicationStatus(adminOf(schoolA), { applicationId: app.id, status: "REJECTED", reviewNotes: null })).rejects.toBeInstanceOf(ConflictError);

    // Decided: it can be archived and restored without losing anything.
    await setApplicationArchived(adminOf(schoolA), app.id, true);
    expect((await listApplications(adminOf(schoolA), { archived: true })).some((row) => row.id === app.id)).toBe(true);
    await setApplicationArchived(adminOf(schoolA), app.id, false);
  });

  it("offers a same-name parent only for checking, refuses a duplicate child unless confirmed, and stays approved after a failed attempt", async () => {
    const fixtureParent = await prisma.parent.findUniqueOrThrow({ where: { id: schoolA.parentId } });
    const { applicationNumbers } = await submitApplications(
      slugA,
      apply([{ firstName: "Amit", lastName: "Sharma", classId: schoolA.classId }], { parentName: `${fixtureParent.firstName} ${fixtureParent.lastName}`, parentPhone: "93456 78901" }),
      meta,
    );
    const app = await prisma.admissionApplication.findFirstOrThrow({ where: { applicationNumber: applicationNumbers[0] } });
    await setApplicationStatus(adminOf(schoolA), { applicationId: app.id, status: "APPROVED", reviewNotes: null });
    const plan = await conversionPlan(adminOf(schoolA), app.id);
    expect(plan.matchingParents).toHaveLength(0);
    expect(plan.nameOnlyParents.map((row) => row.id)).toEqual([schoolA.parentId]);
    expect(plan.possibleDuplicates.length).toBe(1);

    const asNew = createStudentSchema.parse({ firstName: "Amit", lastName: "Sharma", sectionId: schoolA.sectionId, guardianMode: "new", parentFirstName: "Other", parentLastName: "Sharma", parentPhone: "0" + parentDigits, relationship: "FATHER" });
    await expect(convertApplication(adminOf(schoolA), app.id, asNew, { admissionType: "NEW", confirmNotDuplicate: false })).rejects.toBeInstanceOf(ValidationError);
    // Confirmed as a different child, but the "new" parent has the fixture parent's mobile: refused, not duplicated.
    await expect(convertApplication(adminOf(schoolA), app.id, asNew, { admissionType: "NEW", confirmNotDuplicate: true })).rejects.toMatchObject({
      fieldErrors: { parentPhone: [expect.stringMatching(/already a parent at this school/)] },
    });
    expect((await getApplication(adminOf(schoolA), app.id)).status).toBe("APPROVED");
    await expect(convertApplication(teacherOf(schoolA), app.id, asNew, { admissionType: "NEW", confirmNotDuplicate: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(convertApplication(adminOf(schoolB), app.id, asNew, { admissionType: "NEW", confirmNotDuplicate: true })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getApplication(adminOf(schoolB), app.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
