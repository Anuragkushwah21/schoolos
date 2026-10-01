import "server-only";

import type { Gender } from "@/generated/prisma/enums";
import { CsvFormatError, readCsvRecords } from "@/lib/csv";
import { parseDateInput } from "@/lib/dates";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { type LoginInvite, provisionAccount, sendActivation, unusablePasswordHash } from "@/server/auth/account-links";
import { prisma } from "@/server/db/prisma";
import type { StudentImportReport } from "@/server/people/bulk-students";
import { remainingTeacherCapacity } from "@/server/platform/limits";

/**
 * Teachers from a CSV, the same way students come in: check first (nothing
 * written), then import the valid rows in one transaction. Every teacher gets
 * a login, so each row needs an email no SchoolOS account already uses; each
 * teacher activates it from their own email and chooses their password.
 */

export const TEACHER_IMPORT_COLUMNS = ["Employee ID", "First name", "Last name", "Email", "Phone", "Gender", "Qualification", "Designation", "Joining date"] as const;
const MAX_ROWS = 100;
const GENDERS: Record<string, Gender> = { m: "MALE", male: "MALE", f: "FEMALE", female: "FEMALE", o: "OTHER", other: "OTHER" };

export type TeacherImportReport = StudentImportReport & { invites: LoginInvite[] };

export async function importTeachers(
  ctx: TenantContext,
  text: string,
  options: { mode?: "check" | "import"; validOnly?: boolean } = {},
): Promise<TeacherImportReport> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const mode = options.mode ?? "import";
  const empty = { total: 0, valid: 0, created: 0, warnings: [], invites: [] };

  let records;
  try {
    records = readCsvRecords(text, { required: ["First name", "Last name", "Email"], maxRows: MAX_ROWS });
  } catch (error) {
    if (error instanceof CsvFormatError) return { ...empty, errors: [{ line: 1, message: error.message }] };
    throw error;
  }
  if (!records.length) return { ...empty, errors: [{ line: 1, message: "The file has no teachers." }] };

  const emails = records.map((record) => (record.values["email"] ?? "").trim().toLowerCase()).filter(Boolean);
  const [takenIds, takenEmails, existingEmp] = await Promise.all([
    ctx.db.teacher.findMany({ select: { employeeId: true } }),
    // Logins are unique across SchoolOS, so this one lookup is not school-scoped.
    prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    ctx.db.teacher.findMany({ where: { employeeId: { startsWith: "EMP" } }, select: { employeeId: true } }),
  ]);
  const ids = new Set(takenIds.map((row) => row.employeeId.toLowerCase()));
  const usedEmails = new Set(takenEmails.map((row) => row.email.toLowerCase()));
  let nextEmp = existingEmp.reduce((max, row) => Math.max(max, Number.parseInt(row.employeeId.slice(3), 10) || 0), 0);

  const errors: Array<{ line: number; message: string }> = [];
  const warnings: Array<{ line: number; message: string }> = [];
  const rows: Array<{
    line: number;
    employeeId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    gender: Gender | null;
    qualification: string | null;
    designation: string | null;
    joiningDate: Date | null;
  }> = [];

  for (const record of records) {
    const v = record.values;
    const problems: string[] = [];
    const firstName = (v["first name"] ?? "").trim();
    const lastName = (v["last name"] ?? "").trim();
    if (!firstName || !lastName) problems.push("first and last name are required");
    const email = (v["email"] ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push("email is missing or invalid");
    else if (usedEmails.has(email)) problems.push(`${email} already has a SchoolOS login`);
    else usedEmails.add(email);
    let employeeId = (v["employee id"] ?? "").trim();
    if (employeeId && ids.has(employeeId.toLowerCase())) problems.push(`employee ID ${employeeId} is already used`);
    const phone = (v["phone"] ?? "").trim() || null;
    if (phone && !/^\+?[0-9][0-9\s-]{6,18}$/.test(phone)) problems.push("phone is invalid");
    const genderRaw = (v["gender"] ?? "").trim().toLowerCase();
    const gender = genderRaw ? (GENDERS[genderRaw] ?? null) : null;
    if (genderRaw && !gender) problems.push(`gender "${v["gender"]}" is not Male, Female or Other`);
    const joiningRaw = (v["joining date"] ?? "").trim();
    const joiningDate = joiningRaw ? parseDateInput(joiningRaw) : null;
    if (joiningRaw && !joiningDate) problems.push("joining date must be YYYY-MM-DD");

    if (problems.length) {
      errors.push({ line: record.line, message: problems.join("; ") });
      continue;
    }
    if (!employeeId) {
      employeeId = `EMP${String(++nextEmp).padStart(3, "0")}`;
      warnings.push({ line: record.line, message: `no employee ID — ${employeeId} will be given` });
    }
    ids.add(employeeId.toLowerCase());
    rows.push({
      line: record.line,
      employeeId,
      firstName,
      lastName,
      email,
      phone,
      gender,
      qualification: (v["qualification"] ?? "").trim() || null,
      designation: (v["designation"] ?? "").trim() || null,
      joiningDate,
    });
  }

  const capacity = await remainingTeacherCapacity(ctx);
  if (capacity && rows.length > capacity.remaining) {
    errors.push({ line: 1, message: `Your ${capacity.plan} plan allows ${capacity.remaining} more active teachers; the file has ${rows.length}.` });
  }
  const byLine = (a: { line: number }, b: { line: number }) => a.line - b.line;
  const report = { total: records.length, valid: rows.length, errors: errors.sort(byLine), warnings: warnings.sort(byLine), invites: [] as LoginInvite[] };
  const fileLevel = errors.some((error) => error.line === 1);
  if (mode === "check" || !rows.length || (errors.length && (!options.validOnly || fileLevel))) return { ...report, created: 0 };

  // Logins wait for each teacher to activate them from their email.
  const unusableHash = await unusablePasswordHash();
  const created = await ctx.db.$transaction(
    async (tx) => {
      const ids: string[] = [];
      for (const row of rows) {
        const userId = await provisionAccount(
          tx,
          { schoolId: ctx.schoolId, email: row.email, role: "TEACHER", firstName: row.firstName, lastName: row.lastName, phone: row.phone },
          unusableHash,
        );
        await tx.teacher.create({
          data: {
            schoolId: ctx.schoolId,
            userId,
            employeeId: row.employeeId,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            phone: row.phone,
            gender: row.gender,
            qualification: row.qualification,
            designation: row.designation,
            joiningDate: row.joiningDate,
          },
        });
        ids.push(userId);
      }
      return ids;
    },
    { timeout: 60_000 },
  );

  await recordAudit({
    action: "TEACHERS_IMPORTED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${created.length} teacher${created.length === 1 ? "" : "s"} imported from CSV.`,
  });
  // After the commit: one activation email each.
  const invites: LoginInvite[] = [];
  for (const [index, userId] of created.entries()) {
    invites.push({ ...(await sendActivation(userId, ctx.user.id)), label: `${rows[index]!.firstName} ${rows[index]!.lastName}` });
  }
  return { ...report, created: created.length, invites };
}
