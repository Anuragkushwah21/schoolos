/**
 * The Document Center: certificates, letters, ID cards and marksheets built
 * from existing records only; issue vs generate, numbering, supersede and
 * revoke; TC eligibility and review; employment and salary documents limited
 * to the School Admin; bulk runs with skips and safe retries; signatures;
 * and isolation between schools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/prisma";
import { buildDocument, bulkCreateDocuments, createDocument, documentSignature, documentsForPrint, documentsOf, listDocuments, revokeDocument } from "@/server/documents/service";
import { saveDocumentSettings, saveSignature } from "@/server/documents/settings";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { pngFile } from "../helpers/image";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let principalId: string;
let staffId: string;
const year = today().getUTCFullYear();
const admin = () => adminOf(schoolA);
const principal = () => contextFor(schoolA, principalId, "PRINCIPAL");
const student = () => schoolA.studentIds[0]!;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  principalId = (await prisma.user.create({ data: { email: "principal@docs.test", passwordHash: "x", role: "PRINCIPAL", firstName: "Asha", lastName: "Rao", schoolId: schoolA.schoolId } })).id;
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { principalName: "Asha Rao", optionalModules: ["FINANCE", "EXPENSES", "PAYROLL"] } });
  await prisma.student.update({ where: { id: student() }, data: { dateOfBirth: new Date("2012-04-05"), admissionDate: new Date("2020-04-01") } });
  await prisma.teacher.update({ where: { id: schoolA.teacherId }, data: { designation: "TGT Mathematics", joiningDate: new Date("2019-06-01") } });
  staffId = (await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, employeeId: "DOC-S1", firstName: "Ravi", lastName: "Kumar", role: "ACCOUNTANT", designation: "Accountant", joiningDate: new Date("2021-01-04") } })).id;
}, 60_000);

afterAll(async () => {
  await prisma.issuedDocument.deleteMany({ where: { schoolId: { in: [schoolA.schoolId, schoolB.schoolId] } } });
  await prisma.teacherSalary.deleteMany({ where: { schoolId: schoolA.schoolId } });
  await prisma.statusChange.deleteMany({ where: { schoolId: schoolA.schoolId } });
  await prisma.assessmentResult.deleteMany({ where: { schoolId: schoolA.schoolId } });
  await prisma.assessment.deleteMany({ where: { schoolId: schoolA.schoolId } });
  await prisma.exam.deleteMany({ where: { schoolId: schoolA.schoolId } });
  await prisma.staffMember.deleteMany({ where: { id: staffId } });
  await prisma.user.deleteMany({ where: { id: principalId } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
}, 60_000);

describe("student certificates", () => {
  it("a bonafide certificate is built from the records, issued with the next number, and a second one supersedes only when asked", async () => {
    const preview = await buildDocument(principal(), { type: "BONAFIDE_CERTIFICATE", kind: "STUDENT", personId: student() });
    expect(preview.missing).toEqual([]);
    expect(preview.content.body[0]).toMatch(/is a bonafide student of Isolation Test School A/);
    expect(preview.content.signatory).toMatchObject({ role: "PRINCIPAL", name: "Asha Rao" });
    // Previewing saves nothing.
    expect(await prisma.issuedDocument.count({ where: { studentId: student() } })).toBe(0);

    const first = await createDocument(principal(), { type: "BONAFIDE_CERTIFICATE", kind: "STUDENT", personId: student(), params: { purpose: "a bank account" } });
    expect(first.number).toBe(`BC/${year}/0001`);
    await expect(createDocument(principal(), { type: "BONAFIDE_CERTIFICATE", kind: "STUDENT", personId: student() })).rejects.toThrow(/already issued.*Issue again/);
    const second = await createDocument(principal(), { type: "BONAFIDE_CERTIFICATE", kind: "STUDENT", personId: student(), reissue: true });
    expect(second.number).toBe(`BC/${year}/0002`);
    expect(await prisma.issuedDocument.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "SUPERSEDED", supersededById: second.id });
    expect((await documentsOf(admin(), "STUDENT", student())).map((row) => row.status)).toEqual(["ISSUED", "SUPERSEDED"]);
  });

  it("missing required data is listed and blocks issuing; the signatory follows the school's policy", async () => {
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { principalName: null } });
    const built = await buildDocument(admin(), { type: "ENROLLMENT_CONFIRMATION", kind: "STUDENT", personId: student() });
    expect(built.missing.join(" ")).toMatch(/Principal's name is not set/);
    await expect(createDocument(admin(), { type: "ENROLLMENT_CONFIRMATION", kind: "STUDENT", personId: student() })).rejects.toBeInstanceOf(AppError);
    await saveDocumentSettings(admin(), { documentHeaderNote: "Affiliated to CBSE", documentFooterNote: null, adminSignatoryName: "R. Mehta", adminSignatoryTitle: "Managing Director", certificateSignatory: "SCHOOL_ADMIN", employmentSignatory: "SCHOOL_ADMIN", tcApprovalRequired: false });
    const now = await buildDocument(admin(), { type: "ENROLLMENT_CONFIRMATION", kind: "STUDENT", personId: student() });
    expect(now.missing).toEqual([]);
    expect(now.content.signatory).toMatchObject({ role: "SCHOOL_ADMIN", name: "R. Mehta", title: "Managing Director" });
    expect(now.content.school.headerNote).toBe("Affiliated to CBSE");
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { principalName: "Asha Rao", certificateSignatory: "PRINCIPAL" } });
    // Character certificate: the conduct is the issuer's reviewed statement, not assumed.
    expect((await buildDocument(admin(), { type: "CHARACTER_CERTIFICATE", kind: "STUDENT", personId: student() })).missing.join(" ")).toMatch(/State the student's conduct/);
  });

  it("an attendance certificate counts the register; none marked is refused rather than shown as 0%", async () => {
    const built = await buildDocument(admin(), { type: "ATTENDANCE_CERTIFICATE", kind: "STUDENT", personId: student() });
    // The fixture marks one day for each student.
    expect(built.missing).toEqual([]);
    expect(built.content.fields.find((field) => field.label === "Days marked")?.value).toBe("1");
    const none = await prisma.student.create({ data: { schoolId: schoolA.schoolId, admissionNumber: "DOC-NONE", firstName: "No", lastName: "Marks" } });
    await prisma.studentEnrollment.create({ data: { schoolId: schoolA.schoolId, studentId: none.id, academicSessionId: schoolA.academicSessionId, classId: schoolA.classId, sectionId: schoolA.sectionId, rollNumber: "99" } });
    expect((await buildDocument(admin(), { type: "ATTENDANCE_CERTIFICATE", kind: "STUDENT", personId: none.id })).missing.join(" ")).toMatch(/No attendance has been marked/);
    await prisma.studentEnrollment.deleteMany({ where: { studentId: none.id } });
    await prisma.student.delete({ where: { id: none.id } });
  });

  it("a transfer certificate: only for a student who has left, with every field reviewed and an explicit confirmation", async () => {
    const id = schoolA.studentIds[1]!;
    await prisma.student.update({ where: { id }, data: { dateOfBirth: new Date("2011-02-02"), admissionDate: new Date("2019-04-01") } });
    expect((await buildDocument(admin(), { type: "TRANSFER_CERTIFICATE", kind: "STUDENT", personId: id })).missing.join(" ")).toMatch(/only for a student who has left/);
    await prisma.student.update({ where: { id }, data: { status: "TRANSFERRED" } });
    await prisma.statusChange.create({ data: { schoolId: schoolA.schoolId, person: "STUDENT", kind: "STATUS", studentId: id, fromValue: "ACTIVE", toValue: "TRANSFERRED", effectiveDate: addDays(today(), -3) } });
    const missing = (await buildDocument(admin(), { type: "TRANSFER_CERTIFICATE", kind: "STUDENT", personId: id })).missing.join(" ");
    expect(missing).toMatch(/reason for leaving/);
    expect(missing).toMatch(/conduct/);
    expect(missing).toMatch(/fees and library books are cleared/);
    const params = { reason: "Family moved to Pune", conduct: "Good", duesCleared: true };
    await expect(createDocument(admin(), { type: "TRANSFER_CERTIFICATE", kind: "STUDENT", personId: id, params })).rejects.toThrow(/confirm before issuing/);
    const tc = await createDocument(admin(), { type: "TRANSFER_CERTIFICATE", kind: "STUDENT", personId: id, params, confirmed: true });
    expect(tc.number).toBe(`TC/${year}/0001`);
    const [printed] = await documentsForPrint(admin(), [tc.id]);
    expect(printed!.content.fields.find((field) => field.label === "Reason for leaving")?.value).toBe("Family moved to Pune");
    expect(printed!.content.fields.find((field) => field.label === "Date of leaving")?.value).not.toBe("—");
    // What was issued stays as issued, even if the record changes.
    await prisma.student.update({ where: { id }, data: { firstName: "Renamed" } });
    expect((await documentsForPrint(admin(), [tc.id]))[0]!.content.person.name).not.toMatch(/Renamed/);
  });

  it("a marksheet comes only from a published examination's results", async () => {
    const exam = await prisma.exam.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, sectionId: schoolA.sectionId, name: "DOC Half yearly", startDate: addDays(today(), -10), endDate: addDays(today(), -8), status: "DRAFT" } });
    const paper = await prisma.assessment.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, examId: exam.id, name: "Mathematics", date: addDays(today(), -9), maxMarks: 80, marksStatus: "SUBMITTED" } });
    await prisma.assessmentResult.createMany({ data: schoolA.studentIds.map((studentId, index) => ({ schoolId: schoolA.schoolId, assessmentId: paper.id, studentId, marksObtained: 60 + index })) });
    expect((await buildDocument(admin(), { type: "MARKSHEET", kind: "STUDENT", personId: student(), params: {} })).missing).toContain("Choose the examination.");
    expect((await buildDocument(admin(), { type: "MARKSHEET", kind: "STUDENT", personId: student(), params: { examId: exam.id } })).missing.join(" ")).toMatch(/not published yet/);
    await prisma.exam.update({ where: { id: exam.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    const built = await buildDocument(admin(), { type: "MARKSHEET", kind: "STUDENT", personId: student(), params: { examId: exam.id } });
    expect(built.missing).toEqual([]);
    expect(built.content.table?.rows[0]).toEqual(["Mathematics", "80", expect.any(String), "60", expect.any(String)]);
    expect(built.content.table?.foot[0]?.[3]).toBe("60");
    const made = await createDocument(admin(), { type: "MARKSHEET", kind: "STUDENT", personId: student(), params: { examId: exam.id } });
    expect(made.number).toBeNull();
    expect((await prisma.issuedDocument.findUniqueOrThrow({ where: { id: made.id } })).status).toBe("GENERATED");
  });
});

describe("teacher and staff documents", () => {
  it("only documents that fit the person's employment, from their records", async () => {
    const letter = await createDocument(admin(), { type: "APPOINTMENT_LETTER", kind: "TEACHER", personId: schoolA.teacherId });
    expect(letter.number).toBe(`APL/${year}/0001`);
    expect((await documentsForPrint(admin(), [letter.id]))[0]!.content.body.join(" ")).toMatch(/TGT Mathematics.*1 Jun 2019|TGT Mathematics.*2019/);
    // A current employee has no experience or relieving certificate yet.
    expect((await buildDocument(admin(), { type: "EXPERIENCE_CERTIFICATE", kind: "STAFF", personId: staffId })).missing.join(" ")).toMatch(/employee who has left/);
    await prisma.staffMember.update({ where: { id: staffId }, data: { status: "RESIGNED" } });
    const exit = await buildDocument(admin(), { type: "RELIEVING_LETTER", kind: "STAFF", personId: staffId });
    expect(exit.missing.join(" ")).toMatch(/last working date is not recorded/);
    const relieved = await createDocument(admin(), { type: "RELIEVING_LETTER", kind: "STAFF", personId: staffId, params: { exitDate: addDays(today(), -1) } });
    expect(relieved.number).toBe(`REL/${year}/0001`);
    await prisma.staffMember.update({ where: { id: staffId }, data: { status: "ACTIVE" } });
    // Student documents are not offered for staff.
    await expect(buildDocument(admin(), { type: "TRANSFER_CERTIFICATE", kind: "STAFF", personId: staffId })).rejects.toBeInstanceOf(AppError);
  });

  it("employment and salary documents are the School Admin's; the salary comes from the salary record", async () => {
    await expect(buildDocument(principal(), { type: "APPOINTMENT_LETTER", kind: "TEACHER", personId: schoolA.teacherId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createDocument(principal(), { type: "SALARY_CERTIFICATE", kind: "STAFF", personId: staffId })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await buildDocument(admin(), { type: "SALARY_CERTIFICATE", kind: "STAFF", personId: staffId })).missing.join(" ")).toMatch(/No salary structure/);
    await prisma.teacherSalary.create({ data: { schoolId: schoolA.schoolId, staffMemberId: staffId, amountMinor: 25_000_00, allowancesMinor: 5_000_00, deductionsMinor: 2_000_00, effectiveFrom: addDays(today(), -60) } });
    const salary = await buildDocument(admin(), { type: "SALARY_CERTIFICATE", kind: "STAFF", personId: staffId });
    expect(salary.content.fields.find((field) => field.label === "Net")?.value).toMatch(/28,000/);
    // The Principal can still make a staff ID card.
    expect((await createDocument(principal(), { type: "STAFF_ID_CARD", kind: "STAFF", personId: staffId })).number).toBeNull();
    // Without the payroll module, no salary certificate at all.
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { optionalModules: ["FINANCE", "EXPENSES"] } });
    await expect(buildDocument(admin(), { type: "SALARY_CERTIFICATE", kind: "STAFF", personId: staffId })).rejects.toThrow(/Payroll is not part of your school's plan/);
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { optionalModules: ["FINANCE", "EXPENSES", "PAYROLL"] } });
    // The Principal's register leaves employment documents out.
    expect((await listDocuments(principal())).some((row) => row.type === "APPOINTMENT_LETTER")).toBe(false);
    expect((await listDocuments(admin())).some((row) => row.type === "APPOINTMENT_LETTER")).toBe(true);
  });
});

describe("revoking, bulk runs, signatures and isolation", () => {
  it("revoking keeps the record with its reason", async () => {
    const doc = await createDocument(admin(), { type: "CHARACTER_CERTIFICATE", kind: "STUDENT", personId: student(), params: { conduct: "Good" } });
    await expect(revokeDocument(admin(), doc.id, " ")).rejects.toBeInstanceOf(AppError);
    await revokeDocument(admin(), doc.id, "Issued with the wrong purpose");
    expect(await prisma.issuedDocument.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ status: "REVOKED", revokeReason: "Issued with the wrong purpose" });
    await expect(revokeDocument(admin(), doc.id, "again")).rejects.toBeInstanceOf(ConflictError);
  });

  it("a bulk run makes what it can, skips with reasons, and a retry never makes a second copy", async () => {
    const people = [...schoolA.studentIds, schoolB.studentIds[0]!];
    const first = await bulkCreateDocuments(admin(), { type: "STUDENT_ID_CARD", kind: "STUDENT", personIds: people, batchKey: "batch-docs-1" });
    // The second fixture student was marked transferred above: not a current student.
    expect(first.created).toBe(schoolA.studentIds.length - 1);
    expect(first.skipped.map((row) => row.reason).join(" ")).toMatch(/not a current student/);
    expect(first.skipped.map((row) => row.reason).join(" ")).toMatch(/not found/);
    const retry = await bulkCreateDocuments(admin(), { type: "STUDENT_ID_CARD", kind: "STUDENT", personIds: people, batchKey: "batch-docs-1" });
    expect(retry).toMatchObject({ created: 0, repeated: schoolA.studentIds.length - 1 });
    expect(await prisma.issuedDocument.count({ where: { batchKey: "batch-docs-1" } })).toBe(schoolA.studentIds.length - 1);
    expect((await documentsForPrint(admin(), first.documentIds)).length).toBe(first.documentIds.length);
    await expect(bulkCreateDocuments(admin(), { type: "TRANSFER_CERTIFICATE", kind: "STUDENT", personIds: people, batchKey: "batch-docs-2" })).rejects.toThrow(/one at a time/);
  });

  it("signature images are private: kept with the document, served only to this school's leaders", async () => {
    await expect(saveSignature(principal(), "PRINCIPAL", pngFile())).rejects.toBeInstanceOf(ForbiddenError);
    await saveSignature(admin(), "PRINCIPAL", pngFile());
    const doc = await createDocument(admin(), { type: "ENROLLMENT_CONFIRMATION", kind: "STUDENT", personId: student() });
    const key = await documentSignature(admin(), doc.id);
    expect(key).toMatch(new RegExp(`^${schoolA.schoolId}/`));
    expect((await documentsForPrint(principal(), [doc.id]))[0]!.hasSignatureImage).toBe(true);
    // Another school: not found — the document, its signature, its person.
    await expect(documentsForPrint(adminOf(schoolB), [doc.id])).rejects.toBeInstanceOf(NotFoundError);
    await expect(documentSignature(adminOf(schoolB), doc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createDocument(adminOf(schoolB), { type: "BONAFIDE_CERTIFICATE", kind: "STUDENT", personId: student() })).rejects.toBeInstanceOf(NotFoundError);
    // Teachers, parents and students cannot use the Document Center.
    await expect(buildDocument(teacherOf(schoolA), { type: "STUDENT_ID_CARD", kind: "STUDENT", personId: student() })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(documentsForPrint(contextFor(schoolA, schoolA.parentUserId, "PARENT"), [doc.id])).rejects.toBeInstanceOf(ForbiddenError);
  });
});
