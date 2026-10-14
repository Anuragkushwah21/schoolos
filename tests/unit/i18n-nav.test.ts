/**
 * The interface-language layer and the simplified navigation.
 */
import { describe, expect, it } from "vitest";

import { LOCALES, isLocale } from "@/lib/i18n/config";
import { MESSAGES } from "@/lib/i18n/messages";
import { en } from "@/lib/i18n/messages/en";
import { createTranslator, translateDynamic } from "@/lib/i18n/translate";
import { AREA_TABS, MOBILE_PRIMARY, NAV_BY_ROLE, STAFF_MODULE_NAV, isNavActive, staffNav, tabsFor } from "@/lib/nav";
import { formatMoney, formatNumber } from "@/lib/format";
import { formatDate } from "@/lib/dates";

/** Every leaf key of a dictionary, as dot paths. */
function leaves(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}

describe("translations", () => {
  it("covers every English key in every language, with the same placeholders", () => {
    const keys = leaves(en);
    for (const locale of LOCALES) {
      const t = createTranslator(MESSAGES[locale]);
      for (const key of keys) {
        const value = t(key as never);
        expect(value, `${locale}:${key}`).not.toBe("");
        const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
        expect(placeholders(value), `${locale}:${key}`).toEqual(placeholders(createTranslator(en)(key as never)));
      }
    }
  });

  it("fills placeholders and translates the interface, not the data", () => {
    const hi = createTranslator(MESSAGES.hi);
    expect(createTranslator(en)("dashboard.admin.addStudent")).toBe("Add student");
    expect(hi("dashboard.admin.addStudent")).toBe("छात्र जोड़ें");
    // A name passed in is shown exactly as written.
    expect(hi("greeting.morning", { name: "Rahul Sharma" })).toBe("सुप्रभात, Rahul Sharma");
  });

  it("falls back to English, then to the value itself, for unknown keys", () => {
    expect(translateDynamic(MESSAGES.hi, "status.PRESENT", "Present")).toBe("उपस्थित");
    expect(translateDynamic(MESSAGES.hi, "status.SOMETHING_NEW", "Something new")).toBe("Something new");
  });

  it("accepts only known languages", () => {
    expect(isLocale("hi")).toBe(true);
    expect(isLocale("xx")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("formats money and numbers the Indian way in both languages", () => {
    expect(formatMoney(3_500_000)).toBe("₹35,000");
    expect(formatNumber(150_000)).toBe("1,50,000");
    expect(formatNumber(150_000, "hi-IN")).toBe("1,50,000");
    expect(formatDate(new Date(Date.UTC(2026, 8, 18)), "hi-IN")).toMatch(/2026/);
  });
});

describe("navigation", () => {
  const t = createTranslator(en);

  it("gives every sidebar entry and tab a real label", () => {
    const items = [...Object.values(NAV_BY_ROLE).flat(), ...STAFF_MODULE_NAV.map((entry) => entry.item)];
    for (const item of items) expect(t(item.labelKey)).not.toBe(item.labelKey);
    for (const tab of Object.values(AREA_TABS).flat(2)) expect(t(tab!.labelKey)).not.toBe(tab!.labelKey);
  });

  it("gives the School Admin their daily places directly, in groups", () => {
    const admin = NAV_BY_ROLE.SCHOOL_ADMIN.map((item) => item.labelKey);
    expect(admin).toEqual([
      "nav.dashboard",
      "nav.students",
      "nav.attendance",
      "nav.leave",
      "nav.parents",
      "nav.teachers",
      "nav.nonTeachingStaff",
      "nav.financeAccounts",
      "nav.library",
      "nav.communication",
      "nav.security",
      "nav.frontDesk",
      "nav.transport",
      "nav.reports",
      "nav.documents",
      "nav.calendar",
      "nav.timetable",
      "nav.classesExams",
      "nav.academicProgress",
      "nav.responsibilities",
      "nav.principal",
      "nav.settings",
      "nav.profile",
    ]);
    const groups = NAV_BY_ROLE.SCHOOL_ADMIN.flatMap((item) => (item.group ? [item.group] : []));
    expect(groups).toEqual(["nav.groupDaily", "nav.groupOffice", "nav.groupPlanning", "nav.groupAccount"]);
    for (const group of groups) expect(t(group)).not.toBe(group);
  });

  it("highlights exactly one owning entry for every admin page", () => {
    const admin = NAV_BY_ROLE.SCHOOL_ADMIN;
    const activeOn = (path: string) => admin.filter((item) => isNavActive(item, path)).map((item) => item.labelKey);
    const owner: Record<string, string> = {
      "/school-admin/dashboard": "nav.dashboard",
      "/school-admin/students/abc": "nav.students",
      "/school-admin/support": "nav.students",
      "/school-admin/concerns": "nav.students",
      "/school-admin/attendance": "nav.attendance",
      "/school-admin/attendance/staff": "nav.attendance",
      "/school-admin/leave": "nav.leave",
      "/school-admin/student-leave": "nav.leave",
      "/school-admin/parents": "nav.parents",
      "/school-admin/teachers": "nav.teachers",
      "/school-admin/substitutes": "nav.teachers",
      "/school-admin/staff/abc": "nav.nonTeachingStaff",
      "/school-admin/staff/workspaces": "nav.nonTeachingStaff",
      "/school-admin/finance": "nav.financeAccounts",
      "/school-admin/finance/payroll": "nav.financeAccounts",
      "/school-admin/inventory": "nav.library",
      "/school-admin/notices": "nav.communication",
      "/school-admin/meetings": "nav.communication",
      "/school-admin/events": "nav.communication",
      "/school-admin/visitors": "nav.security",
      "/school-admin/admissions": "nav.frontDesk",
      "/school-admin/admissions/enquiries": "nav.frontDesk",
      "/school-admin/admissions/drives": "nav.frontDesk",
      "/school-admin/transport": "nav.transport",
      "/school-admin/reports": "nav.reports",
      "/school-admin/audit": "nav.reports",
      "/school-admin/holidays": "nav.calendar",
      "/school-admin/timetable": "nav.timetable",
      "/school-admin/academics/classes": "nav.classesExams",
      "/school-admin/homework": "nav.classesExams",
      "/school-admin/exams/pending": "nav.classesExams",
      "/school-admin/responsibilities": "nav.responsibilities",
      "/school-admin/principal": "nav.principal",
      "/school-admin/website/admission": "nav.settings",
      "/account": "nav.profile",
    };
    for (const [path, key] of Object.entries(owner)) expect(activeOn(path), path).toEqual([key]);
  });

  it("gives Events, Calendar, Notices, Meetings and Leave each their own entry, for every role", () => {
    // The School Admin reaches these through the Communication and Operations workspaces (tested above).
    const own = { TEACHER: "/teacher", PARENT: "/parent", STUDENT: "/student", NON_TEACHING_STAFF: "/staff" } as const;
    for (const [role, base] of Object.entries(own)) {
      const items = NAV_BY_ROLE[role as keyof typeof own];
      const keys = items.map((item) => item.labelKey);
      const noticesKey = "nav.notices";
      for (const key of ["nav.events", "nav.calendar", noticesKey, "nav.meetings"]) expect(keys, `${role} ${key}`).toContain(key);
      expect(keys.some((key) => key === "nav.leave" || key === "nav.leaveRequests"), `${role} leave`).toBe(true);
      // None of them owns another's page.
      const events = items.find((item) => item.labelKey === "nav.events")!;
      const notices = items.find((item) => item.labelKey === noticesKey)!;
      const calendar = items.find((item) => item.labelKey === "nav.calendar")!;
      expect(isNavActive(notices, `${base}/events`)).toBe(false);
      expect(isNavActive(notices, `${base}/holidays`)).toBe(false);
      expect(isNavActive(calendar, `${base}/events`)).toBe(false);
      expect(isNavActive(events, `${base}/holidays`)).toBe(false);
    }
    // No tab group puts the calendar or events behind Notices any more.
    for (const group of Object.values(AREA_TABS).flat()) {
      const hrefs = group!.map((tab) => tab.href);
      if (hrefs.some((href) => href.endsWith("/notices"))) {
        expect(hrefs.some((href) => href.endsWith("/holidays") || href.endsWith("/events"))).toBe(false);
      }
    }
  });

  it("picks the most specific tab", () => {
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/library/loans")?.active).toBe("/school-admin/library/loans");
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/library/xyz")?.active).toBe("/school-admin/library");
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/attendance/staff")?.active).toBe("/school-admin/attendance/staff");
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/finance")?.active).toBe("/school-admin/finance");
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/meetings")).toBeNull();
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/events")).toBeNull();
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/leave")?.active).toBe("/school-admin/leave");
    expect(tabsFor("TEACHER", "/teacher/leave")?.tabs.map((tab) => tab.href)).toEqual(["/teacher/student-leave", "/teacher/leave"]);
  });

  it("never shows a student fees, and shows staff only what they were granted", () => {
    expect(NAV_BY_ROLE.STUDENT.some((item) => item.href.includes("fee"))).toBe(false);
    expect(staffNav([]).map((item) => item.href)).toEqual(NAV_BY_ROLE.NON_TEACHING_STAFF.map((item) => item.href));
    expect(staffNav(["library.view"]).map((item) => item.href)).toContain("/staff/library");
    expect(staffNav(["library.view"]).map((item) => item.href)).not.toContain("/staff/students");
    // "My route" needs the grant and a route to show.
    expect(staffNav(["transport.myroute"]).map((item) => item.href)).not.toContain("/staff/my-route");
    expect(staffNav(["transport.myroute"], { assignedRoute: true }).map((item) => item.href)).toContain("/staff/my-route");
  });

  it("puts only real sidebar destinations in the phone's bottom bar", () => {
    for (const [role, hrefs] of Object.entries(MOBILE_PRIMARY)) {
      const nav = NAV_BY_ROLE[role as keyof typeof NAV_BY_ROLE].map((item) => item.href);
      for (const href of hrefs!) expect(nav, `${role} ${href}`).toContain(href);
    }
  });
});
