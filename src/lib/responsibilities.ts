/**
 * Responsibilities the Principal (or School Admin) hands to teachers and
 * staff. A responsibility is a record of work to do — it never grants access:
 * an "Exam Coordinator" still works through their own role's pages.
 */

export const RESPONSIBILITY_TYPES = [
  { key: "CLASS_TEACHER", label: "Class Teacher" },
  { key: "EXAM_COORDINATOR", label: "Exam Coordinator" },
  { key: "PTM_COORDINATOR", label: "PTM Coordinator" },
  { key: "SPORTS", label: "Sports In-charge" },
  { key: "CULTURAL", label: "Cultural Activities" },
  { key: "SCIENCE_LAB", label: "Science Lab In-charge" },
  { key: "LIBRARY", label: "Library In-charge" },
  { key: "DISCIPLINE", label: "Discipline Committee" },
  { key: "ACADEMIC", label: "Academic Coordinator" },
  { key: "ATTENDANCE", label: "Attendance Monitoring" },
  { key: "SCHOOL_EVENT", label: "School Event" },
  { key: "ADMISSION_SUPPORT", label: "Admission Support" },
  { key: "EXAMINATION_SUPPORT", label: "Examination Support" },
  { key: "OTHER", label: "Other" },
] as const;

export type ResponsibilityType = (typeof RESPONSIBILITY_TYPES)[number]["key"];
export const RESPONSIBILITY_TYPE_KEYS = RESPONSIBILITY_TYPES.map((type) => type.key) as [ResponsibilityType, ...ResponsibilityType[]];

export function responsibilityTypeLabel(key: string): string {
  return RESPONSIBILITY_TYPES.find((type) => type.key === key)?.label ?? "Other";
}

export const RESPONSIBILITY_PRIORITIES = [
  { value: "HIGH", label: "High" },
  { value: "NORMAL", label: "Normal" },
  { value: "LOW", label: "Low" },
] as const;

/** Who can be given a responsibility: people who work at the school. */
export const ASSIGNABLE_ROLES = ["TEACHER", "NON_TEACHING_STAFF", "PRINCIPAL"] as const;

/** The status a person sees: open work past its end date reads "Overdue". */
export function effectiveStatus(row: { status: string; endDate: Date | null }, today: Date): "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "CANCELLED" {
  if ((row.status === "PENDING" || row.status === "IN_PROGRESS" || row.status === "OVERDUE") && row.endDate && row.endDate < today) return "OVERDUE";
  if (row.status === "OVERDUE") return "PENDING";
  return row.status as "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
}
