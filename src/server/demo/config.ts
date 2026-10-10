/**
 * The Live Demo's fixed settings. A sandbox is a fictional school for one
 * visitor, deleted after `DEMO_TTL_MS`.
 */
export const DEMO_SCHOOL_NAME = "Green Valley Demo School";
/** RFC 2606: `.invalid` can never receive mail. Every demo login uses it. */
export const DEMO_EMAIL_DOMAIN = "demo.schoolos.invalid";
export const DEMO_TTL_MS = 2 * 60 * 60 * 1000;
/** At most this many live sandboxes at once; the oldest beyond it are removed. */
export const DEMO_MAX_SANDBOXES = 200;
/** New sandboxes per visitor address per hour. */
export const DEMO_STARTS_PER_HOUR = 6;

export const DEMO_ROLES = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "PARENT", "STUDENT", "ACCOUNTANT"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export const DEMO_ROLE_INFO: Record<DemoRole, { label: string; who: string; can: string; home: string }> = {
  SCHOOL_ADMIN: { label: "School Admin", who: "Sunita Bhargava", can: "Students, staff, attendance, exams, fees, reports and settings — the whole school.", home: "/school-admin/dashboard" },
  PRINCIPAL: { label: "Principal", who: "Dr. Neelam Rao", can: "Academics, attendance, exams and results, communication and responsibilities — no fee collection.", home: "/principal/dashboard" },
  TEACHER: { label: "Teacher", who: "Anjali Mehra (Mathematics)", can: "Her classes: attendance, homework, marks and her responsibilities.", home: "/teacher/dashboard" },
  PARENT: { label: "Parent", who: "Rakesh Sharma (two children)", can: "Ananya and Kabir only: attendance, published results, homework, notices and fee statements.", home: "/parent/dashboard" },
  STUDENT: { label: "Student", who: "Ananya Sharma (Class 8 A)", can: "Her own timetable, attendance, homework and published results. Never fees.", home: "/student/dashboard" },
  ACCOUNTANT: { label: "Accountant", who: "Mahesh Arora", can: "Fee collection, receipts and fee reports — nothing else.", home: "/staff/dashboard" },
};
