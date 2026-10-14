import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { formatDate, today } from "@/lib/dates";
import { DOCUMENTS, type DocumentContent, type DocumentType, type PersonKind, documentLabel } from "@/lib/documents";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { formatMoney, fullName, humanize } from "@/lib/format";
import { OUTCOME_LABEL } from "@/lib/grades";
import { recordAudit } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/permissions";
import { getReportCard } from "@/server/exams/results";
import { photoUrlFor } from "@/server/people/photos";
import { hasModule } from "@/server/platform/modules";
import { sectionLabel } from "@/server/academics/structure";

/**
 * The Document Center: certificates, letters, ID cards and marksheets for a
 * school's students, teachers and staff, built only from existing records
 * (and inputs the issuer reviews), never invented.
 *
 *   * Preview builds the document and lists what is missing; nothing is saved.
 *   * Generate (ID cards, marksheets) records a printout — no number.
 *   * Issue (certificates, letters) records an official document with the
 *     school's next number and keeps exactly what it said. A second issue of
 *     the same document supersedes the first, only when asked; revoking keeps
 *     the record. Nothing issued is edited or deleted.
 *
 * Who: the School Admin and Principal for student documents and ID cards;
 * employment letters are the School Admin's (the Principal's academic access
 * does not reach them); the salary certificate also needs the payroll module.
 * Printing happens in the browser (Print / Save as PDF), from the stored
 * content, after the same checks.
 */

const CURRENT_STUDENT = ["ACTIVE", "ON_LEAVE"] as const;
const LEFT_STUDENT = ["TRANSFERRED", "WITHDRAWN", "GRADUATED", "INACTIVE"] as const;
const CURRENT_EMPLOYEE = ["ACTIVE", "ON_LEAVE", "SUSPENDED"] as const;
const LEFT_EMPLOYEE = ["RESIGNED", "TERMINATED", "RETIRED", "TRANSFERRED", "INACTIVE"] as const;
const MAX_BULK = 200;

export type DocumentParams = {
  examId?: string | null;
  purpose?: string | null;
  conduct?: string | null;
  reason?: string | null;
  leavingDate?: Date | null;
  exitDate?: Date | null;
  admissionDate?: Date | null;
  duesCleared?: boolean;
  issuedOn?: Date | null;
};

export type Built = { content: DocumentContent; missing: string[]; warnings: string[] };

// -----------------------------------------------------------------------------
// Access
// -----------------------------------------------------------------------------

/** May this person preview (`VIEW`) or make (`EDIT`) this document type? Throws when not. */
export async function assertDocumentAccess(ctx: TenantContext, type: DocumentType, action: "VIEW" | "EDIT", kind?: PersonKind): Promise<void> {
  const meta = DOCUMENTS[type];
  // The Principal's own ID card and letters are the School Admin's to make — never the Principal's.
  if (kind === "PRINCIPAL" && ctx.user.role !== "SCHOOL_ADMIN") throw new ForbiddenError("The Principal's documents are issued by the School Admin.");
  if (kind === "PRINCIPAL" && meta.payroll) throw new ForbiddenError("No payroll record is kept for the Principal in SchoolOS, so there is no salary to certify.");
  if (meta.employment && ctx.user.role !== "SCHOOL_ADMIN") throw new ForbiddenError("Employment documents are issued by the School Admin.");
  if (meta.payroll && !(await hasModule(ctx, "PAYROLL"))) throw new ForbiddenError("Payroll is not part of your school's plan, so there is no salary record to certify.");
  assertCan(ctx, meta.for.includes("STUDENT") ? "students" : "staff", action);
}

// -----------------------------------------------------------------------------
// Branding and signatory
// -----------------------------------------------------------------------------

export async function documentBranding(ctx: TenantContext) {
  const school = await ctx.db.school.findFirst({
    select: {
      name: true, addressLine: true, city: true, state: true, postalCode: true, phone: true, email: true, logoUrl: true, affiliationBoard: true, udiseCode: true,
      receiptHeaderNote: true, documentHeaderNote: true, documentFooterNote: true, principalName: true, adminSignatoryName: true, adminSignatoryTitle: true,
      principalSignatureKey: true, adminSignatureKey: true, certificateSignatory: true, employmentSignatory: true, tcApprovalRequired: true,
    },
  });
  if (!school) throw new NotFoundError();
  return school;
}

function schoolBlock(school: Awaited<ReturnType<typeof documentBranding>>): DocumentContent["school"] {
  return {
    name: school.name,
    address: [school.addressLine, school.city, school.state, school.postalCode].filter(Boolean).join(", ") || null,
    city: school.city,
    phone: school.phone,
    email: school.email,
    logoUrl: school.logoUrl,
    headerNote: school.documentHeaderNote ?? school.receiptHeaderNote,
    footerNote: school.documentFooterNote,
    affiliation: school.affiliationBoard,
    udiseCode: school.udiseCode,
  };
}

/** The signatory the school's policy names for this document, and whether a signature image is on file. */
function signatoryFor(school: Awaited<ReturnType<typeof documentBranding>>, type: DocumentType, kind?: PersonKind): { block: DocumentContent["signatory"]; signatureKey: string | null; missing: string | null } {
  // The Principal never signs their own card or letters: the School Admin does.
  const role = kind === "PRINCIPAL" ? "SCHOOL_ADMIN" : DOCUMENTS[type].employment ? school.employmentSignatory : school.certificateSignatory;
  if (role === "SCHOOL_ADMIN") {
    return { block: { role, name: school.adminSignatoryName, title: school.adminSignatoryTitle || "School Administrator", hasSignature: Boolean(school.adminSignatureKey) }, signatureKey: school.adminSignatureKey, missing: school.adminSignatoryName ? null : "The School Admin signatory's name is not set (Settings → Documents)." };
  }
  return { block: { role, name: school.principalName, title: "Principal", hasSignature: Boolean(school.principalSignatureKey) }, signatureKey: school.principalSignatureKey, missing: school.principalName ? null : "The Principal's name is not set (school profile, under Website)." };
}

// -----------------------------------------------------------------------------
// People
// -----------------------------------------------------------------------------

async function loadStudent(ctx: TenantContext, studentId: string) {
  const student = await ctx.db.student.findFirst({
    where: { id: studentId },
    select: {
      id: true, firstName: true, lastName: true, admissionNumber: true, dateOfBirth: true, gender: true, status: true, admissionDate: true, bloodGroup: true, city: true,
      parents: { orderBy: { isPrimary: "desc" }, select: { relationship: true, parent: { select: { firstName: true, lastName: true, phone: true } } } },
      enrollments: { orderBy: { academicSession: { startDate: "desc" } }, select: { status: true, rollNumber: true, academicSessionId: true, sectionId: true, academicSession: { select: { name: true, isCurrent: true, endDate: true } }, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } } },
      statusChanges: { where: { kind: "STATUS" }, orderBy: { effectiveDate: "desc" }, take: 1, select: { toValue: true, effectiveDate: true } },
    },
  });
  if (!student) throw new NotFoundError("That student was not found.");
  return student;
}

type Employee = {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string | null;
  joiningDate: Date | null;
  status: string;
  designationShown: string;
  /** Department, or for a teacher the subjects they teach this session. */
  department: string | null;
  statusChanges: Array<{ toValue: string; effectiveDate: Date }>;
  photo: { type: "TEACHER" | "STAFF" | "USER"; id: string };
};

async function loadEmployee(ctx: TenantContext, kind: "TEACHER" | "STAFF" | "PRINCIPAL", id: string): Promise<Employee> {
  const changes = { where: { kind: "STATUS" as const }, orderBy: { effectiveDate: "desc" as const }, take: 1, select: { toValue: true, effectiveDate: true } };
  if (kind === "TEACHER") {
    const row = await ctx.db.teacher.findFirst({ where: { id }, select: { id: true, firstName: true, lastName: true, employeeId: true, designation: true, joiningDate: true, status: true, statusChanges: changes, assignments: { where: { academicSession: { isCurrent: true } }, select: { subject: { select: { name: true } } } } } });
    if (!row) throw new NotFoundError("That teacher was not found.");
    const subjects = [...new Set(row.assignments.map((assignment) => assignment.subject.name))];
    return { ...row, designationShown: row.designation || "Teacher", department: subjects.length ? subjects.slice(0, 3).join(", ") : null, photo: { type: "TEACHER", id: row.id } };
  }
  if (kind === "PRINCIPAL") {
    // The Principal: the login holds the name; the employment record holds the rest. Left = a last working day that has passed, or a closed login.
    const row = await ctx.db.principalProfile.findFirst({ where: { id }, select: { id: true, employeeId: true, designation: true, joiningDate: true, exitDate: true, user: { select: { id: true, firstName: true, lastName: true, isActive: true } } } });
    if (!row) throw new NotFoundError("That Principal's record was not found.");
    const left = Boolean(row.exitDate && row.exitDate <= today()) || !row.user.isActive;
    return { id: row.id, firstName: row.user.firstName, lastName: row.user.lastName, employeeId: row.employeeId, joiningDate: row.joiningDate, status: left ? "INACTIVE" : "ACTIVE", designationShown: row.designation || "Principal", department: null, statusChanges: row.exitDate ? [{ toValue: "INACTIVE", effectiveDate: row.exitDate }] : [], photo: { type: "USER", id: row.user.id } };
  }
  const row = await ctx.db.staffMember.findFirst({ where: { id }, select: { id: true, firstName: true, lastName: true, employeeId: true, designation: true, role: true, joiningDate: true, status: true, department: true, statusChanges: changes } });
  if (!row) throw new NotFoundError("That staff member was not found.");
  return { ...row, designationShown: row.designation || humanize(row.role), photo: { type: "STAFF", id: row.id } };
}

const childOf = (gender: string | null | undefined) => (gender === "MALE" ? "son of" : gender === "FEMALE" ? "daughter of" : "child of");
const pronoun = (gender: string | null | undefined) => (gender === "MALE" ? "His" : gender === "FEMALE" ? "Her" : "Their");

// -----------------------------------------------------------------------------
// Building (the preview, and what an issued document keeps)
// -----------------------------------------------------------------------------

/** Build a document for one person from their records and the reviewed inputs. Saves nothing. */
export async function buildDocument(ctx: TenantContext, input: { type: DocumentType; kind: PersonKind; personId: string; params?: DocumentParams }): Promise<Built> {
  const meta = DOCUMENTS[input.type];
  if (!meta.for.includes(input.kind)) throw new AppError("VALIDATION", `${meta.label} is not a document for this person.`);
  await assertDocumentAccess(ctx, input.type, "VIEW", input.kind);
  const params = input.params ?? {};
  const school = await documentBranding(ctx);
  const sign = signatoryFor(school, input.type, input.kind);
  const missing: string[] = [];
  const warnings: string[] = [];
  if (meta.kind === "ISSUED" && sign.missing) missing.push(sign.missing);
  // Not blockers, but said before anything is issued: what will print without an image.
  if (!school.logoUrl) warnings.push("No school logo is set — the letterhead prints the school's initials instead (school profile, under Website).");
  if (!sign.block.hasSignature) warnings.push(`No signature image for the ${sign.block.title} — it prints with a blank line to sign by hand (Settings → Documents).`);
  const base = { school: schoolBlock(school), signatory: sign.block, notes: warnings };

  if (input.kind === "STUDENT") {
    const student = await loadStudent(ctx, input.personId);
    const name = fullName(student);
    const current = student.enrollments.find((row) => row.academicSession.isCurrent && row.status === "ACTIVE") ?? null;
    const last = student.enrollments[0] ?? null;
    const guardian = student.parents[0] ?? null;
    const parentName = guardian ? fullName(guardian.parent) : null;
    const father = student.parents.find((link) => link.relationship === "FATHER") ?? null;
    const mother = student.parents.find((link) => link.relationship === "MOTHER") ?? null;
    const isCurrent = (CURRENT_STUDENT as readonly string[]).includes(student.status);
    const photoUrl = await photoUrlFor(ctx, { type: "STUDENT", id: student.id });
    const person = { kind: "STUDENT" as const, id: student.id, name, idLabel: "Admission no.", idValue: student.admissionNumber, photoUrl };
    const classOf = (row: typeof current) => (row ? sectionLabel(row.section) : "—");
    const dob = student.dateOfBirth ? formatDate(student.dateOfBirth) : null;
    const needCurrent = () => {
      if (!isCurrent) missing.push(`${name} is not a current student (status: ${humanize(student.status)}).`);
      if (!current) missing.push(`${name} is not placed in a class this session.`);
    };
    const needParent = () => { if (!parentName) missing.push("No parent or guardian is recorded."); };
    const purpose = params.purpose ? [`This certificate is issued for the purpose of ${params.purpose}.`] : [];

    switch (input.type) {
      case "STUDENT_ID_CARD": {
        needCurrent();
        if (!photoUrl) warnings.push("No photo on file — the card prints without one.");
        return {
          content: {
            ...base,
            title: "Student identity card",
            person,
            fields: [{ label: "Class", value: classOf(current) }, ...(current?.rollNumber ? [{ label: "Roll no.", value: current.rollNumber }] : []), { label: "Session", value: current?.academicSession.name ?? "—" }, ...(student.bloodGroup ? [{ label: "Blood group", value: student.bloodGroup }] : [])],
            back: [...(guardian?.parent.phone ? [{ label: "Guardian contact", value: `${guardian.parent.phone} (${humanize(guardian.relationship)})` }] : []), ...(dob ? [{ label: "Date of birth", value: dob }] : [])],
            body: [],
            validUntil: current ? formatDate(current.academicSession.endDate) : null,
          },
          missing,
          warnings,
        };
      }
      case "BONAFIDE_CERTIFICATE":
      case "ENROLLMENT_CONFIRMATION": {
        needCurrent();
        if (input.type === "BONAFIDE_CERTIFICATE") needParent();
        const body =
          input.type === "BONAFIDE_CERTIFICATE"
            ? [`This is to certify that ${name}, ${childOf(student.gender)} ${parentName ?? "—"}, is a bonafide student of ${school.name}, studying in ${classOf(current)} in the academic session ${current?.academicSession.name ?? "—"}.`, ...(dob ? [`${pronoun(student.gender)} date of birth as per the school's records is ${dob}.`] : []), ...purpose]
            : [`This is to confirm that ${name} (admission no. ${student.admissionNumber}) is enrolled at ${school.name}${student.admissionDate ? `, admitted on ${formatDate(student.admissionDate)}` : ""}, and is in ${classOf(current)} for the academic session ${current?.academicSession.name ?? "—"}.`, ...purpose];
        if (input.type === "ENROLLMENT_CONFIRMATION" && !student.admissionDate) warnings.push("No admission date on record — the confirmation leaves it out.");
        return { content: { ...base, title: meta.label.replace("Admission / enrollment", "Enrollment"), person, fields: [{ label: "Admission no.", value: student.admissionNumber }, { label: "Class", value: classOf(current) }, ...(current?.rollNumber ? [{ label: "Roll no.", value: current.rollNumber }] : []), { label: "Session", value: current?.academicSession.name ?? "—" }], body }, missing, warnings };
      }
      case "CHARACTER_CERTIFICATE": {
        needParent();
        if (!params.conduct?.trim()) missing.push("State the student's conduct (for example “Good”).");
        const period = `${student.admissionDate ? `from ${formatDate(student.admissionDate)}` : ""}${isCurrent ? " to date" : student.statusChanges[0] ? ` to ${formatDate(student.statusChanges[0].effectiveDate)}` : ""}`.trim();
        return { content: { ...base, title: "Character certificate", person, fields: [{ label: "Admission no.", value: student.admissionNumber }, { label: "Class", value: isCurrent ? classOf(current) : classOf(last) }], body: [`This is to certify that ${name}, ${childOf(student.gender)} ${father && mother ? `${fullName(father.parent)} and ${fullName(mother.parent)}` : (parentName ?? "—")}, ${isCurrent ? "is" : "was"} a student of ${school.name}${period ? ` ${period}` : ""}.`, `To the best of the school's knowledge, ${pronoun(student.gender).toLowerCase()} conduct has been ${(params.conduct ?? "—").trim()}.`, ...purpose] }, missing, warnings };
      }
      case "ATTENDANCE_CERTIFICATE": {
        needCurrent();
        const marks = current ? await ctx.db.studentAttendance.groupBy({ by: ["status"], where: { studentId: student.id, academicSessionId: current.academicSessionId }, _count: { _all: true } }) : [];
        const count = (status: string) => marks.find((row) => row.status === status)?._count._all ?? 0;
        const total = marks.reduce((sum, row) => sum + row._count._all, 0);
        if (current && total === 0) missing.push("No attendance has been marked for this student this session.");
        const attended = count("PRESENT") + count("LATE") + count("HALF_DAY") / 2;
        return { content: { ...base, title: "Attendance certificate", person, fields: [{ label: "Class", value: classOf(current) }, { label: "Session", value: current?.academicSession.name ?? "—" }, { label: "Days marked", value: String(total) }, { label: "Days attended", value: String(attended) }, { label: "Absent", value: String(count("ABSENT")) }, { label: "On leave", value: String(count("EXCUSED")) }], body: [`This is to certify that ${name} has attended ${attended} of the ${total} school days marked in the class register this session (${current?.academicSession.name ?? "—"})${total ? `, ${Math.round((attended / total) * 1000) / 10}%` : ""}. Half days count as half.`, ...purpose] }, missing, warnings };
      }
      case "TRANSFER_CERTIFICATE": {
        const left = (LEFT_STUDENT as readonly string[]).includes(student.status);
        if (!left) missing.push(`A transfer certificate is only for a student who has left. ${name}'s status is ${humanize(student.status)} — change it first (with the leaving date).`);
        needParent();
        const leaving = params.leavingDate ?? student.statusChanges[0]?.effectiveDate ?? null;
        const admitted = params.admissionDate ?? student.admissionDate ?? null;
        if (!leaving) missing.push("The leaving date is not recorded — enter it.");
        if (!admitted) missing.push("The admission date is not recorded — enter it.");
        if (!dob) missing.push("The date of birth is not recorded on the student's profile.");
        if (!params.reason?.trim()) missing.push("Give the reason for leaving.");
        if (!params.conduct?.trim()) missing.push("State the student's conduct.");
        if (!params.duesCleared) missing.push("Confirm that fees and library books are cleared.");
        // From the records of the last class: subjects taught there, days in its register, the last published result.
        const [subjects, marks, lastExam] = last
          ? await Promise.all([
              ctx.db.teacherSubjectAssignment.findMany({ where: { sectionId: last.sectionId, academicSessionId: last.academicSessionId }, select: { subject: { select: { name: true } } } }),
              ctx.db.studentAttendance.groupBy({ by: ["status"], where: { studentId: student.id, academicSessionId: last.academicSessionId }, _count: { _all: true } }),
              ctx.db.exam.findFirst({ where: { status: "PUBLISHED", sectionId: last.sectionId, academicSessionId: last.academicSessionId, papers: { some: { results: { some: { studentId: student.id } } } } }, orderBy: { startDate: "desc" }, select: { id: true, name: true } }),
            ])
          : [[], [], null];
        const count = (status: string) => marks.find((row) => row.status === status)?._count._all ?? 0;
        const workingDays = marks.reduce((sum, row) => sum + row._count._all, 0);
        const present = count("PRESENT") + count("LATE") + count("HALF_DAY") / 2;
        const result = lastExam ? await getReportCard(ctx, lastExam.id, student.id).then((card) => `${lastExam.name}: ${OUTCOME_LABEL[card.outcome]}${card.percent === null ? "" : ` (${card.percent}%)`}`).catch(() => null) : null;
        const subjectNames = [...new Set(subjects.map((row) => row.subject.name))];
        return {
          content: {
            ...base,
            title: "Transfer certificate",
            person,
            fields: [
              { label: "Name of student", value: name },
              { label: "Admission no.", value: student.admissionNumber },
              { label: `Name of ${father ? "father" : guardian ? guardian.relationship.toLowerCase() : "parent / guardian"}`, value: father ? fullName(father.parent) : (parentName ?? "—") },
              ...(mother && (father || guardian?.relationship !== "MOTHER") ? [{ label: "Name of mother", value: fullName(mother.parent) }] : []),
              { label: "Date of birth", value: dob ?? "—" },
              { label: "Date of admission", value: admitted ? formatDate(admitted) : "—" },
              { label: "Class last studied", value: last ? `${classOf(last)} (${last.academicSession.name})` : "—" },
              ...(subjectNames.length ? [{ label: "Subjects studied", value: subjectNames.join(", ") }] : []),
              ...(result ? [{ label: "Result of the last examination", value: result }] : []),
              ...(workingDays ? [{ label: "Working days / days present", value: `${workingDays} / ${present}` }] : []),
              { label: "Date of leaving", value: leaving ? formatDate(leaving) : "—" },
              { label: "Reason for leaving", value: params.reason?.trim() || "—" },
              { label: "Conduct", value: params.conduct?.trim() || "—" },
              { label: "Dues", value: params.duesCleared ? "Cleared, as confirmed by the issuer" : "—" },
            ],
            body: [`Certified that the above particulars are as per the school's records.`],
          },
          missing,
          warnings,
        };
      }
      case "ADMIT_CARD": {
        needCurrent();
        if (!params.examId) {
          missing.push("Choose the examination.");
          return { content: { ...base, title: "Admit card", person, fields: [], body: [] }, missing, warnings };
        }
        const exam = await ctx.db.exam.findFirst({ where: { id: params.examId }, select: { name: true, sectionId: true, academicSession: { select: { name: true } }, papers: { orderBy: [{ date: "asc" }, { subject: { name: "asc" } }], select: { date: true, maxMarks: true, subject: { select: { name: true, code: true } } } } } });
        if (!exam) throw new NotFoundError("That examination was not found.");
        if (!current || current.sectionId !== exam.sectionId) missing.push(`${name} is not in the class this examination is for.`);
        if (!exam.papers.length) missing.push(`${exam.name} has no papers scheduled yet.`);
        if (!photoUrl) warnings.push("No photo on file — the admit card prints without one.");
        const day = (date: Date) => date.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
        return {
          content: {
            ...base,
            title: `Admit card — ${exam.name}`,
            person,
            fields: [{ label: "Class", value: classOf(current) }, ...(current?.rollNumber ? [{ label: "Roll no.", value: current.rollNumber }] : []), { label: "Session", value: exam.academicSession.name }, ...(father ? [{ label: "Father's name", value: fullName(father.parent) }] : []), ...(mother ? [{ label: "Mother's name", value: fullName(mother.parent) }] : []), ...(!father && !mother && parentName ? [{ label: "Guardian's name", value: parentName }] : [])],
            body: [],
            table: { head: ["Date", "Day", "Subject", "Max. marks", "Invigilator's initials"], rows: exam.papers.map((paper) => [formatDate(paper.date), day(paper.date), `${paper.subject.name}${paper.subject.code ? ` (${paper.subject.code})` : ""}`, String(paper.maxMarks), ""]), foot: [] },
          },
          missing,
          warnings,
        };
      }
      case "MARKSHEET": {
        if (!params.examId) {
          missing.push("Choose the examination.");
          return { content: { ...base, title: "Marksheet", person, fields: [], body: [] }, missing, warnings };
        }
        const card = await getReportCard(ctx, params.examId, student.id);
        if (card.exam.status !== "PUBLISHED") missing.push(`${card.exam.name} is not published yet — a marksheet is made only from published results.`);
        const cell = (subject: (typeof card.subjects)[number]) => (subject.exempt ? "Exempt" : subject.absent ? "Absent" : subject.marksObtained === null ? "—" : String(subject.marksObtained));
        return {
          content: {
            ...base,
            title: `Marksheet — ${card.exam.name}`,
            person,
            fields: [{ label: "Class", value: card.student.sectionLabel }, ...(card.student.rollNumber ? [{ label: "Roll no.", value: card.student.rollNumber }] : []), { label: "Session", value: card.exam.session }, ...(card.student.guardian ? [{ label: humanize(card.student.guardian.relationship), value: card.student.guardian.name }] : [])],
            body: [],
            table: {
              head: ["Subject", "Maximum", "Pass mark", "Obtained", "Grade"],
              rows: card.subjects.map((subject) => [subject.subject, String(subject.maxMarks), String(subject.passMark), cell(subject), subject.grade ?? "—"]),
              foot: [["Total", String(card.maxTotal), "", String(card.total), card.grade ?? "—"], ["Percentage", "", "", card.percent === null ? "—" : `${card.percent}%`, ""], ["Result", "", "", OUTCOME_LABEL[card.outcome], ""]],
            },
          },
          missing,
          warnings,
        };
      }
      default:
        throw new AppError("VALIDATION", `${meta.label} is not a student document.`);
    }
  }

  // Teachers, staff and the Principal.
  const employee = await loadEmployee(ctx, input.kind, input.personId);
  const name = fullName(employee);
  const photoUrl = await photoUrlFor(ctx, employee.photo);
  if (!employee.employeeId) missing.push("The employee ID is not set on the employment record.");
  const employeeId = employee.employeeId ?? "—";
  const person = { kind: input.kind, id: employee.id, name, idLabel: "Employee ID", idValue: employeeId, photoUrl };
  const isCurrent = (CURRENT_EMPLOYEE as readonly string[]).includes(employee.status);
  const hasLeft = (LEFT_EMPLOYEE as readonly string[]).includes(employee.status);
  const joined = employee.joiningDate ? formatDate(employee.joiningDate) : null;
  const exit = params.exitDate ?? (hasLeft ? (employee.statusChanges[0]?.effectiveDate ?? null) : null);
  const needCurrent = () => { if (!isCurrent) missing.push(`${name} is not a current employee (status: ${humanize(employee.status)}).`); };
  const needJoined = () => { if (!joined) missing.push("The joining date is not recorded on the employee's profile."); };
  const purpose = params.purpose ? [`This certificate is issued on request for the purpose of ${params.purpose}.`] : [];
  const department = employee.department ? [{ label: input.kind === "TEACHER" ? "Subjects" : "Department", value: employee.department }] : [];
  const fields = [{ label: "Employee ID", value: employeeId }, { label: "Designation", value: employee.designationShown }, ...department, ...(joined ? [{ label: "Date of joining", value: joined }] : [])];
  const addressee = [name, employee.designationShown, school.name];

  switch (input.type) {
    case "STAFF_ID_CARD":
      needCurrent();
      if (!photoUrl) warnings.push("No photo on file — the card prints without one.");
      return {
        content: {
          ...base,
          title: input.kind === "TEACHER" ? "Teacher identity card" : input.kind === "PRINCIPAL" ? "Principal identity card" : "Staff identity card",
          person,
          fields: [{ label: "Designation", value: employee.designationShown }, ...department],
          back: joined ? [{ label: "Date of joining", value: joined }] : [],
          body: [],
          validUntil: null,
        },
        missing,
        warnings,
      };
    case "APPOINTMENT_LETTER":
      needJoined();
      return {
        content: {
          ...base,
          title: "Appointment letter",
          person,
          fields: [...fields, { label: "Place of work", value: [school.name, school.city].filter(Boolean).join(", ") }],
          letter: { to: addressee, subject: `Appointment as ${employee.designationShown}`, acknowledgement: true },
          body: [`Dear ${name},`, `We are pleased to confirm your appointment as ${employee.designationShown} at ${school.name}, with effect from ${joined ?? "—"}.`, "Your duties and terms of service are as agreed with the school. We wish you every success."],
        },
        missing,
        warnings,
      };
    case "EMPLOYMENT_VERIFICATION":
      needCurrent();
      needJoined();
      return { content: { ...base, title: "Employment verification", person, fields: [...fields, { label: "Status", value: "Currently employed" }], body: [`This is to certify that ${name} (employee ID ${employeeId}) is employed at ${school.name} as ${employee.designationShown}${joined ? ` since ${joined}` : ""}.`, ...purpose] }, missing, warnings };
    case "SERVICE_CERTIFICATE": {
      needJoined();
      const serviceEnd = hasLeft || !isCurrent ? exit : null;
      if ((hasLeft || !isCurrent) && !serviceEnd) missing.push("The last working date is not recorded.");
      return {
        content: {
          ...base,
          title: "Service certificate",
          person,
          fields: [...fields, { label: "Service up to", value: serviceEnd ? formatDate(serviceEnd) : "Continuing" }, { label: "Status", value: serviceEnd ? "Former employee" : "Serving" }],
          body: [serviceEnd ? `This is to certify that ${name} served ${school.name} as ${employee.designationShown} from ${joined ?? "—"} to ${formatDate(serviceEnd)}.` : `This is to certify that ${name} has been in the service of ${school.name} as ${employee.designationShown} from ${joined ?? "—"}, and continues in service.`, ...purpose],
        },
        missing,
        warnings,
      };
    }
    case "EXPERIENCE_CERTIFICATE":
    case "RELIEVING_LETTER":
      if (!hasLeft) missing.push(`This is for an employee who has left. ${name}'s status is ${humanize(employee.status)} — record the leaving (with its date) first.`);
      needJoined();
      if (!exit) missing.push("The last working date is not recorded — enter it.");
      return {
        content: {
          ...base,
          title: input.type === "EXPERIENCE_CERTIFICATE" ? "Experience certificate" : "Relieving letter",
          person,
          fields: [...fields, { label: "Last working day", value: exit ? formatDate(exit) : "—" }],
          ...(input.type === "RELIEVING_LETTER" ? { letter: { to: addressee, subject: "Relieving from service" } } : {}),
          body:
            input.type === "EXPERIENCE_CERTIFICATE"
              ? [`This is to certify that ${name} worked at ${school.name} as ${employee.designationShown} from ${joined ?? "—"} to ${exit ? formatDate(exit) : "—"}.`, "We wish them well in their future endeavours."]
              : [`Dear ${name},`, `This is to confirm that you have been relieved of your duties as ${employee.designationShown} at ${school.name} with effect from the close of ${exit ? formatDate(exit) : "—"}.`, `Your service with the school was from ${joined ?? "—"} to ${exit ? formatDate(exit) : "—"}. We thank you for your service.`],
        },
        missing,
        warnings,
      };
    case "SALARY_CERTIFICATE": {
      needCurrent();
      const salary = input.kind === "PRINCIPAL" ? null : await ctx.db.teacherSalary.findFirst({ where: { ...(input.kind === "TEACHER" ? { teacherId: employee.id } : { staffMemberId: employee.id }), effectiveFrom: { lte: today() } }, orderBy: { effectiveFrom: "desc" }, select: { salaryType: true, amountMinor: true, allowancesMinor: true, deductionsMinor: true, effectiveFrom: true } });
      if (!salary) missing.push("No salary structure is recorded for this employee.");
      const per = salary?.salaryType === "ANNUAL" ? "per year" : salary?.salaryType === "HOURLY" ? "per hour" : "per month";
      const gross = salary ? salary.amountMinor + salary.allowancesMinor : 0;
      return {
        content: {
          ...base,
          title: "Salary certificate",
          person,
          fields: [...fields, ...(salary ? [{ label: `Basic (${per})`, value: formatMoney(salary.amountMinor) }, { label: "Allowances", value: formatMoney(salary.allowancesMinor) }, { label: "Gross", value: formatMoney(gross) }, { label: "Deductions", value: formatMoney(salary.deductionsMinor) }, { label: "Net", value: formatMoney(gross - salary.deductionsMinor) }, { label: "Effective from", value: formatDate(salary.effectiveFrom) }] : [])],
          body: [`This is to certify that ${name} is employed at ${school.name} as ${employee.designationShown}, and that their salary as per the school's records is as stated above.`, ...purpose],
        },
        missing,
        warnings,
      };
    }
    default:
      throw new AppError("VALIDATION", `${meta.label} is not a staff document.`);
  }
}

// -----------------------------------------------------------------------------
// Samples (settings preview)
// -----------------------------------------------------------------------------

/**
 * How this school's documents look, with its own letterhead and signatory but
 * an obviously made-up person ("Sample …") — for the settings page's live
 * preview only. Never saved, and every sample prints "Preview — not issued".
 */
/** A neutral head-and-shoulders silhouette for sample previews — clearly not a real photo. */
const SAMPLE_PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><rect width="160" height="200" fill="#dbe4f3"/><circle cx="80" cy="74" r="38" fill="#9fb0cc"/><path d="M14 200c4-46 32-72 66-72s62 26 66 72z" fill="#7f93b5"/></svg>',
  );

export type SampleKey = "studentCard" | "teacherCard" | "principalCard" | "staffCard" | "bonafide" | "character" | "tc" | "admitCard" | "marksheet" | "letter";

export async function documentSamples(ctx: TenantContext): Promise<Record<SampleKey, DocumentContent>> {
  assertCan(ctx, "settings", "VIEW");
  const school = await documentBranding(ctx);
  const base = (type: DocumentType, kind?: PersonKind) => ({ school: schoolBlock(school), signatory: signatoryFor(school, type, kind).block, notes: [] as string[] });
  const student = { kind: "STUDENT" as const, id: "sample", name: "Sample Student", idLabel: "Admission no.", idValue: "ADM-2026-0142", photoUrl: SAMPLE_PHOTO };
  const employee = (kind: "TEACHER" | "PRINCIPAL" | "STAFF", name: string, id: string) => ({ kind, id: "sample", name, idLabel: "Employee ID", idValue: id, photoUrl: SAMPLE_PHOTO });
  const parents = [{ label: "Father's name", value: "Sample Father" }, { label: "Mother's name", value: "Sample Mother" }];
  const signatureBody = (text: string) => [text, "This certificate is issued for the purpose of a scholarship."];
  return {
    studentCard: {
      ...base("STUDENT_ID_CARD"),
      title: "Student identity card",
      person: student,
      fields: [{ label: "Class", value: "Class 8 – A" }, { label: "Roll no.", value: "14" }, { label: "Session", value: "2026-27" }, { label: "Blood group", value: "B+" }],
      back: [{ label: "Guardian contact", value: "+91 98765 43210 (Father)" }, { label: "Date of birth", value: "14 Aug 2012" }],
      body: [],
      validUntil: "31 Mar 2027",
    },
    teacherCard: { ...base("STAFF_ID_CARD"), title: "Teacher identity card", person: employee("TEACHER", "Sample Teacher", "EMP-024"), fields: [{ label: "Designation", value: "TGT Mathematics" }, { label: "Subjects", value: "Mathematics, Science" }], back: [{ label: "Date of joining", value: "12 Jul 2018" }], body: [], validUntil: null },
    principalCard: { ...base("STAFF_ID_CARD", "PRINCIPAL"), title: "Principal identity card", person: employee("PRINCIPAL", "Sample Principal", "PRN-001"), fields: [{ label: "Designation", value: "Principal" }], back: [{ label: "Date of joining", value: "5 May 2015" }], body: [], validUntil: null },
    staffCard: { ...base("STAFF_ID_CARD"), title: "Staff identity card", person: employee("STAFF", "Sample Staff", "STF-031"), fields: [{ label: "Designation", value: "Head Librarian" }, { label: "Department", value: "Library" }], back: [{ label: "Date of joining", value: "18 Aug 2020" }], body: [], validUntil: null },
    bonafide: {
      ...base("BONAFIDE_CERTIFICATE"),
      title: "Bonafide certificate",
      person: student,
      fields: [{ label: "Admission no.", value: "ADM-2026-0142" }, { label: "Class", value: "Class 8 – A" }, { label: "Roll no.", value: "14" }, { label: "Session", value: "2026-27" }],
      body: signatureBody(`This is to certify that Sample Student, son of Sample Father, is a bonafide student of ${school.name}, studying in Class 8 – A in the academic session 2026-27. His date of birth as per the school's records is 14 Aug 2012.`),
    },
    character: {
      ...base("CHARACTER_CERTIFICATE"),
      title: "Character certificate",
      person: student,
      fields: [{ label: "Admission no.", value: "ADM-2026-0142" }, { label: "Class", value: "Class 8 – A" }],
      body: [`This is to certify that Sample Student, son of Sample Father and Sample Mother, is a student of ${school.name} from 1 Apr 2019 to date.`, "To the best of the school's knowledge, his conduct has been Very good.", "This certificate is issued for the purpose of a passport / visa."],
    },
    tc: {
      ...base("TRANSFER_CERTIFICATE"),
      title: "Transfer certificate",
      person: student,
      fields: [
        { label: "Name of student", value: "Sample Student" },
        { label: "Admission no.", value: "ADM-2026-0142" },
        { label: "Name of father", value: "Sample Father" },
        { label: "Name of mother", value: "Sample Mother" },
        { label: "Date of birth", value: "14 Aug 2012" },
        { label: "Date of admission", value: "1 Apr 2019" },
        { label: "Class last studied", value: "Class 8 – A (2026-27)" },
        { label: "Subjects studied", value: "English, Hindi, Mathematics, Science, Social Science, Computer" },
        { label: "Result of the last examination", value: "Mid-Term 2026: Pass (88%)" },
        { label: "Working days / days present", value: "172 / 162" },
        { label: "Date of leaving", value: "31 Mar 2027" },
        { label: "Reason for leaving", value: "Parent transfer" },
        { label: "Conduct", value: "Very good" },
        { label: "Dues", value: "Cleared, as confirmed by the issuer" },
      ],
      body: ["Certified that the above particulars are as per the school's records."],
    },
    admitCard: {
      ...base("ADMIT_CARD"),
      title: "Admit card — Mid-Term 2026",
      person: student,
      fields: [{ label: "Class", value: "Class 8 – A" }, { label: "Roll no.", value: "14" }, { label: "Session", value: "2026-27" }, ...parents],
      body: [],
      table: {
        head: ["Date", "Day", "Subject", "Max. marks", "Invigilator's initials"],
        rows: [["15 Sep 2026", "Tue", "Mathematics (041)", "80", ""], ["17 Sep 2026", "Thu", "Science (086)", "80", ""], ["19 Sep 2026", "Sat", "English (184)", "80", ""], ["22 Sep 2026", "Tue", "Social Science (087)", "80", ""], ["24 Sep 2026", "Thu", "Hindi (002)", "80", ""]],
        foot: [],
      },
    },
    marksheet: {
      ...base("MARKSHEET"),
      title: "Marksheet — Mid-Term 2026",
      person: student,
      fields: [{ label: "Class", value: "Class 8 – A" }, { label: "Roll no.", value: "14" }, { label: "Session", value: "2026-27" }, { label: "Father", value: "Sample Father" }],
      body: [],
      table: {
        head: ["Subject", "Maximum", "Pass mark", "Obtained", "Grade"],
        rows: [["Mathematics", "100", "33", "92", "A1"], ["Science", "100", "33", "89", "A2"], ["Social Science", "100", "33", "88", "A2"], ["Hindi", "100", "33", "87", "A2"], ["English", "100", "33", "86", "A2"]],
        foot: [["Total", "500", "", "442", "A2"], ["Percentage", "", "", "88.4%", ""], ["Result", "", "", "Pass", ""]],
      },
    },
    letter: {
      ...base("APPOINTMENT_LETTER"),
      title: "Appointment letter",
      person: employee("TEACHER", "Sample Teacher", "EMP-024"),
      fields: [{ label: "Employee ID", value: "EMP-024" }, { label: "Designation", value: "TGT Mathematics" }, { label: "Date of joining", value: "12 Jul 2018" }, { label: "Place of work", value: [school.name, school.city].filter(Boolean).join(", ") }],
      letter: { to: ["Sample Teacher", "TGT Mathematics", school.name], subject: "Appointment as TGT Mathematics", acknowledgement: true },
      body: ["Dear Sample Teacher,", `We are pleased to confirm your appointment as TGT Mathematics at ${school.name}, with effect from 12 Jul 2018.`, "Your duties and terms of service are as agreed with the school. We wish you every success."],
    },
  };
}

// -----------------------------------------------------------------------------
// Generate / issue
// -----------------------------------------------------------------------------

const subjectKey = (kind: PersonKind, personId: string) => (kind === "STUDENT" ? { studentId: personId } : kind === "TEACHER" ? { teacherId: personId } : kind === "PRINCIPAL" ? { principalProfileId: personId } : { staffMemberId: personId });
/** Whose document a stored row is. */
const kindOf = (row: { studentId?: string | null; teacherId?: string | null; principalProfileId?: string | null }): PersonKind => (row.studentId ? "STUDENT" : row.teacherId ? "TEACHER" : row.principalProfileId ? "PRINCIPAL" : "STAFF");

/** The next number for a type this year: "TC/2026/0007". */
async function nextNumber(tx: Pick<TenantContext["db"], "issuedDocument">, schoolId: string, prefix: string, year: number): Promise<string> {
  const start = `${prefix}/${year}/`;
  const last = await tx.issuedDocument.findFirst({ where: { schoolId, number: { startsWith: start } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last?.number ? Number(last.number.slice(start.length)) + 1 : 1;
  return `${start}${String(n).padStart(4, "0")}`;
}

export type CreateInput = { type: DocumentType; kind: PersonKind; personId: string; params?: DocumentParams; requestKey?: string | null; batchKey?: string | null; reissue?: boolean; confirmed?: boolean };

/**
 * Generate (ID card, marksheet) or issue (certificate, letter) one document.
 * Refused when anything required is missing. The same `requestKey` returns
 * the document already made, so a retried request never makes a second.
 */
export async function createDocument(ctx: TenantContext, input: CreateInput): Promise<{ id: string; number: string | null; repeated: boolean }> {
  const meta = DOCUMENTS[input.type];
  await assertDocumentAccess(ctx, input.type, "EDIT", input.kind);
  if (input.requestKey) {
    const earlier = await ctx.db.issuedDocument.findFirst({ where: { requestKey: input.requestKey }, select: { id: true, number: true, type: true, studentId: true, teacherId: true, staffMemberId: true, principalProfileId: true } });
    if (earlier) {
      if (earlier.type !== input.type || (earlier.studentId ?? earlier.teacherId ?? earlier.staffMemberId ?? earlier.principalProfileId) !== input.personId) throw new ConflictError("This request was already used for another document. Reload and try again.");
      return { id: earlier.id, number: earlier.number, repeated: true };
    }
  }
  if (input.type === "TRANSFER_CERTIFICATE" && !input.confirmed) throw new ConflictError("Check the transfer certificate's details and confirm before issuing it.");
  const built = await buildDocument(ctx, input);
  if (built.missing.length) throw new AppError("VALIDATION", `Cannot ${meta.kind === "ISSUED" ? "issue" : "generate"} yet: ${built.missing.join(" ")}`);

  const subject = subjectKey(input.kind, input.personId);
  const live = meta.kind === "ISSUED" ? await ctx.db.issuedDocument.findFirst({ where: { type: input.type, status: "ISSUED", ...subject }, orderBy: { createdAt: "desc" }, select: { id: true, number: true } }) : null;
  if (live && !input.reissue) throw new ConflictError(`${meta.label} ${live.number} is already issued for this person. Tick “Issue again” to supersede it.`);
  const school = await documentBranding(ctx);
  // A transfer certificate waits for a second leader when the school asks for it: no number until approved.
  const needsApproval = input.type === "TRANSFER_CERTIFICATE" && school.tcApprovalRequired;
  if (needsApproval && (await ctx.db.issuedDocument.count({ where: { type: input.type, status: "PENDING_APPROVAL", ...subject } }))) throw new ConflictError("A transfer certificate for this student is already waiting for approval.");
  const status = needsApproval ? "PENDING_APPROVAL" : meta.kind;
  const signatureKey = signatoryFor(school, input.type, input.kind).signatureKey;
  const issuedOn = input.params?.issuedOn ?? today();
  const params = { ...(input.params ?? {}), signatureKey } as unknown as Prisma.InputJsonValue;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const row = await ctx.db.$transaction(async (tx) => {
        const number = status === "ISSUED" ? await nextNumber(tx, ctx.schoolId, meta.prefix!, issuedOn.getUTCFullYear()) : null;
        const created = await tx.issuedDocument.create({
          data: { schoolId: ctx.schoolId, type: input.type, status, number, ...subject, params, content: built.content as unknown as Prisma.InputJsonValue, issuedOn, generatedById: ctx.user.id, issuedById: status === "ISSUED" ? ctx.user.id : null, batchKey: input.batchKey ?? null, requestKey: input.requestKey ?? null },
          select: { id: true, number: true },
        });
        // A re-issue supersedes the earlier one; that one is kept, marked, and points here. (A pending one supersedes on approval.)
        if (live && status === "ISSUED") await tx.issuedDocument.updateMany({ where: { id: live.id, status: "ISSUED" }, data: { status: "SUPERSEDED", supersededById: created.id } });
        return created;
      });
      await recordAudit({
        action: status === "PENDING_APPROVAL" ? "DOCUMENT_APPROVAL_REQUESTED" : meta.kind === "ISSUED" ? "DOCUMENT_ISSUED" : "DOCUMENT_GENERATED",
        entityType: "IssuedDocument",
        entityId: row.id,
        schoolId: ctx.schoolId,
        actorId: ctx.user.id,
        summary: status === "PENDING_APPROVAL" ? `${meta.label} for ${built.content.person.name} sent for approval.` : `${meta.label}${row.number ? ` ${row.number}` : ""} ${meta.kind === "ISSUED" ? "issued" : "generated"} for ${built.content.person.name}${live ? ` (supersedes ${live.number})` : ""}.`,
        metadata: { type: input.type, person: input.kind, personId: input.personId, number: row.number, batchKey: input.batchKey ?? null },
      });
      return { id: row.id, number: row.number, repeated: false };
    } catch (error) {
      // Two issues at once can race for a number (or the same request key): retry, then report.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        if (input.requestKey) {
          const earlier = await ctx.db.issuedDocument.findFirst({ where: { requestKey: input.requestKey }, select: { id: true, number: true } });
          if (earlier) return { id: earlier.id, number: earlier.number, repeated: true };
        }
        if (attempt < 2) continue;
      }
      throw error;
    }
  }
  throw new ConflictError("Could not number the document. Try again.");
}

/** Revoke an issued document. It stays on the register, marked revoked, with the reason. */
export async function revokeDocument(ctx: TenantContext, documentId: string, reason: string): Promise<void> {
  const row = await ctx.db.issuedDocument.findFirst({ where: { id: documentId }, select: { id: true, type: true, status: true, number: true, studentId: true, teacherId: true, principalProfileId: true } });
  if (!row) throw new NotFoundError("That document was not found.");
  await assertDocumentAccess(ctx, row.type, "EDIT", kindOf(row));
  if (!reason.trim()) throw new AppError("VALIDATION", "Give a reason.");
  if (row.status !== "ISSUED") throw new ConflictError("Only an issued document can be revoked.");
  const { count } = await ctx.db.issuedDocument.updateMany({ where: { id: row.id, status: "ISSUED" }, data: { status: "REVOKED", revokedAt: new Date(), revokedById: ctx.user.id, revokeReason: reason.trim() } });
  if (!count) throw new ConflictError("This document changed meanwhile. Reload and check it.");
  await recordAudit({ action: "DOCUMENT_REVOKED", entityType: "IssuedDocument", entityId: row.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${documentLabel(row.type)} ${row.number ?? ""} revoked: ${reason.trim()}` });
}

/**
 * Approve a transfer certificate waiting for approval: a leader other than the
 * one who asked for it. It then gets the school's next number and is issued
 * (superseding an earlier issued one, which the request was made to replace).
 */
export async function approveDocument(ctx: TenantContext, documentId: string): Promise<{ number: string }> {
  const row = await ctx.db.issuedDocument.findFirst({ where: { id: documentId }, select: { id: true, type: true, status: true, generatedById: true, issuedOn: true, studentId: true, teacherId: true, staffMemberId: true, principalProfileId: true, content: true } });
  if (!row) throw new NotFoundError("That document was not found.");
  const kind = kindOf(row);
  await assertDocumentAccess(ctx, row.type, "EDIT", kind);
  if (row.status !== "PENDING_APPROVAL") throw new ConflictError("Only a document waiting for approval can be approved.");
  if (row.generatedById === ctx.user.id) throw new ConflictError("A different leader must approve it — you asked for this one.");
  const meta = DOCUMENTS[row.type];
  const subject = subjectKey(kind, (row.studentId ?? row.teacherId ?? row.principalProfileId ?? row.staffMemberId)!);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const number = await ctx.db.$transaction(async (tx) => {
        const next = await nextNumber(tx, ctx.schoolId, meta.prefix!, row.issuedOn.getUTCFullYear());
        const { count } = await tx.issuedDocument.updateMany({ where: { id: row.id, status: "PENDING_APPROVAL" }, data: { status: "ISSUED", number: next, issuedById: ctx.user.id, approvedById: ctx.user.id, approvedAt: new Date() } });
        if (!count) throw new ConflictError("This document changed meanwhile. Reload and check it.");
        await tx.issuedDocument.updateMany({ where: { type: row.type, status: "ISSUED", id: { not: row.id }, ...subject }, data: { status: "SUPERSEDED", supersededById: row.id } });
        return next;
      });
      await recordAudit({ action: "DOCUMENT_APPROVED", entityType: "IssuedDocument", entityId: row.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${meta.label} ${number} approved and issued for ${(row.content as unknown as DocumentContent).person.name}.` });
      return { number };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && attempt < 2) continue;
      throw error;
    }
  }
  throw new ConflictError("Could not number the document. Try again.");
}

/** Turn down a document waiting for approval. It stays on the register, marked revoked, with the reason. */
export async function rejectDocument(ctx: TenantContext, documentId: string, reason: string): Promise<void> {
  const row = await ctx.db.issuedDocument.findFirst({ where: { id: documentId }, select: { id: true, type: true, status: true, studentId: true, teacherId: true, principalProfileId: true, content: true } });
  if (!row) throw new NotFoundError("That document was not found.");
  await assertDocumentAccess(ctx, row.type, "EDIT", kindOf(row));
  if (!reason.trim()) throw new AppError("VALIDATION", "Give a reason.");
  const { count } = await ctx.db.issuedDocument.updateMany({ where: { id: row.id, status: "PENDING_APPROVAL" }, data: { status: "REVOKED", revokedAt: new Date(), revokedById: ctx.user.id, revokeReason: `Not approved: ${reason.trim()}` } });
  if (!count) throw new ConflictError("Only a document waiting for approval can be turned down.");
  await recordAudit({ action: "DOCUMENT_REJECTED", entityType: "IssuedDocument", entityId: row.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${documentLabel(row.type)} for ${(row.content as unknown as DocumentContent).person.name} not approved: ${reason.trim()}` });
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

const ROW_SELECT = { id: true, type: true, status: true, number: true, issuedOn: true, createdAt: true, revokeReason: true, supersededById: true, batchKey: true, studentId: true, teacherId: true, staffMemberId: true, principalProfileId: true, generatedById: true, content: true } as const;

/** One person's documents, newest first — those this user may see. */
export async function documentsOf(ctx: TenantContext, kind: PersonKind, personId: string) {
  const rows = await ctx.db.issuedDocument.findMany({ where: subjectKey(kind, personId), orderBy: { createdAt: "desc" }, take: 100, select: ROW_SELECT });
  const visible: typeof rows = [];
  for (const row of rows) if (await assertDocumentAccess(ctx, row.type, "VIEW", kind).then(() => true, () => false)) visible.push(row);
  return visible.map(({ content, ...row }) => ({ ...row, person: (content as unknown as DocumentContent).person.name }));
}

/** The register for the whole school: filters by type and status. */
export async function listDocuments(ctx: TenantContext, filters: { type?: DocumentType | null; status?: "GENERATED" | "PENDING_APPROVAL" | "ISSUED" | "REVOKED" | "SUPERSEDED" | null; batchKey?: string | null } = {}) {
  assertCan(ctx, "students", "VIEW");
  const rows = await ctx.db.issuedDocument.findMany({
    where: { ...(filters.type ? { type: filters.type } : {}), ...(filters.status ? { status: filters.status } : {}), ...(filters.batchKey ? { batchKey: filters.batchKey } : {}), ...(ctx.user.role === "SCHOOL_ADMIN" ? {} : { principalProfileId: null, type: { in: (Object.keys(DOCUMENTS) as DocumentType[]).filter((type) => !DOCUMENTS[type].employment), ...(filters.type ? { equals: filters.type } : {}) } }) },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: ROW_SELECT,
  });
  return rows.map(({ content, ...row }) => ({ ...row, person: (content as unknown as DocumentContent).person.name }));
}

/** Documents to print, each after the same access check. Another school's ids are simply not found. */
export async function documentsForPrint(ctx: TenantContext, ids: readonly string[]) {
  const unique = [...new Set(ids)].slice(0, MAX_BULK);
  const rows = await ctx.db.issuedDocument.findMany({ where: { id: { in: unique } }, select: { ...ROW_SELECT, params: true } });
  if (!rows.length) throw new NotFoundError("Those documents were not found.");
  const out = [];
  for (const id of unique) {
    const row = rows.find((entry) => entry.id === id);
    if (!row) continue;
    await assertDocumentAccess(ctx, row.type, "VIEW", kindOf(row));
    const { params, content, ...rest } = row;
    out.push({ ...rest, content: content as unknown as DocumentContent, hasSignatureImage: Boolean((params as { signatureKey?: string } | null)?.signatureKey) });
  }
  return out;
}

/** The signature image an issued document was signed with — for its print view, after access checks. */
export async function documentSignature(ctx: TenantContext, documentId: string): Promise<string | null> {
  const row = await ctx.db.issuedDocument.findFirst({ where: { id: documentId }, select: { type: true, params: true, studentId: true, teacherId: true, principalProfileId: true } });
  if (!row) throw new NotFoundError();
  await assertDocumentAccess(ctx, row.type, "VIEW", kindOf(row));
  const key = (row.params as { signatureKey?: string } | null)?.signatureKey ?? null;
  // Every key is under the school's own folder; anything else is refused.
  if (key && !key.startsWith(`${ctx.schoolId}/`)) throw new ForbiddenError();
  return key;
}

// -----------------------------------------------------------------------------
// Bulk
// -----------------------------------------------------------------------------

export type BulkResult = { batchKey: string; created: number; repeated: number; skipped: Array<{ personId: string; name: string; reason: string }>; documentIds: string[] };

/**
 * One document type for many people. Each person is checked on its own;
 * those that cannot be made are skipped with the reason. Running the same
 * batch again (same key) returns what was made, never a second copy. A
 * transfer certificate is issued one at a time, after its review.
 */
export async function bulkCreateDocuments(ctx: TenantContext, input: { type: DocumentType; kind: PersonKind; personIds: readonly string[]; params?: DocumentParams; batchKey: string }): Promise<BulkResult> {
  await assertDocumentAccess(ctx, input.type, "EDIT", input.kind);
  if (input.type === "TRANSFER_CERTIFICATE") throw new AppError("VALIDATION", "Transfer certificates are issued one at a time, after checking each one.");
  const ids = [...new Set(input.personIds)];
  if (!ids.length) throw new AppError("VALIDATION", "Choose at least one person.");
  if (ids.length > MAX_BULK) throw new AppError("VALIDATION", `Choose at most ${MAX_BULK} at a time.`);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.batchKey)) throw new AppError("VALIDATION", "Invalid batch.");
  await recordAudit({ action: "DOCUMENT_BULK_STARTED", entityType: "IssuedDocument", entityId: null, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${documentLabel(input.type)}: bulk run for ${ids.length} started.`, metadata: { batchKey: input.batchKey, type: input.type, count: ids.length } });
  const result: BulkResult = { batchKey: input.batchKey, created: 0, repeated: 0, skipped: [], documentIds: [] };
  for (const personId of ids) {
    try {
      const made = await createDocument(ctx, { type: input.type, kind: input.kind, personId, params: input.params, batchKey: input.batchKey, requestKey: `${input.batchKey}:${personId}` });
      result.documentIds.push(made.id);
      if (made.repeated) result.repeated += 1;
      else result.created += 1;
    } catch (error) {
      result.skipped.push({ personId, name: await nameOf(ctx, input.kind, personId), reason: error instanceof Error ? error.message : "Could not be made." });
    }
  }
  await recordAudit({ action: "DOCUMENT_BULK_COMPLETED", entityType: "IssuedDocument", entityId: null, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${documentLabel(input.type)}: bulk run done — ${result.created} made, ${result.repeated} already made, ${result.skipped.length} skipped.`, metadata: { batchKey: input.batchKey, created: result.created, repeated: result.repeated, skipped: result.skipped.length } });
  return result;
}

/** Document types this user may make in bulk for a kind of person (a TC is never bulk). */
export async function bulkDocumentOptions(ctx: TenantContext, kind: PersonKind): Promise<Array<{ value: DocumentType; label: string }>> {
  const out: Array<{ value: DocumentType; label: string }> = [];
  for (const type of Object.keys(DOCUMENTS) as DocumentType[]) {
    if (type === "TRANSFER_CERTIFICATE" || !DOCUMENTS[type].for.includes(kind)) continue;
    if (await assertDocumentAccess(ctx, type, "EDIT", kind).then(() => true, () => false)) out.push({ value: type, label: DOCUMENTS[type].label });
  }
  return out;
}

async function nameOf(ctx: TenantContext, kind: PersonKind, id: string): Promise<string> {
  const row =
    kind === "STUDENT"
      ? await ctx.db.student.findFirst({ where: { id }, select: { firstName: true, lastName: true } })
      : kind === "TEACHER"
        ? await ctx.db.teacher.findFirst({ where: { id }, select: { firstName: true, lastName: true } })
        : kind === "PRINCIPAL"
          ? ((await ctx.db.principalProfile.findFirst({ where: { id }, select: { user: { select: { firstName: true, lastName: true } } } }))?.user ?? null)
          : await ctx.db.staffMember.findFirst({ where: { id }, select: { firstName: true, lastName: true } });
  return row ? fullName(row) : "Not found";
}
