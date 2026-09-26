import type { Route } from "next";

import type { UserRole } from "@/generated/prisma/enums";

/**
 * Sidebar navigation for each signed-in area.
 *
 * Navigation is presentation only. Hiding a link authorizes nothing — every
 * page and action behind these links runs its own role and tenant check.
 */

export type NavItem = {
  href: Route;
  label: string;
  icon: NavIcon;
  /** Match only the exact path, so "Dashboard" is not active on every page. */
  exact?: boolean;
};

export type NavIcon =
  | "dashboard"
  | "schools"
  | "offers"
  | "audit"
  | "plans"
  | "students"
  | "teachers"
  | "academics"
  | "timetable"
  | "attendance"
  | "reports"
  | "notices"
  | "events"
  | "homework"
  | "records"
  | "materials"
  | "admissions"
  | "website"
  | "account"
  | "tokens"
  | "children";

export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  SUPER_ADMIN: [
    { href: "/super-admin/dashboard", label: "Overview", icon: "dashboard", exact: true },
    { href: "/super-admin/schools", label: "Schools", icon: "schools" },
    { href: "/super-admin/plans", label: "Plans", icon: "plans" },
    { href: "/super-admin/offers", label: "Offers", icon: "offers" },
    { href: "/super-admin/audit", label: "Audit log", icon: "audit" },
    { href: "/api-tokens", label: "API tokens", icon: "tokens" },
    { href: "/account", label: "Account", icon: "account" },
  ],
  SCHOOL_ADMIN: [
    { href: "/school-admin/dashboard", label: "Dashboard", icon: "dashboard", exact: true },
    { href: "/school-admin/students", label: "Students", icon: "students" },
    { href: "/school-admin/teachers", label: "Teachers", icon: "teachers" },
    { href: "/school-admin/academics", label: "Academics", icon: "academics" },
    { href: "/school-admin/timetable", label: "Timetable", icon: "timetable" },
    { href: "/school-admin/attendance", label: "Attendance", icon: "attendance" },
    { href: "/school-admin/reports", label: "Reports", icon: "reports" },
    { href: "/school-admin/admissions", label: "Admissions", icon: "admissions" },
    { href: "/school-admin/notices", label: "Notices", icon: "notices" },
    { href: "/school-admin/events", label: "Events", icon: "events" },
    { href: "/school-admin/parents", label: "Parents", icon: "children" },
    { href: "/school-admin/finance", label: "Finance", icon: "plans" },
    { href: "/school-admin/website", label: "Website", icon: "website" },
    { href: "/api-tokens", label: "API tokens", icon: "tokens" },
    { href: "/account", label: "Account", icon: "account" },
  ],
  TEACHER: [
    // The dashboard sits at /teacher/dashboard, not /teacher — see ROLE_HOME.
    { href: "/teacher/dashboard", label: "Dashboard", icon: "dashboard", exact: true },
    { href: "/teacher/classes", label: "My classes", icon: "students" },
    { href: "/teacher/attendance", label: "Attendance", icon: "attendance" },
    { href: "/teacher/activities", label: "Class records", icon: "records" },
    { href: "/teacher/homework", label: "Homework", icon: "homework" },
    { href: "/teacher/timetable", label: "Timetable", icon: "timetable" },
    { href: "/teacher/notices", label: "Notices", icon: "notices" },
    { href: "/teacher/profile", label: "My record", icon: "teachers" },
    { href: "/account", label: "Account", icon: "account" },
  ],
  STUDENT: [
    { href: "/student/dashboard", label: "Today", icon: "dashboard", exact: true },
    { href: "/student/classes", label: "Completed classes", icon: "records" },
    { href: "/student/upcoming", label: "Upcoming lessons", icon: "academics" },
    { href: "/student/homework", label: "Homework", icon: "homework" },
    { href: "/student/materials", label: "Study material", icon: "materials" },
    { href: "/student/results", label: "Tests & results", icon: "reports" },
    { href: "/student/timetable", label: "Timetable", icon: "timetable" },
    { href: "/student/attendance", label: "Attendance", icon: "attendance" },
    { href: "/student/remarks", label: "Teacher remarks", icon: "teachers" },
    { href: "/student/notices", label: "Notices", icon: "notices" },
    { href: "/student/profile", label: "My profile", icon: "students" },
    { href: "/account", label: "Account", icon: "account" },
  ],
  PARENT: [
    { href: "/parent/dashboard", label: "Dashboard", icon: "dashboard", exact: true },
    // Everything about one child hangs off this entry, so the child's own
    // screens are reached from their card rather than from the sidebar: a
    // guardian with three children would otherwise need three of every link.
    { href: "/parent/children", label: "My children", icon: "children" },
    { href: "/parent/notices", label: "Notices", icon: "notices" },
    { href: "/parent/profile", label: "My profile", icon: "teachers" },
    { href: "/account", label: "Account", icon: "account" },
  ],
};
