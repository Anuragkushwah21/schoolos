import type { Route } from "next";

import type { UserRole } from "@/generated/prisma/enums";
import type { StaffGrant } from "@/lib/staff-access";
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
  /** A heading shown above this entry when it starts a new group of the sidebar. */
  group?: MessageKey;
  /** A count of things waiting here for this person, shown as a small badge. */
  badge?: number;
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
  | "support"
  | "visitors";

export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  // The platform owner governs schools, never a school's daily work: no
  // students, attendance, fees or timetable here — those are each school's.
  SUPER_ADMIN: [
    // Five groups (10 Oct 2026): what is happening, the customers, what is
    // sold, what customers asked for, and the platform itself.
    { href: "/super-admin/dashboard", labelKey: "nav.dashboard", icon: "dashboard", exact: true, group: "nav.groupOverview" },
    { href: "/super-admin/reports" as Route, labelKey: "nav.platformReports", icon: "reports" },
    { href: "/super-admin/organizations" as Route, labelKey: "nav.organizations", icon: "schools", group: "nav.groupCustomers" },
    { href: "/super-admin/schools", labelKey: "nav.schools", icon: "schools" },
    { href: "/super-admin/approvals" as Route, labelKey: "nav.approvals", icon: "inbox" },
    { href: "/super-admin/campus-requests" as Route, labelKey: "nav.campusRequests", icon: "schools" },
    { href: "/super-admin/plans", labelKey: "nav.featuresPlans", icon: "plans", group: "nav.groupPlans" },
    { href: "/super-admin/feature-requests" as Route, labelKey: "nav.featureRequests", icon: "plans" },
    { href: "/super-admin/plan-requests" as Route, labelKey: "nav.planRequests", icon: "plans", group: "nav.groupRequests" },
    { href: "/super-admin/offers", labelKey: "nav.offers", icon: "offers" },
    { href: "/super-admin/inquiries", labelKey: "nav.enquiries", icon: "inbox" },
    { href: "/super-admin/settings" as Route, labelKey: "nav.platformSettings", icon: "settings", match: ["/api-tokens", "/account"], group: "nav.groupPlatform" },
    { href: "/super-admin/audit", labelKey: "nav.auditLogs", icon: "audit" },
  ],
  // Each concept has its own entry: Events (something happening), Calendar
  // (a date overview), Notices (a message), Meetings (people meeting) and
  // Leave (an absence request). Screens that belong to one of these sit
  // behind it as tabs, so nothing lost its page.
  SCHOOL_ADMIN: [
    // The admin's daily places, one click each (7 Oct 2026), in groups:
    // daily work, the school office, planning and review, and their account.
    // Each entry owns its related pages, so exactly one stays highlighted;
    // pages that share an entry are reached by the tabs above them.
    { href: "/school-admin/dashboard", labelKey: "nav.dashboard", icon: "dashboard", exact: true },
    { href: "/school-admin/students", labelKey: "nav.students", icon: "students", match: ["/school-admin/concerns", "/school-admin/support"], group: "nav.groupDaily" },
    { href: "/school-admin/attendance", labelKey: "nav.attendance", icon: "attendance" },
    // Staff and teacher leave come to the admin to decide; student leave comes
    // here for final approval after the class teacher's review.
    { href: "/school-admin/leave", labelKey: "nav.leave", icon: "leave", match: ["/school-admin/student-leave"] },
    { href: "/school-admin/parents", labelKey: "nav.parents", icon: "children" },
    { href: "/school-admin/teachers", labelKey: "nav.teachers", icon: "teachers", match: ["/school-admin/substitutes"] },
    { href: "/school-admin/staff", labelKey: "nav.nonTeachingStaff", icon: "staff" },
    { href: "/school-admin/finance", labelKey: "nav.financeAccounts", icon: "fees", group: "nav.groupOffice" },
    { href: "/school-admin/library", labelKey: "nav.library", icon: "library", match: ["/school-admin/inventory"] },
    { href: "/school-admin/communication", labelKey: "nav.communication", icon: "notices", match: ["/school-admin/notices", "/school-admin/complaints", "/school-admin/events", "/school-admin/meetings"] },
    { href: "/school-admin/visitors", labelKey: "nav.security", icon: "visitors" },
    { href: "/school-admin/admissions/enquiries" as Route, labelKey: "nav.frontDesk", icon: "admissions", match: ["/school-admin/admissions"] },
    { href: "/school-admin/transport", labelKey: "nav.transport", icon: "transport" },
    { href: "/school-admin/reports", labelKey: "nav.reports", icon: "reports", match: ["/school-admin/audit"], group: "nav.groupPlanning" },
    { href: "/school-admin/holidays", labelKey: "nav.calendar", icon: "holidays" },
    { href: "/school-admin/timetable", labelKey: "nav.timetable", icon: "timetable" },
    { href: "/school-admin/academics", labelKey: "nav.classesExams", icon: "academics", match: ["/school-admin/homework", "/school-admin/exams"] },
    { href: "/school-admin/responsibilities", labelKey: "nav.responsibilities", icon: "records" },
    { href: "/school-admin/principal", labelKey: "nav.principal", icon: "teachers" },
    { href: "/school-admin/settings", labelKey: "nav.settings", icon: "settings", match: ["/school-admin/website", "/school-admin/setup"], group: "nav.groupAccount" },
    { href: "/account", labelKey: "nav.profile", icon: "account", match: ["/api-tokens"] },
  ],
  // A working school leader: the School Admin's own screens for students,
  // teachers, academics, attendance, homework, exams, communication and
  // leave, plus delegation. Not finance, settings, staff permissions or the
  // optional modules — the School Admin's (lib/permissions.ts enforces it).
  PRINCIPAL: [
    { href: "/principal/dashboard" as Route, labelKey: "nav.dashboard", icon: "dashboard", exact: true },
    { href: "/school-admin/students", labelKey: "nav.students", icon: "students", match: ["/school-admin/parents", "/school-admin/concerns", "/school-admin/support", "/school-admin/admissions"], group: "nav.groupLead" },
    { href: "/school-admin/teachers", labelKey: "nav.teachersStaff", icon: "teachers", match: ["/school-admin/substitutes"] },
    { href: "/school-admin/academics", labelKey: "nav.academics", icon: "academics", match: ["/school-admin/timetable", "/principal/classes"] },
    { href: "/school-admin/attendance", labelKey: "nav.attendance", icon: "attendance" },
    { href: "/school-admin/homework", labelKey: "nav.homeworkLearning", icon: "homework" },
    { href: "/school-admin/exams", labelKey: "nav.exams", icon: "exams" },
    { href: "/school-admin/communication", labelKey: "nav.communication", icon: "notices", match: ["/school-admin/notices", "/school-admin/events", "/school-admin/meetings", "/school-admin/complaints"], group: "nav.groupSchoolLife" },
    { href: "/school-admin/holidays", labelKey: "nav.calendar", icon: "holidays" },
    { href: "/school-admin/leave", labelKey: "nav.leave", icon: "leave", match: ["/school-admin/student-leave"] },
    { href: "/school-admin/responsibilities", labelKey: "nav.responsibilities", icon: "records", group: "nav.groupDelegate" },
    { href: "/school-admin/reports", labelKey: "nav.reports", icon: "reports" },
    { href: "/account", labelKey: "nav.profile", icon: "account", group: "nav.groupAccount" },
  ],
  TEACHER: [
    // The dashboard sits at /teacher/dashboard, not /teacher — see ROLE_HOME.
    { href: "/teacher/dashboard", labelKey: "nav.dashboard", icon: "dashboard", exact: true },
    { href: "/teacher/classes", labelKey: "nav.myClasses", icon: "students", match: ["/teacher/activities", "/teacher/students"] },
    { href: "/teacher/attendance", labelKey: "nav.attendance", icon: "attendance" },
    { href: "/teacher/timetable", labelKey: "nav.timetable", icon: "timetable" },
    { href: "/teacher/homework", labelKey: "nav.homework", icon: "homework" },
    { href: "/teacher/exams", labelKey: "nav.examsTests", icon: "exams" },
    { href: "/teacher/concerns", labelKey: "nav.studentConcerns", icon: "support", match: ["/teacher/support"] },
    { href: "/teacher/student-leave", labelKey: "nav.leaveRequests", icon: "leave", match: ["/teacher/leave"] },
    { href: "/teacher/notices", labelKey: "nav.notices", icon: "notices", match: ["/teacher/complaints"] },
    { href: "/teacher/events", labelKey: "nav.events", icon: "events" },
    { href: "/teacher/meetings", labelKey: "nav.meetings", icon: "meetings" },
    { href: "/teacher/holidays", labelKey: "nav.calendar", icon: "holidays" },
    { href: "/teacher/responsibilities", labelKey: "nav.myResponsibilities", icon: "records" },
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
    { href: "/staff/responsibilities", labelKey: "nav.myResponsibilities", icon: "records" },
    { href: "/staff/profile", labelKey: "nav.profile", icon: "teachers" },
  ],
};

/**
 * Sidebar entries for staff modules, each shown when the person holds any of
 * its grants. Presentation only — every page and service checks again.
 */
export const STAFF_MODULE_NAV: Array<{ grants: readonly StaffGrant[]; item: NavItem }> = [
  { grants: ["transport.myroute"], item: { href: "/staff/my-route", labelKey: "nav.myRoute", icon: "transport" } },
  { grants: ["library.view"], item: { href: "/staff/library", labelKey: "nav.library", icon: "library" } },
  { grants: ["fees.view", "fees.collect", "fees.manage", "expenses.view", "payroll.view", "fees.reports"], item: { href: "/staff/finance", labelKey: "nav.finance", icon: "reports" } },
  { grants: ["fees.view", "fees.collect", "fees.manage"], item: { href: "/staff/fees", labelKey: "nav.fees", icon: "fees" } },
  { grants: ["expenses.view"], item: { href: "/staff/expenses", labelKey: "nav.expenses", icon: "expenses" } },
  { grants: ["payroll.view"], item: { href: "/staff/payroll", labelKey: "nav.payroll", icon: "fees" } },
  { grants: ["inventory.view"], item: { href: "/staff/inventory", labelKey: "nav.inventory", icon: "inventory" } },
  { grants: ["enquiries.view"], item: { href: "/staff/enquiries", labelKey: "nav.enquiries", icon: "inbox" } },
  { grants: ["admissions.view"], item: { href: "/staff/admissions", labelKey: "nav.applications", icon: "records" } },
  { grants: ["visitors.view", "visitors.manage"], item: { href: "/staff/visitors", labelKey: "nav.visitors", icon: "visitors" } },
  { grants: ["students.directory"], item: { href: "/staff/students", labelKey: "nav.students", icon: "students" } },
  { grants: ["transport.routes"], item: { href: "/staff/transport", labelKey: "nav.transport", icon: "transport" } },
];

/** The Super Admin's sidebar, with how many schools wait for approval on Approvals. */
export function superAdminNav(counts: { pending: number; campusRequests?: number; planRequests?: number }): NavItem[] {
  return NAV_BY_ROLE.SUPER_ADMIN.map((item) =>
    item.href === "/super-admin/approvals" && counts.pending
      ? { ...item, badge: counts.pending }
      : item.href === "/super-admin/campus-requests" && counts.campusRequests
        ? { ...item, badge: counts.campusRequests }
        : item.href === "/super-admin/plan-requests" && counts.planRequests
          ? { ...item, badge: counts.planRequests }
          : item,
  );
}

/** The School Admin's sidebar, with how many leave requests wait for their decision on the Leave entry. */
export function adminNav(counts: { leave: number; modulesToEnable?: number }, options: { campuses?: boolean } = {}): NavItem[] {
  const items = NAV_BY_ROLE.SCHOOL_ADMIN.map((item) => (item.href === "/school-admin/leave" && counts.leave ? { ...item, badge: counts.leave } : item));
  // My Schools (campus requests on every plan, switching, All Campuses, Upgrade Plan).
  if (options.campuses ?? true) items.splice(items.findIndex((item) => item.href === "/school-admin/settings"), 0, { href: "/school-admin/campuses" as Route, labelKey: "nav.mySchools", icon: "schools", match: ["/school-admin/plan", "/school-admin/feature-requests"], ...(counts.modulesToEnable ? { badge: counts.modulesToEnable } : {}) });
  return items;
}

/** A teacher's sidebar: the usual one, plus Admissions while the School Admin has given them admission work. */
export function teacherNav(options: { admissions?: boolean } = {}): NavItem[] {
  const items = [...NAV_BY_ROLE.TEACHER];
  if (options.admissions) items.splice(items.findIndex((item) => item.href === "/teacher/concerns"), 0, { href: "/teacher/admissions", labelKey: "nav.admissions", icon: "records" });
  return items;
}

/**
 * A staff member's sidebar: Home, then the modules their grants open, then
 * the pages every staff member has. "My route" also needs a route to show —
 * their own, or one they cover as a substitute.
 */
export function staffNav(grants: readonly string[], options: { assignedRoute?: boolean } = {}): NavItem[] {
  const [home, ...rest] = NAV_BY_ROLE.NON_TEACHING_STAFF;
  const modules = STAFF_MODULE_NAV.filter(({ grants: needs, item }) => needs.some((grant) => grants.includes(grant)) && (item.href !== "/staff/my-route" || options.assignedRoute)).map(({ item }) => item);
  return [home!, ...modules, ...rest];
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
      { href: "/school-admin/support", labelKey: "tabs.support" },
      { href: "/school-admin/concerns", labelKey: "tabs.concerns" },
    ],
    [
      { href: "/school-admin/admissions/enquiries", labelKey: "tabs.enquiries" },
      { href: "/school-admin/admissions", labelKey: "tabs.applications" },
      { href: "/school-admin/admissions/drives", labelKey: "tabs.drives" },
    ],
    [
      { href: "/school-admin/teachers", labelKey: "tabs.teachers" },
      { href: "/school-admin/substitutes", labelKey: "tabs.substitutes" },
    ],
    [
      { href: "/school-admin/staff", labelKey: "tabs.staff", exact: true },
      { href: "/school-admin/staff/workspaces", labelKey: "tabs.workspaces" },
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
      { href: "/school-admin/finance/family", labelKey: "tabs.familyPayment" },
      { href: "/school-admin/finance/carry-forward", labelKey: "tabs.carryForward" },
      { href: "/school-admin/finance/reports" as Route, labelKey: "tabs.feeReports" },
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
      { href: "/school-admin/exams", labelKey: "tabs.allTests", exact: true },
      { href: "/school-admin/exams/pending", labelKey: "tabs.pendingMarks" },
      { href: "/school-admin/exams/results", labelKey: "tabs.publishedResults" },
      { href: "/school-admin/exams/performance", labelKey: "tabs.studentPerformance" },
      { href: "/school-admin/exams/term", labelKey: "tabs.termExams" },
      { href: "/school-admin/exams/final" as Route, labelKey: "tabs.finalResult" },
    ],
    [
      { href: "/school-admin/notices", labelKey: "tabs.notices" },
      { href: "/school-admin/complaints", labelKey: "tabs.complaints" },
    ],
    [
      { href: "/school-admin/leave", labelKey: "tabs.staffLeave" },
      { href: "/school-admin/student-leave", labelKey: "tabs.studentLeave" },
    ],
    [
      { href: "/school-admin/website", labelKey: "tabs.websiteSite", exact: true },
      { href: "/school-admin/website/admission", labelKey: "tabs.admissionForm" },
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
      { href: "/teacher/exams", labelKey: "tabs.myTests", exact: true },
      { href: "/teacher/exams/new", labelKey: "tabs.createTest" },
      { href: "/teacher/exams/attention", labelKey: "tabs.studentPerformance" },
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

// The Principal shares the School Admin's screens, so the same tab rows —
// without those leading into finance, the library, the website or staff permissions.
AREA_TABS.PRINCIPAL = (AREA_TABS.SCHOOL_ADMIN ?? [])
  .map((group) => group.filter((tab) => !/^\/school-admin\/(finance|library|inventory|website|staff)/.test(tab.href)))
  .filter((group) => group.length > 1);

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
  SCHOOL_ADMIN: ["/school-admin/dashboard", "/school-admin/students", "/school-admin/attendance", "/school-admin/finance"],
  PRINCIPAL: ["/principal/dashboard" as Route, "/school-admin/students", "/school-admin/attendance", "/school-admin/exams"],
  TEACHER: ["/teacher/dashboard", "/teacher/attendance", "/teacher/homework", "/teacher/timetable"],
  STUDENT: ["/student/dashboard", "/student/homework", "/student/results", "/student/timetable"],
  PARENT: ["/parent/dashboard", "/parent/children", "/parent/fees", "/parent/meetings"],
  NON_TEACHING_STAFF: ["/staff/dashboard", "/staff/meetings", "/staff/notices", "/staff/profile"],
  SUPER_ADMIN: ["/super-admin/dashboard", "/super-admin/schools", "/super-admin/approvals" as Route, "/super-admin/reports" as Route],
};
