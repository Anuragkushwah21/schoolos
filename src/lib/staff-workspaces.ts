import type { Route } from "next";

/**
 * Role workspaces for the School Admin: the modules each kind of staff works
 * in, opened with the admin's own access. Nobody is impersonated — the admin
 * stays School Admin and the audit log says so. A small school's MD does the
 * accountant's or librarian's work from here without creating those staff.
 */

export type Workspace = {
  key: string;
  title: string;
  category: "TEACHING" | "NON_TEACHING";
  /** Staff designations shown as "people in this role"; TEACHER means the teachers list. */
  roles: string[];
  description: string;
  icon: "teachers" | "academics" | "fees" | "library" | "admissions" | "transport" | "visitors" | "inventory" | "staff";
  links: Array<{ href: Route; label: string; hint: string }>;
  /** Where "Add someone in this role" goes. */
  addHref: Route;
};

export const WORKSPACES: Workspace[] = [
  {
    key: "teacher",
    title: "Teacher",
    category: "TEACHING",
    roles: ["TEACHER"],
    description: "Classes, attendance, homework, tests and timetables.",
    icon: "teachers",
    links: [
      { href: "/school-admin/attendance", label: "Attendance", hint: "Take or correct any section's register." },
      { href: "/school-admin/timetable", label: "Timetable", hint: "Periods, rooms and streams." },
      { href: "/school-admin/homework", label: "Homework", hint: "What has been set across the school." },
      { href: "/school-admin/exams", label: "Exams & results", hint: "Exams, marks and report cards." },
      { href: "/school-admin/teachers", label: "Teachers", hint: "Records, subjects and classes." },
    ],
    addHref: "/school-admin/teachers/new",
  },
  {
    key: "coordinator",
    title: "Academic Coordinator",
    category: "TEACHING",
    roles: ["COORDINATOR"],
    description: "Classes and sections, timetable, exams, student support and admissions drives.",
    icon: "academics",
    links: [
      { href: "/school-admin/academics/classes", label: "Classes & sections", hint: "Sections, streams and class teachers." },
      { href: "/school-admin/timetable", label: "Timetable", hint: "Periods, clashes and rooms." },
      { href: "/school-admin/exams", label: "Exams", hint: "Plan exams and publish results." },
      { href: "/school-admin/support", label: "Student support", hint: "Needs-attention records and concerns." },
      { href: "/school-admin/admissions/drives", label: "Admission drives", hint: "Classes handed to teachers for admissions." },
    ],
    addHref: "/school-admin/staff/new?role=COORDINATOR",
  },
  {
    key: "accountant",
    title: "Accountant",
    category: "NON_TEACHING",
    roles: ["ACCOUNTANT"],
    description: "Collect fees, receipts, pending fees, expenses, payroll and finance reports.",
    icon: "fees",
    links: [
      { href: "/school-admin/finance/payments", label: "Collect fees", hint: "Record a payment and print the receipt." },
      { href: "/school-admin/finance", label: "Finance overview", hint: "Collected, pending and overdue." },
      { href: "/school-admin/finance/receipts", label: "Receipts", hint: "Every receipt, reprint or void." },
      { href: "/school-admin/finance/expenses", label: "Expenses", hint: "The school's spending." },
      { href: "/school-admin/finance/payroll", label: "Payroll", hint: "Pay teachers and staff for the month." },
    ],
    addHref: "/school-admin/staff/new?role=ACCOUNTANT",
  },
  {
    key: "librarian",
    title: "Librarian",
    category: "NON_TEACHING",
    roles: ["LIBRARIAN"],
    description: "Issue and return books, the catalogue, overdue books and fines.",
    icon: "library",
    links: [{ href: "/school-admin/library", label: "Library", hint: "Issue desk, books, copies and fines." }],
    addHref: "/school-admin/staff/new?role=LIBRARIAN",
  },
  {
    key: "receptionist",
    title: "Receptionist",
    category: "NON_TEACHING",
    roles: ["RECEPTIONIST", "OFFICE_STAFF"],
    description: "Walk-in enquiries, follow-ups, online applications, meetings and visitors.",
    icon: "admissions",
    links: [
      { href: "/school-admin/admissions/enquiries", label: "Enquiries", hint: "Add, follow up and convert." },
      { href: "/school-admin/admissions", label: "Online applications", hint: "Review and admit." },
      { href: "/school-admin/meetings", label: "Meetings / PTM", hint: "Schedule and invite." },
      { href: "/school-admin/visitors", label: "Visitors", hint: "The gate's visitor log." },
      { href: "/school-admin/students", label: "Students", hint: "Look up a student or family." },
    ],
    addHref: "/school-admin/staff/new?role=RECEPTIONIST",
  },
  {
    key: "transport",
    title: "Transport / Driver",
    category: "NON_TEACHING",
    roles: ["DRIVER", "TRANSPORT_ATTENDANT"],
    description: "Routes, stops, riders, vehicles and today's pickups and drops.",
    icon: "transport",
    links: [{ href: "/school-admin/transport", label: "Transport", hint: "Routes, crews, riders and trip status." }],
    addHref: "/school-admin/staff/new?role=DRIVER",
  },
  {
    key: "support",
    title: "Support Staff",
    category: "NON_TEACHING",
    roles: ["PEON", "SECURITY", "LAB_ASSISTANT"],
    description: "Gate and visitors, inventory and lab items.",
    icon: "visitors",
    links: [
      { href: "/school-admin/visitors", label: "Visitors", hint: "Log entries and exits." },
      { href: "/school-admin/inventory", label: "Inventory & lab", hint: "Items, condition and location." },
    ],
    addHref: "/school-admin/staff/new?role=PEON",
  },
  {
    key: "other",
    title: "Other",
    category: "NON_TEACHING",
    roles: ["OTHER"],
    description: "Anyone else — with exactly the permissions you give them.",
    icon: "staff",
    links: [{ href: "/school-admin/staff", label: "All staff", hint: "Records, roles and permissions." }],
    addHref: "/school-admin/staff/new?role=OTHER",
  },
];

export function workspace(key: string): Workspace | undefined {
  return WORKSPACES.find((row) => row.key === key);
}
