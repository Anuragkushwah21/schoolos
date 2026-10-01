import "server-only";

import { today } from "@/lib/dates";
import type { TenantDb } from "@/server/tenancy/scope";
import { prisma } from "@/server/db/prisma";

/**
 * Admission numbers: ADM-{YEAR}-{SEQUENCE}, e.g. ADM-2026-00001.
 *
 *   * One sequence per school per admission year (`AdmissionCounter`), so
 *     School A and School B each start at 00001.
 *   * The year is the calendar year of the admission date (in the school's
 *     time zone) — not the academic session, not the class. The number is
 *     the student's for good: promotion and new sessions never touch it.
 *   * Never MAX(number) + 1. The counter row is incremented with a single
 *     UPDATE inside the admission's own transaction: a concurrent admission
 *     waits on that row lock and gets the next value; a failed admission
 *     rolls its increment back, so no number is burnt; nothing ever
 *     decrements it, so a number is never reused after a student leaves.
 *   * A number already taken — by an imported student, say — is skipped.
 *   * `@@unique([schoolId, admissionNumber])` is the final guard.
 */

type Tx = Pick<TenantDb, "admissionCounter" | "student">;

export function admissionYear(admissionDate: Date | null | undefined): number {
  return (admissionDate ?? today()).getUTCFullYear();
}

export function formatAdmissionNumber(year: number, sequence: number): string {
  return `ADM-${year}-${String(sequence).padStart(5, "0")}`;
}

/**
 * Make sure the year's counter row exists, before the transaction that uses
 * it. `skipDuplicates` is ON CONFLICT DO NOTHING, so two first admissions of
 * a year racing each other cannot fail here.
 */
export async function ensureAdmissionCounter(schoolId: string, year: number): Promise<void> {
  await prisma.admissionCounter.createMany({ data: [{ schoolId, year, value: 0 }], skipDuplicates: true });
}

/** The next admission number, inside the caller's transaction. */
export async function allocateAdmissionNumber(tx: Tx, year: number): Promise<string> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const { count } = await tx.admissionCounter.updateMany({ where: { year }, data: { value: { increment: 1 } } });
    if (!count) throw new Error("Admission counter missing: call ensureAdmissionCounter first.");
    const { value } = await tx.admissionCounter.findFirstOrThrow({ where: { year }, select: { value: true } });
    const candidate = formatAdmissionNumber(year, value);
    const taken = await tx.student.count({ where: { admissionNumber: candidate } });
    if (!taken) return candidate;
  }
  throw new Error("Could not find a free admission number.");
}

/** Accept an existing number (from a migration or import): trimmed, sensible characters, not already used. */
export function normaliseImportedAdmissionNumber(value: string): string | null {
  // Kept exactly as the school wrote it: an old register's numbers are theirs.
  const clean = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9/_-]{0,29}$/.test(clean) ? clean : null;
}
