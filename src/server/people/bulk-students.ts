import "server-only";
import { admissionYear, allocateAdmissionNumber, ensureAdmissionCounter } from "@/server/people/admission-number";

import { changeStudentStatus } from "@/server/people/lifecycle";

import type { Gender, ParentRelationship, StudentStatus } from "@/generated/prisma/enums";
import { CsvFormatError, readCsvRecords } from "@/lib/csv";
import { parseDateInput, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { sectionLabel } from "@/server/academics/structure";
import { claimSeatsForGroup } from "@/server/academics/streams";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { remainingStudentCapacity } from "@/server/platform/limits";

/**
 * Bulk student operations for the School Admin: promotion into a new session,
 * moving students between sections, changing status, and CSV import.
 *
 * Every operation validates the whole batch first and writes in a single
 * transaction, so a batch either lands completely or not at all. Promotion
 * never touches last session's rows: it adds a new enrollment and closes the
 * old one as COMPLETED, so attendance, marks and fees stay where they were.
 */

const SECTION_SELECT = {
  id: true,
  name: true,
  classId: true,
  streamId: true,
  capacity: true,
  academicSessionId: true,
  class: { select: { name: true } },
  stream: { select: { name: true } },
} as const;

async function requireStudents(ctx: TenantContext, studentIds: string[]) {
  const unique = [...new Set(studentIds)];
  const students = await ctx.db.student.findMany({
    where: { id: { in: unique } },
    select: { id: true, firstName: true, lastName: true, userId: true, status: true },
  });
  // Another school's student is simply not found.
  if (students.length !== unique.length) throw new NotFoundError("One or more students were not found.");
  return students;
}

function names(rows: Array<{ firstName: string; lastName: string }>, limit = 5): string {
  const list = rows.slice(0, limit).map((row) => `${row.firstName} ${row.lastName}`).join(", ");
  return rows.length > limit ? `${list} and ${rows.length - limit} more` : list;
}

/** Promote (or re-place) students from one session into a section of another. */
export async function promoteStudents(
  ctx: TenantContext,
  input: { fromSessionId: string; toSectionId: string; studentIds: string[] },
): Promise<{ promoted: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const toSection = await ctx.db.section.findFirst({ where: { id: input.toSectionId }, select: SECTION_SELECT });
  if (!toSection) throw new NotFoundError("That section was not found.");
  const [fromSession, toSession] = await Promise.all([
    ctx.db.academicSession.findFirst({ where: { id: input.fromSessionId }, select: { id: true, name: true, startDate: true } }),
    ctx.db.academicSession.findFirst({ where: { id: toSection.academicSessionId }, select: { id: true, name: true, startDate: true } }),
  ]);
  if (!fromSession || !toSession) throw new NotFoundError("That academic session was not found.");
  if (fromSession.id === toSession.id) {
    throw new AppError("VALIDATION", "Choose a section in a later session to promote into. To move within a session, change section instead.");
  }
  if (toSession.startDate <= fromSession.startDate) {
    throw new AppError("VALIDATION", `${toSession.name} does not come after ${fromSession.name}.`);
  }

  const students = await requireStudents(ctx, input.studentIds);
  const [sourceRows, alreadyPlaced] = await Promise.all([
    ctx.db.studentEnrollment.findMany({
      where: { academicSessionId: fromSession.id, studentId: { in: students.map((s) => s.id) } },
      select: { id: true, studentId: true, status: true, streamId: true, section: { select: { streamId: true } } },
    }),
    ctx.db.studentEnrollment.findMany({
      where: { academicSessionId: toSession.id, studentId: { in: students.map((s) => s.id) } },
      select: { studentId: true },
    }),
  ]);

  const inSource = new Set(sourceRows.map((row) => row.studentId));
  const missing = students.filter((student) => !inSource.has(student.id));
  if (missing.length) throw new ConflictError(`Not placed in ${fromSession.name}: ${names(missing)}.`);
  const placed = new Set(alreadyPlaced.map((row) => row.studentId));
  const duplicates = students.filter((student) => placed.has(student.id));
  if (duplicates.length) throw new ConflictError(`Already placed in ${toSession.name}: ${names(duplicates)}.`);

  // Each student keeps their stream; capacity (the section's, and each
  // stream's share) is checked under lock in the same transaction.
  await ctx.db.$transaction(async (tx) => {
    const streams = await claimSeatsForGroup(
      tx,
      toSection.id,
      sourceRows.map((row) => ({ studentId: row.studentId, streamId: row.streamId ?? row.section.streamId })),
    );
    await tx.studentEnrollment.createMany({
      data: students.map((student) => ({
        schoolId: ctx.schoolId,
        studentId: student.id,
        academicSessionId: toSession.id,
        sectionId: toSection.id,
        classId: toSection.classId,
        streamId: streams.get(student.id) ?? null,
      })),
    });
    // Last year's placement is closed, not changed: its records stay put.
    await tx.studentEnrollment.updateMany({
      where: { id: { in: sourceRows.filter((row) => row.status === "ACTIVE").map((row) => row.id) } },
      data: { status: "COMPLETED" },
    });
  });

  await recordAudit({
    action: "STUDENTS_PROMOTED",
    entityType: "Section",
    entityId: toSection.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${students.length} student${students.length === 1 ? "" : "s"} promoted from ${fromSession.name} to ${sectionLabel(toSection)}, ${toSession.name}.`,
    metadata: { studentIds: students.map((s) => s.id), fromSessionId: fromSession.id, toSessionId: toSession.id },
  });
  return { promoted: students.length };
}

/** Move students to another section of the same session. Roll numbers are cleared to avoid clashes. */
export async function changeSection(
  ctx: TenantContext,
  input: { toSectionId: string; studentIds: string[] },
): Promise<{ moved: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const toSection = await ctx.db.section.findFirst({ where: { id: input.toSectionId }, select: SECTION_SELECT });
  if (!toSection) throw new NotFoundError("That section was not found.");

  const students = await requireStudents(ctx, input.studentIds);
  const rows = await ctx.db.studentEnrollment.findMany({
    where: { academicSessionId: toSection.academicSessionId, studentId: { in: students.map((s) => s.id) } },
    select: { id: true, studentId: true, sectionId: true, streamId: true, section: { select: { streamId: true } } },
  });
  const found = new Set(rows.map((row) => row.studentId));
  const missing = students.filter((student) => !found.has(student.id));
  if (missing.length) throw new ConflictError(`Not placed in that section's session: ${names(missing)}.`);

  const moving = rows.filter((row) => row.sectionId !== toSection.id);
  await ctx.db.$transaction(async (tx) => {
    const streams = await claimSeatsForGroup(
      tx,
      toSection.id,
      moving.map((row) => ({ studentId: row.studentId, streamId: row.streamId ?? row.section.streamId })),
    );
    for (const row of moving) {
      await tx.studentEnrollment.updateMany({
        where: { id: row.id },
        data: { sectionId: toSection.id, classId: toSection.classId, streamId: streams.get(row.studentId) ?? null, rollNumber: null, status: "ACTIVE" },
      });
    }
  });

  await recordAudit({
    action: "STUDENTS_SECTION_CHANGED",
    entityType: "Section",
    entityId: toSection.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${moving.length} student${moving.length === 1 ? "" : "s"} moved to ${sectionLabel(toSection)}.`,
    metadata: { studentIds: moving.map((row) => row.studentId) },
  });
  return { moved: moving.length };
}

/** Change status for many students. Leaving students lose their portal login. */
export async function setStudentsStatus(
  ctx: TenantContext,
  input: { status: StudentStatus; studentIds: string[] },
): Promise<{ updated: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const students = await requireStudents(ctx, input.studentIds);
  const changing = students.filter((student) => student.status !== input.status);

  if (input.status === "ACTIVE") {
    const capacity = await remainingStudentCapacity(ctx);
    if (capacity && changing.length > capacity.remaining) {
      throw new AppError("CONFLICT", `Your ${capacity.plan} plan allows ${capacity.remaining} more active students.`);
    }
  }

  // Each one goes through the lifecycle, so every student gets a dated
  // history entry and their placement and login follow the new status.
  for (const student of changing) {
    await changeStudentStatus(ctx, student.id, input.status, {
      effectiveDate: today(),
      reason: "Bulk status change",
      remarks: null,
      confirmReturn: true,
    });
  }

  await recordAudit({
    action: "STUDENTS_STATUS_CHANGED",
    entityType: "Student",
    entityId: null,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${changing.length} student${changing.length === 1 ? "" : "s"} set to ${input.status.toLowerCase()}.`,
    metadata: { studentIds: changing.map((s) => s.id) },
  });
  return { updated: changing.length };
}

// -----------------------------------------------------------------------------
// CSV import
// -----------------------------------------------------------------------------

export const STUDENT_IMPORT_COLUMNS = [
  "Admission no.",
  "First name",
  "Last name",
  "Gender",
  "Date of birth",
  "Class",
  "Section",
  /** Needed only where the section's seats are shared among streams. */
  "Stream",
  "Roll no.",
  "Guardian first name",
  "Guardian last name",
  "Guardian phone",
  "Guardian email",
  "Relationship",
] as const;

export type ImportError = { line: number; message: string };

/** What a check (or an import) found: rows that will go in, rows that cannot, and notes worth a look. */
export type StudentImportReport = {
  total: number;
  valid: number;
  created: number;
  errors: ImportError[];
  /** Not wrong, but worth knowing — e.g. a guardian matched to one already on file. */
  warnings: ImportError[];
};

const GENDERS: Record<string, Gender> = { m: "MALE", male: "MALE", boy: "MALE", f: "FEMALE", female: "FEMALE", girl: "FEMALE", o: "OTHER", other: "OTHER" };
const RELATIONS: Record<string, ParentRelationship> = { father: "FATHER", mother: "MOTHER", guardian: "GUARDIAN" };

/** "12/03/2014" (Indian day-first) or "2014-03-12". */
function parseImportDate(value: string): Date | null {
  const iso = parseDateInput(value);
  if (iso) return iso;
  const match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!match) return null;
  return parseDateInput(`${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`);
}

/**
 * Admit students from a CSV into the current session. Every row is checked
 * first — required fields, a class and section that exist this session,
 * admission and roll numbers unique in the file and in the school, a real past
 * date of birth. A guardian whose phone the school already has is linked, not
 * duplicated.
 *
 *   * `check` writes nothing and reports valid rows, errors and warnings —
 *     the preview the office sees before anything changes;
 *   * `import` (the default) writes only if every row passes;
 *   * `import` with `validOnly` writes the rows that pass and leaves the
 *     rest out, reported. Whole-file problems (section capacity, the plan
 *     limit) still stop everything.
 *
 * Whatever is written is written in one transaction: never half a file.
 */
export async function importStudents(
  ctx: TenantContext,
  text: string,
  options: { mode?: "check" | "import"; validOnly?: boolean } = {},
): Promise<StudentImportReport> {
  const mode = options.mode ?? "import";
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!session) throw new AppError("VALIDATION", "Set a current academic session before importing students.");

  let records;
  try {
    records = readCsvRecords(text, { required: ["First name", "Last name", "Class", "Section", "Guardian phone"], maxRows: 500 });
  } catch (error) {
    if (error instanceof CsvFormatError) return { total: 0, valid: 0, created: 0, warnings: [], errors: [{ line: 1, message: error.message }] };
    throw error;
  }
  if (!records.length) return { total: 0, valid: 0, created: 0, warnings: [], errors: [{ line: 1, message: "The file has no students." }] };

  const [sections, shares, existingAdmissions, existingRolls, parents] = await Promise.all([
    ctx.db.section.findMany({ where: { academicSessionId: session.id }, select: SECTION_SELECT }),
    ctx.db.sectionStream.findMany({ where: { section: { academicSessionId: session.id } }, select: { sectionId: true, streamId: true, capacity: true, stream: { select: { name: true } } } }),
    ctx.db.student.findMany({ select: { admissionNumber: true } }),
    ctx.db.studentEnrollment.findMany({
      where: { academicSessionId: session.id, rollNumber: { not: null } },
      select: { sectionId: true, rollNumber: true },
    }),
    ctx.db.parent.findMany({ select: { id: true, phone: true } }),
  ]);

  const sectionByKey = new Map(sections.map((section) => [`${section.class.name.toLowerCase()}|${section.name.toLowerCase()}`, section]));
  const admissionsTaken = new Set(existingAdmissions.map((row) => row.admissionNumber.toLowerCase()));
  const rollsTaken = new Set(existingRolls.map((row) => `${row.sectionId}|${row.rollNumber!.toLowerCase()}`));
  const phoneDigits = (phone: string) => phone.replace(/\D/g, "").slice(-10);
  const parentByPhone = new Map(parents.map((parent) => [phoneDigits(parent.phone), parent.id]));

  const errors: ImportError[] = [];
  const warnings: ImportError[] = [];
  const rows: Array<{
    admissionNumber: string | null;
    firstName: string;
    lastName: string;
    gender: Gender | null;
    dateOfBirth: Date | null;
    section: (typeof sections)[number];
    streamId: string | null;
    rollNumber: string | null;
    guardian: { firstName: string; lastName: string; phone: string; email: string | null; relationship: ParentRelationship };
  }> = [];
  const perSection = new Map<string, number>();

  for (const record of records) {
    const v = record.values;
    const problems: string[] = [];
    const firstName = v["first name"] ?? "";
    const lastName = v["last name"] ?? "";
    if (!firstName) problems.push("first name is missing");
    if (!lastName) problems.push("last name is missing");
    if (firstName.length > 60 || lastName.length > 60) problems.push("names must be under 60 characters");

    const admissionNumber = (v["admission no"] ?? "").trim() || null;
    if (admissionNumber) {
      if (admissionNumber.length > 30) problems.push("admission no. is too long");
      else if (admissionsTaken.has(admissionNumber.toLowerCase())) problems.push(`admission no. ${admissionNumber} is already used`);
      else admissionsTaken.add(admissionNumber.toLowerCase());
    }

    const genderRaw = (v["gender"] ?? "").toLowerCase();
    const gender = genderRaw ? (GENDERS[genderRaw] ?? null) : null;
    if (genderRaw && !gender) problems.push(`gender "${v["gender"]}" is not Male, Female or Other`);

    const dobRaw = v["date of birth"] ?? "";
    const dateOfBirth = dobRaw ? parseImportDate(dobRaw) : null;
    if (dobRaw && !dateOfBirth) problems.push(`date of birth "${dobRaw}" is not a date (use YYYY-MM-DD or DD/MM/YYYY)`);
    if (dateOfBirth && dateOfBirth > today()) problems.push("date of birth is in the future");

    const section = sectionByKey.get(`${(v["class"] ?? "").toLowerCase()}|${(v["section"] ?? "").toLowerCase()}`);
    if (!section) problems.push(`no section "${v["class"]} ${v["section"]}" this session`);

    // Stream: required (and one of its shares) where the section is shared among streams.
    const streamRaw = (v["stream"] ?? "").trim();
    let streamId: string | null = null;
    if (section) {
      const offered = shares.filter((row) => row.sectionId === section.id);
      if (offered.length) {
        const match = offered.find((row) => row.stream.name.toLowerCase() === streamRaw.toLowerCase());
        if (!streamRaw) problems.push(`${sectionLabel(section)} is shared among streams — add a Stream (${offered.map((row) => row.stream.name).join(", ")})`);
        else if (!match) problems.push(`stream "${streamRaw}" is not offered in ${sectionLabel(section)}`);
        else streamId = match.streamId;
      } else if (streamRaw && section.stream?.name.toLowerCase() !== streamRaw.toLowerCase()) {
        problems.push(`${sectionLabel(section)} has no stream "${streamRaw}"`);
      }
    }

    const rollNumber = (v["roll no"] ?? "").trim() || null;
    if (rollNumber && section) {
      const key = `${section.id}|${rollNumber.toLowerCase()}`;
      if (rollsTaken.has(key)) problems.push(`roll no. ${rollNumber} is already used in that section`);
      else rollsTaken.add(key);
    }

    const phone = (v["guardian phone"] ?? "").trim();
    if (!/^\+?[0-9][0-9\s-]{6,18}$/.test(phone)) problems.push("guardian phone is missing or invalid");
    const guardianFirst = (v["guardian first name"] ?? "").trim();
    const known = phone ? parentByPhone.has(phoneDigits(phone)) : false;
    if (!known && !guardianFirst) problems.push("guardian first name is needed for a new guardian");
    const email = (v["guardian email"] ?? "").trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push("guardian email is invalid");
    const relationRaw = (v["relationship"] ?? "").toLowerCase();
    const relationship = relationRaw ? RELATIONS[relationRaw] : "GUARDIAN";
    if (!relationship) problems.push(`relationship "${v["relationship"]}" is not Father, Mother or Guardian`);

    if (problems.length) {
      errors.push({ line: record.line, message: problems.join("; ") });
      continue;
    }
    if (known) warnings.push({ line: record.line, message: `guardian phone ${phone} is already on file — ${firstName} will be linked to that guardian` });
    if (!genderRaw) warnings.push({ line: record.line, message: "gender is blank" });
    perSection.set(section!.id, (perSection.get(section!.id) ?? 0) + 1);
    rows.push({
      admissionNumber,
      firstName,
      lastName,
      gender,
      dateOfBirth,
      section: section!,
      streamId,
      rollNumber,
      guardian: {
        firstName: guardianFirst,
        lastName: (v["guardian last name"] ?? "").trim() || lastName,
        phone,
        email,
        relationship: relationship!,
      },
    });
  }

  // Section capacity and the plan limit, over the whole batch.
  for (const [sectionId, adding] of perSection) {
    const section = sections.find((row) => row.id === sectionId)!;
    if (section.capacity === null) continue;
    const occupied = await ctx.db.studentEnrollment.count({ where: { sectionId, status: "ACTIVE" } });
    if (occupied + adding > section.capacity) {
      errors.push({ line: 1, message: `${sectionLabel(section)} has room for ${Math.max(section.capacity - occupied, 0)} more, but the file adds ${adding}.` });
    }
  }
  // And each stream's share of its section.
  const perStream = new Map<string, number>();
  for (const row of rows) if (row.streamId) perStream.set(`${row.section.id}|${row.streamId}`, (perStream.get(`${row.section.id}|${row.streamId}`) ?? 0) + 1);
  for (const [key, adding] of perStream) {
    const [sectionId, streamId] = key.split("|") as [string, string];
    const share = shares.find((row) => row.sectionId === sectionId && row.streamId === streamId)!;
    const occupied = await ctx.db.studentEnrollment.count({ where: { sectionId, streamId, status: "ACTIVE" } });
    if (occupied + adding > share.capacity) {
      const section = sections.find((row) => row.id === sectionId)!;
      errors.push({ line: 1, message: `${share.stream.name} in ${sectionLabel(section)} has room for ${Math.max(share.capacity - occupied, 0)} more, but the file adds ${adding}.` });
    }
  }
  const capacity = await remainingStudentCapacity(ctx);
  if (capacity && rows.length > capacity.remaining) {
    errors.push({ line: 1, message: `Your ${capacity.plan} plan allows ${capacity.remaining} more active students; the file has ${rows.length}.` });
  }
  const byLine = (a: ImportError, b: ImportError) => a.line - b.line;
  const report = { total: records.length, valid: rows.length, errors: errors.sort(byLine), warnings: warnings.sort(byLine) };
  // Line 1 errors are about the whole file; they stop an import of valid rows too.
  const fileLevel = errors.some((error) => error.line === 1);
  if (mode === "check") return { ...report, created: 0 };
  if (errors.length && (!options.validOnly || fileLevel)) return { ...report, created: 0 };
  if (!rows.length) return { ...report, created: 0 };

  const year = admissionYear(today());
  if (rows.some((row) => !row.admissionNumber)) await ensureAdmissionCounter(ctx.schoolId, year);
  const created = await ctx.db.$transaction(
    async (tx) => {
      const newParents = new Map<string, string>();
      // Seats, under lock: each section's total and each stream's share.
      for (const sectionId of perSection.keys()) {
        await claimSeatsForGroup(
          tx,
          sectionId,
          rows.flatMap((row, index) => (row.section.id === sectionId ? [{ studentId: String(index), streamId: row.streamId ?? row.section.streamId }] : [])),
        );
      }

      for (const row of rows) {
        const student = await tx.student.create({
          data: {
            schoolId: ctx.schoolId,
            // A number from the school's old register is kept; a blank one gets the next in sequence.
            admissionNumber: row.admissionNumber ?? (await allocateAdmissionNumber(tx, year)),
            admissionDate: today(),
            firstName: row.firstName,
            lastName: row.lastName,
            gender: row.gender,
            dateOfBirth: row.dateOfBirth,
          },
          select: { id: true },
        });
        await tx.studentEnrollment.create({
          data: {
            schoolId: ctx.schoolId,
            studentId: student.id,
            academicSessionId: session.id,
            sectionId: row.section.id,
            classId: row.section.classId,
            streamId: row.streamId ?? row.section.streamId,
            rollNumber: row.rollNumber,
          },
        });
        const key = phoneDigits(row.guardian.phone);
        let parentId = parentByPhone.get(key) ?? newParents.get(key);
        if (!parentId) {
          parentId = (
            await tx.parent.create({
              data: {
                schoolId: ctx.schoolId,
                firstName: row.guardian.firstName,
                lastName: row.guardian.lastName,
                phone: row.guardian.phone,
                email: row.guardian.email,
              },
              select: { id: true },
            })
          ).id;
          newParents.set(key, parentId);
        }
        await tx.parentStudent.create({
          data: { schoolId: ctx.schoolId, parentId, studentId: student.id, relationship: row.guardian.relationship, isPrimary: true },
        });
      }
      return rows.length;
    },
    { timeout: 60_000 },
  );

  await recordAudit({
    action: "STUDENTS_IMPORTED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${created} student${created === 1 ? "" : "s"} imported from CSV.`,
  });
  return { ...report, created };
}
