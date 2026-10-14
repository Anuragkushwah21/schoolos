/**
 * The plan rules every screen shares: the Starter → Growth → Pro ladder,
 * essential modules, dependencies, prices and the extra-campus quote.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_PLANS, PLAN_TEMPLATE_KEYS, type PlanConfig, campusPolicy, planConfig, planProblems, planSlug, planWarnings, quote, templateDiff, templateSelection } from "@/lib/plan-catalog";

const base: PlanConfig = {
  name: "Growth",
  description: null,
  highlights: [],
  displayOrder: 2,
  priceMinor: 30_000_00,
  priceOnRequest: false,
  billingPeriod: "YEARLY",
  campusLimit: 2,
  extraCampusAllowed: false,
  extraCampusPriceMinor: null,
  extraCampusPeriod: "YEARLY",
  maxCampuses: null,
  optionalModules: ["FINANCE", "EXPENSES", "PAYROLL"],
  features: ["ORG_DASHBOARD"],
  maxStudents: null,
  maxTeachers: null,
  maxAdmins: null,
  storageMb: null,
  availableRoles: [],
  roleLimits: {},
};
const starter = { id: "s", name: "Starter", displayOrder: 1, optionalModules: ["FINANCE", "EXPENSES"], features: [] };
const pro = { id: "p", name: "Pro", displayOrder: 3, optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY"], features: ["ORG_DASHBOARD", "FEATURE_REQUESTS"] };

describe("planProblems", () => {
  it("accepts a plan that sits correctly between its neighbours", () => {
    expect(planProblems(base, [starter, pro], "g")).toEqual([]);
  });

  it("refuses dropping an essential module, on any plan", () => {
    expect(planProblems({ ...base, optionalModules: ["FINANCE", "PAYROLL"] }, [], "g").join(" ")).toMatch(/must include Expenses/);
  });

  it("refuses a plan that loses what the plan below includes", () => {
    const lower = { ...starter, optionalModules: ["FINANCE", "EXPENSES", "LIBRARY"] };
    expect(planProblems(base, [lower, pro], "g").join(" ")).toMatch(/Growth must include everything in Starter: missing Library/);
  });

  it("refuses a plan that would give more than the plan above", () => {
    const problems = planProblems({ ...base, optionalModules: [...base.optionalModules, "TRANSPORT"] }, [starter, pro], "g");
    expect(problems.join(" ")).toMatch(/Pro \(the next plan up\) would no longer include everything in Growth: Transport/);
  });

  it("checks features on the ladder too", () => {
    expect(planProblems({ ...base, features: [] }, [{ ...starter, features: ["ORG_DASHBOARD"] }, pro], "g").join(" ")).toMatch(/missing Organization dashboard/);
  });

  it("refuses a module without its dependency", () => {
    const problems = planProblems(base, [], "g", { PAYROLL: ["LIBRARY"] });
    expect(problems.join(" ")).toMatch(/Payroll needs Library/);
    expect(planProblems({ ...base, optionalModules: [...base.optionalModules, "LIBRARY"] }, [], "g", { PAYROLL: ["LIBRARY"] })).toEqual([]);
  });

  it("asks for a price or price-on-request, an extra-campus price, and a sane cap", () => {
    expect(planProblems({ ...base, priceMinor: 0 }, [], "g").join(" ")).toMatch(/Price on request/);
    expect(planProblems({ ...base, priceMinor: 0, priceOnRequest: true }, [], "g")).toEqual([]);
    expect(planProblems({ ...base, extraCampusAllowed: true }, [], "g").join(" ")).toMatch(/price of an extra campus/);
    expect(planProblems({ ...base, extraCampusAllowed: true, extraCampusPriceMinor: 0, maxCampuses: 1 }, [], "g").join(" ")).toMatch(/cap cannot be lower/);
    // A cap kept while extra campuses are off is not used, so it is not a problem.
    expect(planProblems({ ...base, extraCampusAllowed: false, maxCampuses: 1 }, [], "g")).toEqual([]);
  });

  it("refuses two plans at the same place in the order, where the ladder could not be checked", () => {
    const twin = { ...starter, id: "twin", name: "Lite", displayOrder: base.displayOrder, optionalModules: ["FINANCE", "EXPENSES", "TRANSPORT"] };
    expect(planProblems(base, [starter, twin, pro], "g").join(" ")).toMatch(/Display order 2 is already used by Lite/);
    // Its own row is not a clash.
    expect(planProblems(base, [starter, { ...twin, id: "g" }, pro], "g")).toEqual([]);
  });
});

describe("quote and campus policy", () => {
  const proConfig = { ...base, campusLimit: 3, extraCampusAllowed: true, extraCampusPriceMinor: 5_000_00, maxCampuses: 6 };

  it("charges the plan fee once and each campus past the included ones", () => {
    expect(quote(proConfig, 3)).toMatchObject({ planFeeMinor: 30_000_00, extraCampuses: 0, extraTotalMinor: 0 });
    expect(quote(proConfig, 5)).toMatchObject({ planFeeMinor: 30_000_00, extraCampuses: 2, extraEachMinor: 5_000_00, extraTotalMinor: 10_000_00 });
  });

  it("never shows a number for price on request", () => {
    expect(quote({ ...proConfig, priceOnRequest: true }, 1)).toMatchObject({ onRequest: true, planFeeMinor: null });
  });

  it("caps at the included campuses unless extras are allowed; an override is a hard cap", () => {
    expect(campusPolicy(base).cap).toBe(2);
    expect(campusPolicy(proConfig).cap).toBe(6);
    expect(campusPolicy({ ...proConfig, maxCampuses: null }).cap).toBeNull();
    expect(campusPolicy(base, 4)).toMatchObject({ cap: 4, overridden: true });
  });
});

describe("drafts", () => {
  it("a draft overlays the live configuration and drops unknown keys", () => {
    const next = planConfig(base, { name: "Growth+", optionalModules: ["FINANCE", "EXPENSES", "HOSTEL"], features: ["ORG_DASHBOARD", "MAGIC"], priceOnRequest: true });
    expect(next).toMatchObject({ name: "Growth+", optionalModules: ["FINANCE", "EXPENSES"], features: ["ORG_DASHBOARD"], priceOnRequest: true, campusLimit: 2 });
  });

  it("makes stable slugs", () => {
    expect(planSlug("Pro Plus (2027)")).toBe("pro-plus-2027");
  });
});

describe("plan templates", () => {
  it("Starter, Growth and Pro each start from a fixed selection that climbs the ladder", () => {
    const configs = PLAN_TEMPLATE_KEYS.map((key, index) => ({ ...base, ...templateSelection(key), name: key, displayOrder: index + 1 }));
    expect(configs[0]).toMatchObject({ optionalModules: ["FINANCE", "EXPENSES"], features: [], campusLimit: 1 });
    expect(configs[1]).toMatchObject({ optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY"], features: ["ORG_DASHBOARD"], campusLimit: 2 });
    expect(configs[2].optionalModules).toHaveLength(6);
    expect(configs[2].features).toEqual(["ORG_DASHBOARD", "FEATURE_REQUESTS"]);
    // Every template is publishable as a ladder: each includes everything below it.
    const ladder = configs.map((config, index) => ({ ...config, id: String(index) }));
    for (const [index, config] of configs.entries()) expect(planProblems(config, ladder, String(index))).toEqual([]);
  });

  it("returns a fresh copy, so editing a selection never changes the template", () => {
    const first = templateSelection("growth");
    first.optionalModules.push("TRANSPORT");
    expect(templateSelection("growth").optionalModules).not.toContain("TRANSPORT");
  });

  it("the seeded default plans are the templates", () => {
    expect(DEFAULT_PLANS.map((plan) => [plan.slug, plan.templateKey])).toEqual([
      ["starter", "starter"],
      ["growth", "growth"],
      ["pro", "pro"],
    ]);
    for (const plan of DEFAULT_PLANS) expect(plan.optionalModules).toEqual(templateSelection(plan.templateKey).optionalModules);
  });

  it("templateDiff says whether a plan still matches its template and what differs", () => {
    expect(templateDiff(templateSelection("growth"), "growth")).toMatchObject({ template: "Growth", customized: false });
    const changed = templateDiff({ ...templateSelection("growth"), optionalModules: ["FINANCE", "EXPENSES", "PAYROLL", "LIBRARY", "TRANSPORT"], campusLimit: 4 }, "growth");
    expect(changed).toMatchObject({ customized: true, modules: { added: ["TRANSPORT"], removed: [] }, campuses: { from: 2, to: 4 } });
    expect(templateDiff(templateSelection("pro"), null)).toBeNull();
    expect(templateDiff(templateSelection("pro"), "enterprise")).toBeNull();
  });

  it("warns (without blocking) about a role whose module is not in the plan", () => {
    expect(planWarnings({ optionalModules: ["FINANCE", "EXPENSES"], availableRoles: ["LIBRARIAN", "ACCOUNTANT"] })).toEqual([expect.stringMatching(/Librarian role is offered without Library/)]);
    expect(planWarnings({ optionalModules: ["FINANCE", "EXPENSES", "LIBRARY"], availableRoles: ["LIBRARIAN"] })).toEqual([]);
    for (const key of PLAN_TEMPLATE_KEYS) expect(planWarnings(templateSelection(key))).toEqual([]);
    const problems = planProblems({ ...base, availableRoles: ["LIBRARIAN"] }, [], null);
    expect(problems.join(" ")).not.toMatch(/Librarian/);
  });
});
