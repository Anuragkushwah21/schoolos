/**
 * The same child is never added twice without the office deciding.
 *
 *   * Adding a student whose name matches one already at the school stops
 *     with the matches (admission no., class, date of birth, parents, why);
 *     "Add anyway" adds them and the audit log says it was confirmed.
 *   * Same name and same date of birth, or same parent mobile, is "very likely".
 *   * Application and enquiry conversions and the API go through the same check.
 *   * A spreadsheet import leaves possible duplicates out (and catches the same
 *     child twice in one file) unless the office ticks them.
 *   * Students admitted this session are "New", and can be filtered by year.
 *   * Another school's children never match.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";
import { DUPLICATE_FIELD, decodeMatches } from "@/lib/student-duplicates";
import { createStudentSchema } from "@/lib/validation/school";
import { prisma } from "@/server/db/prisma";
import { importStudents } from "@/server/people/bulk-students";
import { admissionYears, createStudent, listStudents } from "@/server/people/students";

import { adminOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let seq = 0;

const input = (overrides: Record<string, string> = {}) => {
  seq += 1;
  return createStudentSchema.parse({
    firstName: "Kabir",
    lastName: "Malhotra",
    dateOfBirth: "2015-06-01",
    sectionId: schoolA.sectionId,
    guardianMode: "new",
    parentFirstName: "Raj",
    parentLastName: `Malhotra${seq}`,
    parentPhone: `+91 91111 ${String(10000 + seq).slice(-5)}`,
    relationship: "FATHER",
    ...overrides,
  });
};

async function duplicateError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return decodeMatches((error as ValidationError).fieldErrors?.[DUPLICATE_FIELD]);
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("adding a student", () => {
  let firstId: string;

  it("the first Kabir Malhotra is added; a second with the same name and birthday is stopped as very likely the same", async () => {
    const first = await createStudent(adminOf(schoolA), input());
    firstId = first.studentId;
    const matches = await duplicateError(createStudent(adminOf(schoolA), input()));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ id: firstId, admissionNumber: first.admissionNumber, likely: true, dateOfBirth: "2015-06-01" });
    expect(matches[0]!.reasons).toEqual(["same name", "same date of birth"]);
    expect(matches[0]!.group).toBeTruthy();
    expect(matches[0]!.parents[0]).toMatch(/Raj Malhotra/);
    expect(await prisma.student.count({ where: { schoolId: schoolA.schoolId, firstName: "Kabir" } })).toBe(1);
  });

  it("same name with a different birthday still warns (not 'very likely'); case and spaces do not hide it", async () => {
    const matches = await duplicateError(createStudent(adminOf(schoolA), input({ firstName: "  kabir", lastName: "MALHOTRA ", dateOfBirth: "2016-01-01" })));
    expect(matches[0]).toMatchObject({ likely: false });
    expect(matches[0]!.reasons).toContain("different date of birth");
  });

  it("the same parent mobile makes it very likely", async () => {
    const parentPhone = (await prisma.parent.findFirstOrThrow({ where: { children: { some: { studentId: firstId } } } })).phone;
    const matches = await duplicateError(createStudent(adminOf(schoolA), input({ dateOfBirth: "", parentPhone, confirmNewParent: "on" })));
    expect(matches[0]!.reasons).toContain("same parent mobile");
    expect(matches[0]!.likely).toBe(true);
  });

  it("'Add anyway' adds the child, and the audit log records that the office confirmed it", async () => {
    const twin = await createStudent(adminOf(schoolA), input({ dateOfBirth: "2016-01-01", confirmDuplicate: "on" }));
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, action: "STUDENT_CREATED", entityId: twin.studentId } });
    expect(audit.summary).toMatch(/confirmed as a different child: Kabir Malhotra \(ADM-/);
    expect(audit.metadata).toMatchObject({ confirmedDuplicateOf: [expect.stringMatching(/^ADM-/)] });
  });

  it("a different name is added without any warning", async () => {
    await expect(createStudent(adminOf(schoolA), input({ firstName: "Meher" }))).resolves.toHaveProperty("studentId");
  });

  it("another school's children never match", async () => {
    const sectionB = schoolB.sectionId;
    await expect(createStudent(adminOf(schoolB), input({ sectionId: sectionB }))).resolves.toHaveProperty("studentId");
  });
});

describe("spreadsheet import", () => {
  const csv = (rows: string[]) =>
    ["Admission no.,First name,Last name,Gender,Date of birth,Class,Section,Stream,Roll no.,Guardian first name,Guardian last name,Guardian phone,Guardian email,Relationship", ...rows].join("\n");

  it("previews possible duplicates (on file and within the file) and leaves them out unless ticked", async () => {
    const section = await prisma.section.findUniqueOrThrow({ where: { id: schoolA.sectionId }, select: { name: true, class: { select: { name: true } } } });
    const row = (first: string, dob: string, phone: string) => `,${first},Malhotra,Male,${dob},${section.class.name},${section.name},,,Raj,Malhotra,${phone},,Father`;
    const file = csv([row("Kabir", "2015-06-01", "9222200001"), row("Ira", "2014-02-02", "9222200002"), row("Ira", "2014-02-02", "9222200002"), row("Dev", "2013-03-03", "9222200003")]);

    const preview = await importStudents(adminOf(schoolA), file, { mode: "check" });
    expect(preview.errors).toEqual([]);
    expect(preview.duplicates?.map((dup) => dup.line)).toEqual([2, 4]);
    expect(preview.duplicates?.[0]).toMatchObject({ name: "Kabir Malhotra", likely: true, added: false });
    expect(preview.duplicates?.[1]?.matches[0]).toMatch(/row 3 of this file — same name, same date of birth, same parent mobile/);
    expect(preview.valid).toBe(2);

    // Import: the office ticks row 4 (they are twins) but not row 2.
    const done = await importStudents(adminOf(schoolA), file, { mode: "import", validOnly: true, addDuplicateLines: [4] });
    expect(done.created).toBe(3);
    expect(await prisma.student.count({ where: { schoolId: schoolA.schoolId, firstName: "Ira", lastName: "Malhotra" } })).toBe(2);
    expect(await prisma.student.count({ where: { schoolId: schoolA.schoolId, firstName: "Kabir", lastName: "Malhotra" } })).toBe(2);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, action: "STUDENTS_IMPORTED" }, orderBy: { createdAt: "desc" } });
    expect(audit.summary).toMatch(/1 added after the office confirmed them, 1 left out/);
  });
});

describe("old and new students", () => {
  it("students admitted this session are marked New and can be filtered; the year filter finds them too", async () => {
    const all = await listStudents(adminOf(schoolA), { status: "CURRENT" });
    const fresh = await listStudents(adminOf(schoolA), { status: "CURRENT", admitted: "NEW" });
    expect(fresh.rows.every((row) => row.isNew)).toBe(true);
    expect(fresh.rows.some((row) => row.firstName === "Kabir")).toBe(true);
    // The fixture's students have no admission date: old records, not New.
    expect(all.rows.filter((row) => !row.isNew).length).toBeGreaterThan(0);
    const years = await admissionYears(adminOf(schoolA));
    expect(years[0]).toBe(new Date().getUTCFullYear());
    const byYear = await listStudents(adminOf(schoolA), { status: "CURRENT", admitted: years[0] });
    expect(byYear.total).toBe(fresh.total);
  });
});
