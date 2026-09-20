import type { AttendanceStatus } from "@/generated/prisma/enums";
import { emptyCounts, attendedShare, type AttendanceCounts } from "@/server/attendance/service";

/**
 * Shaping one person's attendance for their own dashboard.
 *
 * Pure functions over rows the caller already fetched — a student's record is
 * small, and bucketing it here keeps another round trip out of the page.
 */

export type MonthBucket = {
  key: string;
  label: string;
  fullLabel: string;
  counts: AttendanceCounts;
  share: number | null;
};

/** Group a student's marked days by calendar month, oldest first. */
export function monthlyAttendance(
  rows: Array<{ date: Date; status: AttendanceStatus }>,
): MonthBucket[] {
  const buckets = new Map<string, AttendanceCounts>();

  for (const row of rows) {
    const key = `${row.date.getUTCFullYear()}-${String(row.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const counts = buckets.get(key) ?? emptyCounts();
    counts[row.status] += 1;
    counts.total += 1;
    buckets.set(key, counts);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, counts]) => {
      const [year, month] = key.split("-").map(Number) as [number, number];
      const date = new Date(Date.UTC(year, month - 1, 1));
      return {
        key,
        label: new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "short" }).format(date),
        fullLabel: new Intl.DateTimeFormat("en-IN", {
          timeZone: "UTC",
          month: "long",
          year: "numeric",
        }).format(date),
        counts,
        share: attendedShare(counts),
      };
    });
}

/** The last `take` marked days as 1 (attended) or 0, oldest first, for a sparkline. */
export function attendanceSpark(
  rows: Array<{ date: Date; status: AttendanceStatus }>,
  take = 12,
): number[] {
  return [...rows]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(-take)
    .map((row) => (row.status === "PRESENT" || row.status === "LATE" ? 1 : 0));
}
