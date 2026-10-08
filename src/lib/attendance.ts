import type { AttendanceStatus } from "@/generated/prisma/enums";

/**
 * How a student's day counts towards attendance, in one place so every
 * summary, report and chart agrees: present and late are a full day, a half
 * day is half, leave (excused) and absent are none. Every marked day still
 * counts in the total.
 */
export function attendedValue(status: AttendanceStatus | string): number {
  if (status === "PRESENT" || status === "LATE") return 1;
  if (status === "HALF_DAY") return 0.5;
  return 0;
}

/** Days attended from a tally of marks: present + late + half of the half days. */
export function attendedDays(counts: { PRESENT: number; LATE: number; HALF_DAY?: number }): number {
  return counts.PRESENT + counts.LATE + (counts.HALF_DAY ?? 0) / 2;
}
