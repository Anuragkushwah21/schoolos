import type { Route } from "next";

import type { StaffPermission, UserRole } from "@/generated/prisma/enums";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Navigation for each signed-in area.
 *
 * The sidebar is deliberately short and named for what people do ("Fees",
 * "Classes"), not how the software is built. Screens that belong together —
 * Students, Admissions and Parents; Holidays and Events — sit under one
 * sidebar entry and are reached from a row of tabs (`AREA_TABS`) at the top of
 * each of them, so nothing lost its page and every URL still works.
 *
 * Navigation is presentation only. Hiding a link authorizes nothing — every
 * page and action behind these links runs its own role and tenant check.
 */

export type NavItem = {
  href: Route;
  /** Dictionary key for the label (see `lib/i18n/messages`). */
  labelKey: MessageKey;
  icon: NavIcon;
  /** Match only the exact path, so "Home" is not active on every page. */
  exact?: boolean;
  /** Other paths this entry owns, so it stays highlighted on their pages. */
  match?: string[];
  /** Paths this entry owns only exactly, not their sub-pages. */
  matchExact?: string[];
};

export type NavIcon =
  | "dashboard"
  | "schools"
  | "offers"
  | "inbox"
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
  | "holidays"
  | "exams"
  | "leave"
  | "meetings"
  | "complaints"
  | "staff"
  | "transport"
  | "library"
  | "inventory"
  | "homework"
  | "records"
  | "materials"
  | "admissions"
  | "website"
  | "account"
  | "tokens"
  | "children"
  | "fees"
  | "expenses"
  | "settings"
  | "support";

export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  SUPER_ADMIN: [
    { href: "/super-admin/dashboard", labelKey: "nav.home", icon: "dashboard", exact: true },
    { href: "/super-admin/schools", labelKey: "nav.schools", icon: "schools" },
    { href: "/super-admin/plans", labelKey: "nav.plans", icon: "plans" },
    { href: "/super-admin/offers", labelKey: "nav.offers", icon: "offers" },
    { href: "/super-admin/inquiries", labelKey: "nav.enquiries", icon: "inbox" },
    { href: "/super-admin/audit", labelKey: "nav.auditLog", icon: "audit" },
    { href: "/api-tokens", labelKey: "nav.apiTokens", icon: "tokens" },
    { href: "/account", labelKey: "common.account", icon: "account" },
  ],
  // Each concept has its own entry: Events (something happening), Calendar
  // (a date overview), Notices (a message), Meetings (people meeting) and
  // Leave (an absence request). Screens that belong to one of these sit
  // behind it as tabs, so nothing lost its page.
  SCHOOL_ADMIN: [
    { href: "/school-admin/dashboard", labelKey: "nav.dashboard", icon: "dashboard", exact: true },
    { href: "/school-admin/students", labelKey: "nav.students", icon: "students", match: ["/school-admin/admissions", "/school-admin/parents", "/school-admin/support", "/school-admin/concerns"] },
    { href: "/school-admin/teachers", labelKey: "nav.teachersStaff", icon: "teachers", match: ["/school-admin/staff", "/school-admin/substitutes"] },
    { href: "/school-admin/academics/classes", labelKey: "nav.academics", icon: "academics", match: ["/school-admin/academics", "/school-admin/homework"] },
    { href: "/school-admin/attendance", labelKey: "nav.attendance", icon: "attendance", match: ["/school-admin/reports"] },
    { href: "/school-admin/exams", labelKey: "nav.exams", icon: "exams" },
    {
      href: "/school-admin/finance/payments",
      labelKey: "nav.fees",
      icon: "fees",
      match: ["/school-admin/finance/fees", "/school-admin/finance/receipts", "/school-admin/finance/expenses", "/school-admin/finance/salaries", "/school-admin/finance/payroll"],
      matchExact: ["/school-admin/finance"],
    },
    { href: "/school-admin/library", labelKey: "nav.library", icon: "library", match: ["/school-admin/inventory"] },
    { href: "/school-admin/transport", labelKey: "nav.transport", icon: "transport" },
    { href: "/school-admin/timetable", labelKey: "nav.timetable", icon: "timetable" },
    { href: "/school-admin/events", labelKey: "nav.events", icon: "events" },
    { href: "/school-admin/holidays", labelKey: "nav.calendar", icon: "holidays" },
    { href: "/school-admin/notices", labelKey: "nav.notices", icon: "notices", match: ["/school-admin/complaints"] },
    { href: "/school-admin/meetings", labelKey: "nav.meetings", icon: "meetings" },
    { href: "/school-admin/student-leave", labelKey: "nav.leave", icon: "leave", match: ["/school-admin/leave"] },
    { href: "/school-admin/settings", labelKey: "nav.settings", icon: "settings", match: ["/school-admin/website", "/school-admin/audit"] },
  ],
  TEACHER: [
    // The dashboard sits at /teacher/dashboard, not /teacher — see ROLE_HOME.
    { href: "/teacher/dashboard", labelKey: "nav.dashboard", icon: "dashboard", exact: true },
    { href: "/teacher/classes", labelKey: "nav.myClasses", icon: "students", match: ["/teacher/activities", "/teacher/students"] },
    { href: "/teacher/attendance", labelKey: "nav.attendance", icon: "attendance" },
    { href: "/teacher/timetable", labelKey: "nav.timetable", icon: "timetable" },
    { href: "/teacher/homework", labelKey: "nav.homework", icon: "homework" },
    { href: "/teacher/exams", labelKey: "nav.examsShort", icon: "exams" },
    { href: "/teacher/concerns", labelKey: "nav.studentConcerns", icon: "support", match: ["/teacher/support"] },
    { href: "/teacher/student-leave", labelKey: "nav.leaveRequests", icon: "leave", match: ["/teacher/leave"] },
    { href: "/teacher/notices", labelKey: "nav.notices", icon: "notices", match: ["/teacher/complaints"] },
    { href: "/teacher/events", labelKey: "nav.events", icon: "events" },
    { href: "/teacher/meetings", labelKey: "nav.meetings", icon: "meetings" },
    { href: "/teacher/holidays", labelKey: "nav.calendar", icon: "holidays" },
    { href: "/teacher/profile", labelKey: "nav.profile", icon: "teachers" },
  ],
  STUDENT: [
    { href: "/student/dashboard", labelKey: "nav.dashboard", icon: "dashboard", exact: true },
    { href: "/student/timetable", labelKey: "nav.timetable", icon: "timetable" },
    { href: "/student/attendance", labelKey: "nav.attendance", icon: "attendance" },
    { href: "/student/homework", labelKey: "nav.homework", icon: "homework" },
    { href: "/student/results", labelKey: "nav.results", icon: "reports" },
    { href: "/student/classes", labelKey: "nav.classes", icon: "records", match: ["/student/upcoming", "/student/lessons"] },
    { href: "/student/materials", labelKey: "nav.studyMaterial", icon: "materials" },
    { href: "/student/remarks", labelKey: "nav.remarks", icon: "teachers" },
    { href: "/student/library", labelKey: "nav.library", icon: "library" },
    { href: "/student/complaints", labelKey: "nav.concerns", icon: "support" },
    { href: "/student/leave", labelKey: "nav.leave", icon: "leave" },
    { href: "/student/notices", labelKey: "nav.notices", icon: "notices" },
    { href: "/student/events", labelKey: "nav.events", icon: "events" },
    { href: "/student/meetings", labelKey: "nav.meetings", icon: "meetings" },
    { href: "/student/holidays", labelKey: "nav.calendar", icon: "holidays" },
    { href: "/student/profile", labelKey: "nav.profile", icon: "students" },
  ],
  PARENT: [
    { href: "/parent/dashboard", labelKey: "nav.dashboard", icon: "dashboard", exact: true },
    // Everything about one child hangs off this entry. Attendance, Homework
    // and Results open the chosen child's page (or ask which child).
    { href: "/parent/children", labelKey: "nav.myChildren", icon: "children" },
    { href: "/parent/attendance", labelKey: "nav.attendance", icon: "attendance" },
    { href: "/parent/homework", labelKey: "nav.homework", icon: "homework" },
    { href: "/parent/results", labelKey: "nav.results", icon: "reports" },
    { href: "/parent/fees", labelKey: "nav.fees", icon: "fees" },
    { href: "/parent/concerns", labelKey: "nav.concerns", icon: "support", match: ["/parent/support"] },
    { href: "/parent/leave", labelKey: "nav.leave", icon: "leave" },
    { href: "/parent/notices", labelKey: "nav.notices", icon: "notices", match: ["/parent/complaints"] },
    { href: "/parent/events", labelKey: "nav.events", icon: "events" },
    { href: "/parent/meetings", labelKey: "nav.meetings", icon: "meetings" },
    { href: "/parent/holidays", labelKey: "nav.calendar", icon: "holidays" },
    { href: "/parent/profile", labelKey: "nav.profile", icon: "teachers" },
  ],
  // The base a staff login always has. Modules the School Admin grants are
  // added per person by `staffNav()`, because they differ from one staff
  // member to the next.
  NON_TEACHING_STAFF: [
    { href: "/staff/dashboard", labelKey: "nav.dashboard", icon: "dashboard", exact: true },
    { href: "/staff/attendance", labelKey: "nav.attendance", icon: "attendance" },
    { href: "/staff/leave", labelKey: "nav.leave", icon: "leave" },
    { href: "/staff/notices", labelKey: "nav.notices", icon: "notices" },
    { href: "/staff/events", labelKey: "nav.events", icon: "events" },
    { href: "/staff/meetings", labelKey: "nav.meetings", icon: "meetings" },
    { href: "/staff/holidays", labelKey: "nav.calendar", icon: "holidays" },
    { href: "/staff/profile", labelKey: "nav.profile", icon: "teachers" },
  ],
};

/** Sidebar entries for modules a staff member has been granted. */
export const STAFF_PERMISSION_NAV: Record<StaffPermission, NavItem> = {
  VIEW_STUDENTS: { href: "/staff/students", labelKey: "nav.students", icon: "students" },
  VIEW_LIBRARY: { href: "/staff/library", labelKey: "nav.library", icon: "library" },
  VIEW_TRANSPORT: { href: "/staff/transport", labelKey: "nav.transport", icon: "transport" },
  // Running the library is the same page with the desk controls switched on.
  MANAGE_LIBRARY: { href: "/staff/library", labelKey: "nav.library", icon: "library" },
  COLLECT_FEES: { href: "/staff/fees", labelKey: "nav.fees", icon: "fees" },
};

/** A staff member's sidebar: the base links with their granted modules after Home. */
export function staffNav(permissions: readonly StaffPermission[]): NavItem[] {
  const [home, ...rest] = NAV_BY_ROLE.NON_TEACHING_STAFF;
  const granted = (Object.keys(STAFF_PERMISSION_NAV) as StaffPermission[])
    .filter((permission) => permissions.includes(permission))
    .map((permission) => STAFF_PERMISSION_NAV[permission])
    .filter((item, index, all) => all.findIndex((other) => other.href === item.href) === index);
  return [home!, ...granted, ...rest];
}

/** Whether `pathname` is on a nav entry's page or one it owns. */
export function isNavActive(item: Pick<NavItem, "href" | "exact" | "match" | "matchExact">, pathname: string): boolean {
  const on = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (item.exact) return pathname === item.href;
  return on(item.href) || (item.match ?? []).some(on) || (item.matchExact ?? []).includes(pathname);
}

// -----------------------------------------------------------------------------
// Tabs: screens that share one sidebar entry
// -----------------------------------------------------------------------------

export type AreaTab = { href: Route; labelKey: MessageKey; exact?: boolean };

/**
 * Each group is shown as tabs on every page it contains. A page belongs to the
 * first group with a tab whose path it is on (exact tabs match only
 * themselves). Pages in no group show no tabs.
 */
export const AREA_TABS: Partial<Record<UserRole, AreaTab[][]>> = {
  SCHOOL_ADMIN: [
    [
      { href: "/school-admin/students", labelKey: "tabs.allStudents" },
      { href: "/school-admin/admissions", labelKey: "tabs.admissions" },
      { href: "/school-admin/parents", labelKey: "tabs.parents" },
      { href: "/school-admin/support", labelKey: "tabs.support" },
      { href: "/school-admin/concerns", labelKey: "tabs.concerns" },
    ],
    [
      { href: "/school-admin/teachers", labelKey: "tabs.teachers" },
      { href: "/school-admin/staff", labelKey: "tabs.staff" },
      { href: "/school-admin/substitutes", labelKey: "tabs.substitutes" },
    ],
    [
      { href: "/school-admin/academics/classes", labelKey: "tabs.classesSections" },
      { href: "/school-admin/academics/class-teachers", labelKey: "tabs.classTeachers" },
      { href: "/school-admin/academics/rooms", labelKey: "tabs.rooms" },
      { href: "/school-admin/homework", labelKey: "tabs.homework" },
      { href: "/school-admin/academics", labelKey: "tabs.setup", exact: true },
    ],
    [
      { href: "/school-admin/attendance", labelKey: "tabs.studentAttendance" },
      { href: "/school-admin/attendance/absent", labelKey: "absentees.tab" },
      { href: "/school-admin/attendance/staff", labelKey: "tabs.staffAttendance" },
      { href: "/school-admin/reports", labelKey: "tabs.attendanceReports" },
    ],
    [
      { href: "/school-admin/finance/payments", labelKey: "tabs.payments" },
      { href: "/school-admin/finance/fees", labelKey: "tabs.feeStructure" },
      { href: "/school-admin/finance/receipts", labelKey: "tabs.receipts" },
      { href: "/school-admin/finance", labelKey: "tabs.overview", exact: true },
      { href: "/school-admin/finance/expenses", labelKey: "tabs.expenses" },
      { href: "/school-admin/finance/salaries", labelKey: "tabs.salaries" },
      { href: "/school-admin/finance/payroll", labelKey: "tabs.payroll" },
    ],
    [
      { href: "/school-admin/library", labelKey: "tabs.library" },
      { href: "/school-admin/library/loans", labelKey: "tabs.loans" },
      { href: "/school-admin/inventory", labelKey: "tabs.inventory" },
    ],
    [
      { href: "/school-admin/notices", labelKey: "tabs.notices" },
      { href: "/school-admin/complaints", labelKey: "tabs.complaints" },
    ],
    [
      { href: "/school-admin/student-leave", labelKey: "tabs.studentLeave" },
      { href: "/school-admin/leave", labelKey: "tabs.staffLeave" },
    ],
  ],
  TEACHER: [
    [
      { href: "/teacher/student-leave", labelKey: "tabs.studentLeave" },
      { href: "/teacher/leave", labelKey: "tabs.myLeave" },
    ],
    [
      { href: "/teacher/concerns", labelKey: "tabs.concerns" },
      { href: "/teacher/support", labelKey: "tabs.support" },
    ],
    [
      { href: "/teacher/classes", labelKey: "tabs.myClasses" },
      { href: "/teacher/activities", labelKey: "tabs.classRecords" },
    ],
    [
      { href: "/teacher/notices", labelKey: "tabs.notices" },
      { href: "/teacher/complaints", labelKey: "tabs.complaints" },
    ],
  ],
  PARENT: [
    [
      { href: "/parent/concerns", labelKey: "tabs.concerns" },
      { href: "/parent/support", labelKey: "nav.childSupport" },
    ],
    [
      { href: "/parent/notices", labelKey: "tabs.notices" },
      { href: "/parent/complaints", labelKey: "tabs.complaints" },
    ],
  ],
};

export function isTabActive(tab: AreaTab, pathname: string): boolean {
  return tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

/** The tab group for `pathname`, if it belongs to one, and which tab is current. */
export function tabsFor(role: UserRole, pathname: string): { tabs: AreaTab[]; active: Route } | null {
  for (const group of AREA_TABS[role] ?? []) {
    // The most specific match wins: "Books out" over "Library" on /library/loans.
    const matches = group.filter((tab) => isTabActive(tab, pathname)).sort((a, b) => b.href.length - a.href.length);
    if (matches[0]) return { tabs: group, active: matches[0].href };
  }
  return null;
}

/**
 * The few destinations a phone's bottom bar shows; everything else is one tap
 * away under "More". Chosen for daily use, not completeness.
 */
export const MOBILE_PRIMARY: Partial<Record<UserRole, Route[]>> = {
  SCHOOL_ADMIN: ["/school-admin/dashboard", "/school-admin/students", "/school-admin/attendance", "/school-admin/finance/payments"],
  TEACHER: ["/teacher/dashboard", "/teacher/attendance", "/teacher/homework", "/teacher/timetable"],
  STUDENT: ["/student/dashboard", "/student/homework", "/student/results", "/student/timetable"],
  PARENT: ["/parent/dashboard", "/parent/children", "/parent/fees", "/parent/meetings"],
  NON_TEACHING_STAFF: ["/staff/dashboard", "/staff/meetings", "/staff/notices", "/staff/profile"],
  SUPER_ADMIN: ["/super-admin/dashboard", "/super-admin/schools", "/super-admin/inquiries", "/super-admin/audit"],
};
