import type { AttendanceStatus } from "@/generated/prisma/enums";
import type { StackSegment } from "@/components/charts/bars";
import type { AttendanceCounts } from "@/server/attendance/service";

/**
 * One mapping of attendance state to colour, used by every chart that shows
 * a register, so the same state never changes colour between screens.
 *
 * These are the reserved *status* hues, not series colours: present is good,
 * late is a warning, absent is critical. "Excused" is the de-emphasis grey —
 * an authorised absence is the bucket that should not alarm anyone, and grey
 * has no hue to be confused with its neighbours under any colour-vision
 * deficiency. Ordering the stack good → warning → grey → critical also keeps
 * the two warm hues apart.
 */
export const ATTENDANCE_COLOR: Record<AttendanceStatus, string> = {
  PRESENT: "var(--viz-good)",
  LATE: "var(--viz-warning)",
  EXCUSED: "var(--viz-neutral)",
  ABSENT: "var(--viz-critical)",
};

export const ATTENDANCE_ORDER: AttendanceStatus[] = ["PRESENT", "LATE", "EXCUSED", "ABSENT"];

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  EXCUSED: "Excused",
  ABSENT: "Absent",
};

export function attendanceSegments(counts: AttendanceCounts): StackSegment[] {
  return ATTENDANCE_ORDER.map((status) => ({
    key: status,
    label: ATTENDANCE_LABEL[status],
    value: counts[status],
    color: ATTENDANCE_COLOR[status],
  }));
}

export function attendanceLegend(counts: AttendanceCounts) {
  return ATTENDANCE_ORDER.filter((status) => counts[status] > 0).map((status) => ({
    label: ATTENDANCE_LABEL[status],
    color: ATTENDANCE_COLOR[status],
    value: String(counts[status]),
  }));
}

/** The ordinal ramp, for ordered stages such as an admissions funnel. */
export const ORDINAL_RAMP = [
  "var(--viz-ordinal-1)",
  "var(--viz-ordinal-2)",
  "var(--viz-ordinal-3)",
  "var(--viz-ordinal-4)",
];
