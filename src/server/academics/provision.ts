import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { dateOnly, today } from "@/lib/dates";

/**
 * Default academic structure for a newly approved school.
 *
 * A school should be usable the moment it is approved: every grade from
 * Nursery to Class 12, the three common senior streams, a starter subject list
 * and the academic session in progress. All of it is ordinary school-owned data
 * the admin can rename or deactivate.
 *
 * Idempotent — rows that already exist are left alone, so re-approving a
 * school that was once rejected never duplicates or overwrites its setup.
 */

export const DEFAULT_GRADES: Array<{ name: string; level: number }> = [
  { name: "Nursery", level: -3 },
  { name: "LKG", level: -2 },
  { name: "UKG", level: -1 },
  ...Array.from({ length: 12 }, (_, i) => ({ name: `Class ${i + 1}`, level: i + 1 })),
];

export const DEFAULT_STREAMS = ["Science", "Commerce", "Arts"];

export const DEFAULT_SUBJECTS = [
  { name: "English", code: "ENG" },
  { name: "Hindi", code: "HIN" },
  { name: "Mathematics", code: "MATH" },
  { name: "Science", code: "SCI" },
  { name: "Social Studies", code: "SST" },
  { name: "Computer Science", code: "CS" },
];

/**
 * Indian schools run April to March, so on 20 Sep 2026 the session in progress
 * is "2026-27", and on 10 Feb 2027 it is still "2026-27".
 */
export function currentAcademicYear(on: Date = today()) {
  const year = on.getUTCFullYear();
  const startYear = on.getUTCMonth() >= 3 ? year : year - 1;
  return {
    name: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    startDate: dateOnly(startYear, 4, 1),
    endDate: dateOnly(startYear + 1, 3, 31),
  };
}

export async function provisionSchool(
  tx: Prisma.TransactionClient,
  schoolId: string,
): Promise<void> {
  await tx.class.createMany({
    data: DEFAULT_GRADES.map((grade) => ({ schoolId, ...grade })),
    skipDuplicates: true,
  });

  await tx.stream.createMany({
    data: DEFAULT_STREAMS.map((name) => ({ schoolId, name })),
    skipDuplicates: true,
  });

  await tx.subject.createMany({
    data: DEFAULT_SUBJECTS.map((subject) => ({ schoolId, ...subject })),
    skipDuplicates: true,
  });

  const hasSession = await tx.academicSession.count({ where: { schoolId } });
  if (!hasSession) {
    await tx.academicSession.create({
      data: { schoolId, ...currentAcademicYear(), isCurrent: true },
    });
  }
}
