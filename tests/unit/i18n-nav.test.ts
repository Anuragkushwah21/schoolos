/**
 * The interface-language layer and the simplified navigation.
 */
import { describe, expect, it } from "vitest";

import { LOCALES, isLocale } from "@/lib/i18n/config";
import { MESSAGES } from "@/lib/i18n/messages";
import { en } from "@/lib/i18n/messages/en";
import { createTranslator, translateDynamic } from "@/lib/i18n/translate";
import { AREA_TABS, MOBILE_PRIMARY, NAV_BY_ROLE, STAFF_PERMISSION_NAV, isNavActive, staffNav, tabsFor } from "@/lib/nav";
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
    const items = [...Object.values(NAV_BY_ROLE).flat(), ...Object.values(STAFF_PERMISSION_NAV)];
    for (const item of items) expect(t(item.labelKey)).not.toBe(item.labelKey);
    for (const tab of Object.values(AREA_TABS).flat(2)) expect(t(tab!.labelKey)).not.toBe(tab!.labelKey);
  });

  it("keeps the School Admin sidebar short, with setup screens folded away", () => {
    const admin = NAV_BY_ROLE.SCHOOL_ADMIN.map((item) => item.href);
    expect(admin.length).toBeLessThanOrEqual(16);
    for (const buried of ["/school-admin/academics", "/school-admin/parents", "/school-admin/admissions", "/school-admin/audit", "/school-admin/website"]) {
      expect(admin).not.toContain(buried);
    }
  });

  it("highlights the owning entry for folded screens, and only one of them", () => {
    const admin = NAV_BY_ROLE.SCHOOL_ADMIN;
    const activeOn = (path: string) => admin.filter((item) => isNavActive(item, path)).map((item) => item.labelKey);
    expect(activeOn("/school-admin/admissions")).toEqual(["nav.students"]);
    expect(activeOn("/school-admin/staff/abc")).toEqual(["nav.teachersStaff"]);
    expect(activeOn("/school-admin/finance")).toEqual(["nav.fees"]);
    expect(activeOn("/school-admin/finance/expenses")).toEqual(["nav.expenses"]);
    expect(activeOn("/school-admin/finance/payroll")).toEqual(["nav.expenses"]);
    expect(activeOn("/school-admin/dashboard")).toEqual(["nav.home"]);
  });

  it("picks the most specific tab", () => {
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/library/loans")?.active).toBe("/school-admin/library/loans");
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/library/xyz")?.active).toBe("/school-admin/library");
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/attendance/staff")?.active).toBe("/school-admin/attendance/staff");
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/finance")?.active).toBe("/school-admin/finance");
    expect(tabsFor("SCHOOL_ADMIN", "/school-admin/meetings")).toBeNull();
  });

  it("never shows a student fees, and shows staff only what they were granted", () => {
    expect(NAV_BY_ROLE.STUDENT.some((item) => item.href.includes("fee"))).toBe(false);
    expect(staffNav([]).map((item) => item.href)).toEqual(NAV_BY_ROLE.NON_TEACHING_STAFF.map((item) => item.href));
    expect(staffNav(["VIEW_LIBRARY"]).map((item) => item.href)).toContain("/staff/library");
    expect(staffNav(["VIEW_LIBRARY"]).map((item) => item.href)).not.toContain("/staff/students");
  });

  it("puts only real sidebar destinations in the phone's bottom bar", () => {
    for (const [role, hrefs] of Object.entries(MOBILE_PRIMARY)) {
      const nav = NAV_BY_ROLE[role as keyof typeof NAV_BY_ROLE].map((item) => item.href);
      for (const href of hrefs!) expect(nav, `${role} ${href}`).toContain(href);
    }
  });
});
