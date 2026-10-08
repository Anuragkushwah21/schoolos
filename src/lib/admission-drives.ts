/**
 * Admission drives: the rules both the server and the screens read.
 *
 * A drive opens admissions for one session between two dates. Each class (or
 * section) in it is an assignment: one teacher, their own dates, a capacity
 * and what they may do. A teacher may create or change applications only
 * while all of these hold — the drive is running, the assignment is not
 * paused or removed, and today is inside the assignment's own dates. When the
 * end date passes, write access ends by itself; viewing stays.
 */

export const ADMISSION_TASKS = [
  { key: "view", label: "View applications" },
  { key: "create", label: "Create application" },
  { key: "edit", label: "Edit application" },
  { key: "documents", label: "Upload documents" },
  { key: "submit", label: "Submit application" },
] as const;

export type AdmissionTask = (typeof ADMISSION_TASKS)[number]["key"];

export const ADMISSION_TASK_KEYS = ADMISSION_TASKS.map((task) => task.key) as AdmissionTask[];

export function cleanTasks(values: readonly string[]): AdmissionTask[] {
  return ADMISSION_TASK_KEYS.filter((key) => values.includes(key));
}

export type DriveStatus = "SCHEDULED" | "ACTIVE" | "PAUSED" | "CLOSED" | "CANCELLED";

export const DRIVE_STATUS_LABEL: Record<DriveStatus, string> = {
  SCHEDULED: "Scheduled",
  ACTIVE: "Active",
  PAUSED: "Paused",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

/** Where a drive stands today: SCHEDULED and ACTIVE follow the dates. */
export type DriveState = "UPCOMING" | "RUNNING" | "ENDED" | "PAUSED" | "CLOSED" | "CANCELLED";

export const DRIVE_STATE_LABEL: Record<DriveState, string> = {
  UPCOMING: "Not started",
  RUNNING: "Running",
  ENDED: "Ended",
  PAUSED: "Paused",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export function driveState(drive: { status: DriveStatus; startDate: Date; endDate: Date }, on: Date): DriveState {
  if (drive.status === "PAUSED" || drive.status === "CLOSED" || drive.status === "CANCELLED") return drive.status;
  if (on < drive.startDate) return "UPCOMING";
  if (on > drive.endDate) return "ENDED";
  return "RUNNING";
}

/** Where one teacher assignment stands today. Only OPEN allows creating and changing applications. */
export type AssignmentState = "OPEN" | "NOT_STARTED" | "EXPIRED" | "PAUSED" | "REMOVED" | "DRIVE_STOPPED";

export const ASSIGNMENT_STATE_LABEL: Record<AssignmentState, string> = {
  OPEN: "Open",
  NOT_STARTED: "Not started",
  EXPIRED: "Ended",
  PAUSED: "Paused",
  REMOVED: "Removed",
  DRIVE_STOPPED: "Drive not running",
};

export function assignmentState(
  assignment: { startDate: Date; endDate: Date; pausedAt: Date | null; removedAt: Date | null },
  drive: { status: DriveStatus; startDate: Date; endDate: Date },
  on: Date,
): AssignmentState {
  if (assignment.removedAt) return "REMOVED";
  if (assignment.pausedAt) return "PAUSED";
  if (on > assignment.endDate) return "EXPIRED";
  if (on < assignment.startDate) return "NOT_STARTED";
  const state = driveState(drive, on);
  return state === "RUNNING" ? "OPEN" : "DRIVE_STOPPED";
}

/** Applications that take a place in an assignment's capacity: every one except rejected. */
export const CAPACITY_STATUSES = ["DRAFT", "CORRECTION_REQUESTED", "SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "APPROVED", "CONVERTED"] as const;

/** Still with the teacher: they may edit, add documents and submit. */
export const TEACHER_EDITABLE = ["DRAFT", "CORRECTION_REQUESTED"] as const;

/** Not decided yet — what "reassign pending applications" moves. */
export const PENDING_STATUSES = ["DRAFT", "CORRECTION_REQUESTED", "SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "APPROVED"] as const;
