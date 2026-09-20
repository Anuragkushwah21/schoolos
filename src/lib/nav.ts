import type { UserRole } from "@/generated/prisma/enums";

/**
 * Sidebar navigation for each signed-in area.
 *
 * Navigation is presentation only. Hiding a link authorizes nothing — every
 * page and action behind these links runs its own role and tenant check.
 */

export type NavItem = {
  href: string;
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
  | "admissions"
  | "website"
  | "account"
  | "tokens"
  | "children";

export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  SUPER_ADMIN: [
    { href: "/platform", label: "Overview", icon: "dashboard", exact: true },
    { href: "/platform/schools", label: "Schools", icon: "schools" },
    { href: "/platform/plans", label: "Plans", icon: "plans" },
    { href: "/platform/offers", label: "Offers", icon: "offers" },
    { href: "/platform/audit", label: "Audit log", icon: "audit" },
    { href: "/api-tokens", label: "API tokens", icon: "tokens" },
    { href: "/account", label: "Account", icon: "account" },
  ],
  SCHOOL_ADMIN: [
    { href: "/admin", label: "Dashboard", icon: "dashboard", exact: true },
    { href: "/admin/students", label: "Students", icon: "students" },
    { href: "/admin/teachers", label: "Teachers", icon: "teachers" },
    { href: "/admin/academics", label: "Academics", icon: "academics" },
    { href: "/admin/timetable", label: "Timetable", icon: "timetable" },
    { href: "/admin/attendance", label: "Attendance", icon: "attendance" },
    { href: "/admin/reports", label: "Reports", icon: "reports" },
    { href: "/admin/admissions", label: "Admissions", icon: "admissions" },
    { href: "/admin/notices", label: "Notices", icon: "notices" },
    { href: "/admin/events", label: "Events", icon: "events" },
    { href: "/admin/website", label: "Website", icon: "website" },
    { href: "/api-tokens", label: "API tokens", icon: "tokens" },
    { href: "/account", label: "Account", icon: "account" },
  ],
  TEACHER: [
    { href: "/teacher", label: "Dashboard", icon: "dashboard", exact: true },
    { href: "/teacher/timetable", label: "Timetable", icon: "timetable" },
    { href: "/teacher/attendance", label: "Attendance", icon: "attendance" },
    { href: "/teacher/notices", label: "Notices", icon: "notices" },
    { href: "/account", label: "Account", icon: "account" },
  ],
  STUDENT: [
    { href: "/student", label: "Dashboard", icon: "dashboard", exact: true },
    { href: "/student/timetable", label: "Timetable", icon: "timetable" },
    { href: "/student/attendance", label: "Attendance", icon: "attendance" },
    { href: "/student/notices", label: "Notices", icon: "notices" },
    { href: "/account", label: "Account", icon: "account" },
  ],
  PARENT: [
    { href: "/parent", label: "Dashboard", icon: "dashboard", exact: true },
    { href: "/parent/children", label: "Children", icon: "children" },
    { href: "/parent/notices", label: "Notices", icon: "notices" },
    { href: "/account", label: "Account", icon: "account" },
  ],
};
