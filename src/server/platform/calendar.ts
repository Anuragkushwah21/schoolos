import "server-only";

import type { Route } from "next";

import { addDays, dateOnly, today } from "@/lib/dates";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

/**
 * The Super Admin's calendar: the platform's own dates, read from the records
 * that already carry them — nothing is copied into a calendar table, so
 * changing a subscription's end date is what moves it here.
 *
 *   * A plan or trial ending — one entry per organization (every campus has
 *     a subscription row, kept in step), demo sandboxes left out.
 *   * Overdue — a plan or trial whose end date has passed while it is still
 *     marked active, and subscriptions marked "payment overdue".
 *   * Waiting for you — requests with no date of their own (school approvals,
 *     campus, plan and feature requests, new enquiries), with how long the
 *     oldest has waited, so nothing is forgotten.
 *
 * School calendars (holidays, meetings, exams) stay inside each school.
 */

export type PlatformEntryKind = "TRIAL_ENDS" | "PLAN_ENDS";

export type PlatformEntry = {
  key: string;
  kind: PlatformEntryKind;
  /** The organization (or campus, for one without an organization). */
  title: string;
  date: Date;
  /** "Growth · 2 campuses". */
  detail: string;
  href: Route;
};

const RUNNING = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

/** A stored timestamp as the school date it stands for. */
const asDate = (value: Date) => dateOnly(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());

type SubscriptionRow = {
  status: (typeof RUNNING)[number];
  endsAt: Date | null;
  plan: { name: string };
  school: { id: string; name: string; organization: { id: string; name: string } | null };
};

/** One row per organization (or campus without one) and end date. */
function byOrganization(rows: SubscriptionRow[]) {
  const groups = new Map<string, { row: SubscriptionRow; campuses: number; schoolIds: string[] }>();
  for (const row of rows) {
    const owner = row.school.organization?.id ?? row.school.id;
    const key = `${owner}:${row.endsAt ? asDate(row.endsAt).getTime() : "open"}:${row.status}`;
    const group = groups.get(key);
    if (group) {
      group.campuses += 1;
      group.schoolIds.push(row.school.id);
    } else groups.set(key, { row, campuses: 1, schoolIds: [row.school.id] });
  }
  return [...groups.entries()].map(([key, { row, campuses, schoolIds }]) => ({
    key,
    row,
    schoolIds,
    title: row.school.organization?.name ?? row.school.name,
    href: (row.school.organization ? `/super-admin/organizations/${row.school.organization.id}` : `/super-admin/schools/${row.school.id}`) as Route,
    detail: `${row.plan.name} · ${campuses} campus${campuses === 1 ? "" : "es"}`,
  }));
}

const SUBSCRIPTION_SELECT = {
  status: true,
  endsAt: true,
  plan: { select: { name: true } },
  school: { select: { id: true, name: true, organization: { select: { id: true, name: true } } } },
} as const;

/** Plans and trials ending between `from` and `to` (school dates, inclusive). */
export async function platformCalendarEntries(actor: SessionUser, from: Date, to: Date): Promise<PlatformEntry[]> {
  assertRole(actor, "SUPER_ADMIN");
  const rows = await prisma.subscription.findMany({
    where: { status: { in: [...RUNNING] }, endsAt: { gte: from, lt: addDays(to, 1) }, school: { isDemo: false } },
    orderBy: { endsAt: "asc" },
    take: 500,
    select: SUBSCRIPTION_SELECT,
  });
  return byOrganization((rows as SubscriptionRow[]).filter((row) => row.endsAt))
    .map(({ key, row, title, href, detail }) => ({
      key,
      kind: row.status === "TRIALING" ? ("TRIAL_ENDS" as const) : ("PLAN_ENDS" as const),
      title,
      date: asDate(row.endsAt!),
      detail,
      href,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.title.localeCompare(b.title));
}

/** What the Super Admin should not forget: overdue subscriptions and requests waiting for a decision. */
export async function platformReminders(actor: SessionUser) {
  assertRole(actor, "SUPER_ADMIN");
  const now = today();
  const oldest = { orderBy: { createdAt: "asc" as const }, select: { createdAt: true } };
  const [ended, pastDue, schools, oldestSchool, campus, oldestCampus, plans, oldestPlan, features, oldestFeature, enquiries, oldestEnquiry] = await Promise.all([
    prisma.subscription.findMany({ where: { status: { in: ["ACTIVE", "TRIALING"] }, endsAt: { lt: now }, school: { isDemo: false } }, orderBy: { endsAt: "asc" }, take: 200, select: SUBSCRIPTION_SELECT }),
    prisma.subscription.findMany({ where: { status: "PAST_DUE", school: { isDemo: false } }, orderBy: { endsAt: "asc" }, take: 200, select: SUBSCRIPTION_SELECT }),
    prisma.school.count({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] }, isDemo: false } }),
    prisma.school.findFirst({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] }, isDemo: false }, ...oldest }),
    prisma.campusRequest.count({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] } } }),
    prisma.campusRequest.findFirst({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] } }, ...oldest }),
    prisma.planChangeRequest.count({ where: { status: "PENDING" } }),
    prisma.planChangeRequest.findFirst({ where: { status: "PENDING" }, ...oldest }),
    prisma.featureRequest.count({ where: { status: { in: ["SUBMITTED", "UNDER_EVALUATION"] } } }),
    prisma.featureRequest.findFirst({ where: { status: { in: ["SUBMITTED", "UNDER_EVALUATION"] } }, ...oldest }),
    prisma.platformInquiry.count({ where: { status: "NEW" } }),
    prisma.platformInquiry.findFirst({ where: { status: "NEW" }, ...oldest }),
  ]);

  const overdue = [
    ...byOrganization(ended as SubscriptionRow[]).map(({ key, row, title, href, detail }) => ({ key, title, href, detail, date: asDate(row.endsAt!), text: row.status === "TRIALING" ? "Trial ended — not converted or extended" : "Plan ended — not renewed" })),
    ...byOrganization(pastDue as SubscriptionRow[]).map(({ key, row, title, href, detail }) => ({ key: `due:${key}`, title, href, detail, date: row.endsAt ? asDate(row.endsAt) : null, text: "Payment overdue" })),
  ];

  const waiting = [
    { key: "approvals", count: schools, oldest: oldestSchool?.createdAt ?? null, label: "schools waiting for approval", href: "/super-admin/approvals" as Route },
    { key: "campus", count: campus, oldest: oldestCampus?.createdAt ?? null, label: "campus requests to decide", href: "/super-admin/campus-requests" as Route },
    { key: "plan", count: plans, oldest: oldestPlan?.createdAt ?? null, label: "plan change requests to decide", href: "/super-admin/plan-requests" as Route },
    { key: "features", count: features, oldest: oldestFeature?.createdAt ?? null, label: "feature requests to review", href: "/super-admin/feature-requests" as Route },
    { key: "enquiries", count: enquiries, oldest: oldestEnquiry?.createdAt ?? null, label: "new enquiries to answer", href: "/super-admin/inquiries" as Route },
  ].filter((row) => row.count > 0);

  return { overdue, waiting };
}

export type MembershipRow = {
  key: string;
  title: string;
  href: Route;
  /** "Growth · 2 campuses". */
  detail: string;
  status: (typeof RUNNING)[number];
  /** The campuses in this row (a reminder goes to their organization once). */
  schoolIds: string[];
  /** The school date the plan or trial ends; null = no end date set. */
  endsOn: Date | null;
  /** Days from today to the end date (negative = already ended); null without one. */
  daysLeft: number | null;
};

/**
 * Memberships (subscriptions) for the dashboard: one row per organization and
 * end date, the soonest end first — ended ones at the top — then those with
 * no end date. Read from subscriptions only; demo sandboxes left out. Nothing
 * here says a membership is paid: SchoolOS records billing by hand.
 */
export async function membershipOverview(actor: SessionUser, limit: number = 10) {
  assertRole(actor, "SUPER_ADMIN");
  const now = today();
  const rows = await prisma.subscription.findMany({
    where: { status: { in: [...RUNNING] }, school: { isDemo: false, status: { in: ["ACTIVE", "SUSPENDED", "PENDING", "UNDER_REVIEW"] } } },
    orderBy: { endsAt: "asc" },
    take: 1000,
    select: SUBSCRIPTION_SELECT,
  });
  const memberships: MembershipRow[] = byOrganization(rows as SubscriptionRow[])
    .map(({ key, row, title, href, detail, schoolIds }) => {
      const endsOn = row.endsAt ? asDate(row.endsAt) : null;
      return { key, title, href, detail, status: row.status, schoolIds, endsOn, daysLeft: endsOn ? Math.round((endsOn.getTime() - now.getTime()) / 86_400_000) : null };
    })
    .sort((a, b) => (a.endsOn && b.endsOn ? a.endsOn.getTime() - b.endsOn.getTime() : a.endsOn ? -1 : b.endsOn ? 1 : 0) || a.title.localeCompare(b.title));
  const dated = memberships.filter((row) => row.daysLeft !== null);
  return {
    rows: memberships.slice(0, limit),
    total: memberships.length,
    ended: dated.filter((row) => row.daysLeft! < 0).length,
    within30: dated.filter((row) => row.daysLeft! >= 0 && row.daysLeft! <= 30).length,
    noEndDate: memberships.length - dated.length,
  };
}
