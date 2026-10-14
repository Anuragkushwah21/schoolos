/**
 * Document designs: the Principal's employment record and documents (School
 * Admin only), the service certificate, letters with an addressee, ID cards
 * per role with a back side, and the transfer certificate's optional
 * second-leader approval.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError } from "@/lib/errors";
import { prisma } from "@/server/db/prisma";
import { approveDocument, buildDocument, createDocument, documentSamples, documentsOf, listDocuments, rejectDocument } from "@/server/documents/service";
import { getPrincipal, savePrincipalProfile } from "@/server/people/principals";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let principalId: string;
let staffId: string;
const year = today().getUTCFullYear();
const admin = () => adminOf(schoolA);
const principal = () => contextFor(schoolA, principalId, "PRINCIPAL");
const blank = { employeeId: null, designation: null, qualification: null, experience: null, appointmentDate: null, joiningDate: null, exitDate: null, dateOfBirth: null, addressLine: null, city: null, state: null, postalCode: null };

beforeAll(async () => {
  ({ schoolA } = await createIsolationFixture());
  principalId = (await prisma.user.create({ data: { email: "principal@designs.test", passwordHash: "x", role: "PRINCIPAL", firstName: "Rajesh", lastName: "Mehta", schoolId: schoolA.schoolId } })).id;
  await prisma.school.update({ where: { id: schoolA.schoolId }, data: { principalName: "Rajesh Mehta", adminSignatoryName: "S. Kapoor", adminSignatoryTitle: "Managing Director", employmentSignatory: "SCHOOL_ADMIN" } });
  await prisma.teacher.update({ where: { id: schoolA.teacherId }, data: { designation: "TGT Mathematics", joiningDate: new Date("2019-06-01") } });
  staffId = (await prisma.staffMember.create({ data: { schoolId: schoolA.schoolId, employeeId: "DSN-S1", firstName: "Amit", lastName: "Kumar", role: "LIBRARIAN", designation: "Librarian", department: "Library", joiningDate: new Date("2020-08-18") } })).id;
}, 60_000);

afterAll(async () => {
  await prisma.issuedDocument.deleteMany({ where: { schoolId: schoolA.schoolId } });
  await prisma.principalProfile.deleteMany({ where: { schoolId: schoolA.schoolId } });
  await prisma.statusChange.deleteMany({ where: { schoolId: schoolA.schoolId } });
  await prisma.staffMember.deleteMany({ where: { id: staffId } });
  await prisma.user.deleteMany({ where: { id: principalId } });
  await destroyIsolationFixture();
  await prisma.$disconnect();
}, 60_000);

describe("the Principal's employment record and documents", () => {
  it("the School Admin keeps the record; documents need it, and only the School Admin makes them", async () => {
    expect((await getPrincipal(admin(), principalId)).profile).toBeNull();
    await expect(savePrincipalProfile(principal(), principalId, blank)).rejects.toBeInstanceOf(ForbiddenError);
    // An employee ID already used by staff is refused.
    await expect(savePrincipalProfile(admin(), principalId, { ...blank, employeeId: "DSN-S1" })).rejects.toBeInstanceOf(ConflictError);
    const { id: profileId } = await savePrincipalProfile(admin(), principalId, { ...blank, appointmentDate: new Date("2018-03-15"), joiningDate: new Date("2018-04-01"), qualification: "M.A., B.Ed." });
    // No employee ID yet: listed as missing, never invented.
    expect((await buildDocument(admin(), { type: "STAFF_ID_CARD", kind: "PRINCIPAL", personId: profileId })).missing.join(" ")).toMatch(/employee ID is not set/);
    await savePrincipalProfile(admin(), principalId, { ...blank, employeeId: "PRN-001", appointmentDate: new Date("2018-03-15"), joiningDate: new Date("2018-04-01") });

    const card = await buildDocument(admin(), { type: "STAFF_ID_CARD", kind: "PRINCIPAL", personId: profileId });
    expect(card.missing).toEqual([]);
    expect(card.content).toMatchObject({ title: "Principal identity card", person: { kind: "PRINCIPAL", name: "Rajesh Mehta", idValue: "PRN-001" } });
    expect(card.content.back).toEqual([{ label: "Date of joining", value: expect.stringMatching(/2018/) }]);
    // The Principal's own documents are signed by the School Admin, whatever the school's usual signatory.
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { employmentSignatory: "PRINCIPAL", certificateSignatory: "PRINCIPAL" } });
    expect((await buildDocument(admin(), { type: "STAFF_ID_CARD", kind: "PRINCIPAL", personId: profileId })).content.signatory).toMatchObject({ role: "SCHOOL_ADMIN", name: "S. Kapoor" });
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { employmentSignatory: "SCHOOL_ADMIN" } });

    const letter = await createDocument(admin(), { type: "APPOINTMENT_LETTER", kind: "PRINCIPAL", personId: profileId });
    expect(letter.number).toBe(`APL/${year}/0001`);
    expect((await documentsOf(admin(), "PRINCIPAL", profileId)).map((row) => row.principalProfileId)).toEqual([profileId]);

    // The Principal makes none of their own documents and does not see them on the register.
    await expect(buildDocument(principal(), { type: "STAFF_ID_CARD", kind: "PRINCIPAL", personId: profileId })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listDocuments(principal())).some((row) => row.principalProfileId)).toBe(false);
    // No payroll record is kept for the Principal: no salary certificate is made up.
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { optionalModules: ["PAYROLL"] } });
    await expect(buildDocument(admin(), { type: "SALARY_CERTIFICATE", kind: "PRINCIPAL", personId: profileId })).rejects.toThrow(/No payroll record is kept for the Principal/);
  });
});

describe("employment documents", () => {
  it("a service certificate says 'continues in service' for a current employee and gives the end date for one who has left", async () => {
    const serving = await buildDocument(admin(), { type: "SERVICE_CERTIFICATE", kind: "TEACHER", personId: schoolA.teacherId });
    expect(serving.missing).toEqual([]);
    expect(serving.content.body[0]).toMatch(/continues in service/);
    expect(serving.content.fields.find((field) => field.label === "Status")?.value).toBe("Serving");
    const made = await createDocument(admin(), { type: "SERVICE_CERTIFICATE", kind: "TEACHER", personId: schoolA.teacherId });
    expect(made.number).toBe(`SRV/${year}/0001`);

    await prisma.staffMember.update({ where: { id: staffId }, data: { status: "RESIGNED" } });
    expect((await buildDocument(admin(), { type: "SERVICE_CERTIFICATE", kind: "STAFF", personId: staffId })).missing.join(" ")).toMatch(/last working date is not recorded/);
    const former = await buildDocument(admin(), { type: "SERVICE_CERTIFICATE", kind: "STAFF", personId: staffId, params: { exitDate: addDays(today(), -2) } });
    expect(former.content.body[0]).toMatch(/served .* from .* to /);
    expect(former.content.fields.find((field) => field.label === "Status")?.value).toBe("Former employee");
  });

  it("letters are addressed: an appointment letter asks for an acknowledgement, a relieving letter does not", async () => {
    const appointment = await buildDocument(admin(), { type: "APPOINTMENT_LETTER", kind: "TEACHER", personId: schoolA.teacherId });
    expect(appointment.content.letter).toMatchObject({ subject: "Appointment as TGT Mathematics", acknowledgement: true });
    expect(appointment.content.letter?.to[0]).toBe("Fixture Teacher");
    const relieving = await buildDocument(admin(), { type: "RELIEVING_LETTER", kind: "STAFF", personId: staffId, params: { exitDate: addDays(today(), -2) } });
    expect(relieving.content.title).toBe("Relieving letter");
    expect(relieving.content.letter).toMatchObject({ subject: "Relieving from service" });
    expect(relieving.content.letter?.acknowledgement).toBeUndefined();
    // The department is printed from the record.
    expect(relieving.content.fields.find((field) => field.label === "Department")?.value).toBe("Library");
    await prisma.staffMember.update({ where: { id: staffId }, data: { status: "ACTIVE" } });
  });

  it("ID cards are titled by role; the student card keeps the guardian's number for the back", async () => {
    const teacher = await buildDocument(admin(), { type: "STAFF_ID_CARD", kind: "TEACHER", personId: schoolA.teacherId });
    expect(teacher.content.title).toBe("Teacher identity card");
    expect((await buildDocument(admin(), { type: "STAFF_ID_CARD", kind: "STAFF", personId: staffId })).content.title).toBe("Staff identity card");
    const student = await buildDocument(admin(), { type: "STUDENT_ID_CARD", kind: "STUDENT", personId: schoolA.studentIds[0]! });
    expect(student.content.fields.map((field) => field.label)).toContain("Session");
    expect(student.content.fields.map((field) => field.label)).not.toContain("Guardian");
    expect(student.content.back?.[0]?.label).toBe("Guardian contact");
  });

  it("the settings preview uses the school's letterhead and a made-up person, and is School Admin only", async () => {
    const samples = await documentSamples(admin());
    expect(samples.tc.school.name).toBe("Isolation Test School A");
    expect(samples.studentCard.person.name).toBe("Sample Student");
    expect(samples.letter.letter?.acknowledgement).toBe(true);
    await expect(documentSamples(principal())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("missing images are said before issuing", () => {
  it("no logo and no signature image are warnings on the preview — not blockers, never invented", async () => {
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { logoUrl: null } });
    const built = await buildDocument(admin(), { type: "BONAFIDE_CERTIFICATE", kind: "STUDENT", personId: schoolA.studentIds[0]! });
    expect(built.warnings.join(" ")).toMatch(/No school logo is set/);
    expect(built.warnings.join(" ")).toMatch(/No signature image for the Principal/);
    expect(built.content.signatory.hasSignature).toBe(false);
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { logoUrl: "https://example.test/logo.png" } });
    expect((await buildDocument(admin(), { type: "BONAFIDE_CERTIFICATE", kind: "STUDENT", personId: schoolA.studentIds[0]! })).warnings.join(" ")).not.toMatch(/No school logo/);
    // Another school's student is simply not found.
    await expect(buildDocument(admin(), { type: "STUDENT_ID_CARD", kind: "STUDENT", personId: "cross-school-id" })).rejects.toThrow(/not found/);
  });
});

describe("admit card and the TC's particulars", () => {
  it("an admit card lists the exam's papers for a current student of that class; another class is refused", async () => {
    const exam = await prisma.exam.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, sectionId: schoolA.sectionId, name: "DSN Mid-term", startDate: addDays(today(), 10), endDate: addDays(today(), 12), status: "DRAFT" } });
    expect((await buildDocument(admin(), { type: "ADMIT_CARD", kind: "STUDENT", personId: schoolA.studentIds[0]!, params: { examId: exam.id } })).missing.join(" ")).toMatch(/no papers scheduled/);
    await prisma.assessment.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, sectionId: schoolA.sectionId, subjectId: schoolA.subjectId, examId: exam.id, name: "Paper 1", date: addDays(today(), 10), maxMarks: 80 } });
    const card = await buildDocument(principal(), { type: "ADMIT_CARD", kind: "STUDENT", personId: schoolA.studentIds[0]!, params: { examId: exam.id } });
    expect(card.missing).toEqual([]);
    expect(card.content.title).toBe("Admit card — DSN Mid-term");
    expect(card.content.table?.rows[0]?.[3]).toBe("80");
    // The invigilator's column is left blank for handwriting.
    expect(card.content.table?.rows[0]?.[4]).toBe("");
    const made = await createDocument(principal(), { type: "ADMIT_CARD", kind: "STUDENT", personId: schoolA.studentIds[0]!, params: { examId: exam.id } });
    expect(made.number).toBeNull();
    const other = await prisma.exam.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, sectionId: schoolA.unassignedSectionId, name: "DSN Other", startDate: addDays(today(), 10), endDate: addDays(today(), 12) } });
    expect((await buildDocument(admin(), { type: "ADMIT_CARD", kind: "STUDENT", personId: schoolA.studentIds[0]!, params: { examId: other.id } })).missing.join(" ")).toMatch(/not in the class this examination is for/);
    await prisma.issuedDocument.deleteMany({ where: { type: "ADMIT_CARD" } });
    await prisma.assessment.deleteMany({ where: { examId: { in: [exam.id, other.id] } } });
    await prisma.exam.deleteMany({ where: { id: { in: [exam.id, other.id] } } });
  });
});

describe("transfer certificate approval", () => {
  it("when the school asks for it, a TC waits for a second leader: no number until approved, never approved by the one who asked", async () => {
    const id = schoolA.studentIds[1]!;
    await prisma.student.update({ where: { id }, data: { status: "TRANSFERRED", dateOfBirth: new Date("2011-02-02"), admissionDate: new Date("2019-04-01") } });
    await prisma.statusChange.create({ data: { schoolId: schoolA.schoolId, person: "STUDENT", kind: "STATUS", studentId: id, fromValue: "ACTIVE", toValue: "TRANSFERRED", effectiveDate: addDays(today(), -3) } });
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { tcApprovalRequired: true } });
    const params = { reason: "Family moved", conduct: "Good", duesCleared: true };

    const asked = await createDocument(admin(), { type: "TRANSFER_CERTIFICATE", kind: "STUDENT", personId: id, params, confirmed: true });
    expect(asked.number).toBeNull();
    expect(await prisma.issuedDocument.findUniqueOrThrow({ where: { id: asked.id } })).toMatchObject({ status: "PENDING_APPROVAL", number: null, issuedById: null });
    await expect(createDocument(admin(), { type: "TRANSFER_CERTIFICATE", kind: "STUDENT", personId: id, params, confirmed: true })).rejects.toThrow(/already waiting for approval/);
    await expect(approveDocument(admin(), asked.id)).rejects.toThrow(/different leader/);

    // Turned down: kept with the reason.
    await rejectDocument(principal(), asked.id, "Leaving date to be checked");
    expect(await prisma.issuedDocument.findUniqueOrThrow({ where: { id: asked.id } })).toMatchObject({ status: "REVOKED", revokeReason: "Not approved: Leaving date to be checked" });
    await expect(approveDocument(principal(), asked.id)).rejects.toBeInstanceOf(ConflictError);

    // Asked again and approved by the other leader: numbered and issued.
    const again = await createDocument(admin(), { type: "TRANSFER_CERTIFICATE", kind: "STUDENT", personId: id, params, confirmed: true });
    // Particulars come from the records of the last class — subjects taught there, its register.
    const particulars = (await prisma.issuedDocument.findUniqueOrThrow({ where: { id: again.id } })).content as { fields: Array<{ label: string; value: string }> };
    expect(particulars.fields.map((field) => field.label)).toEqual(expect.arrayContaining(["Subjects studied", "Working days / days present"]));
    const approved = await approveDocument(principal(), again.id);
    expect(approved.number).toBe(`TC/${year}/0001`);
    expect(await prisma.issuedDocument.findUniqueOrThrow({ where: { id: again.id } })).toMatchObject({ status: "ISSUED", number: `TC/${year}/0001`, approvedById: principalId, issuedById: principalId });
    await expect(rejectDocument(principal(), again.id, "late")).rejects.toBeInstanceOf(ConflictError);

    // Without the setting, the TC is issued directly (with its confirmation).
    await prisma.school.update({ where: { id: schoolA.schoolId }, data: { tcApprovalRequired: false } });
    await expect(createDocument(admin(), { type: "TRANSFER_CERTIFICATE", kind: "STUDENT", personId: id, params })).rejects.toThrow(/confirm before issuing/);
    const direct = await createDocument(admin(), { type: "TRANSFER_CERTIFICATE", kind: "STUDENT", personId: id, params, confirmed: true, reissue: true });
    expect(direct.number).toBe(`TC/${year}/0002`);
    await expect(rejectDocument(admin(), direct.id, " ")).rejects.toBeInstanceOf(AppError);
  });
});
