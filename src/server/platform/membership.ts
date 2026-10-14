import "server-only";

import { dateOnly, formatDate, today } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { sendMail } from "@/server/mail/mailer";
import { membershipReminderEmail } from "@/server/mail/templates";
import { type MembershipRow, membershipOverview } from "@/server/platform/calendar";

/**
 * Memberships and reminders, for the Super Admin.
 *
 * A reminder is an email to the organization's owner (or, without one, the
 * campus's School Admins, or its registration contact) saying the plan or
 * trial is ending, has ended, or has a payment due — plus a notice on the
 * School Admin's alerts, read from the reminder's audit entry (no new table).
 * It changes no subscription and never says anything is paid.
 *
 * One delivered reminder per organization per day: a second one within 24
 * hours (say, a double click, or the same organization ticked twice in a bulk
 * send) is skipped and reported. An email that was not delivered does not
 * count, so it can be tried again at once.
 */

export const REMINDER_ACTION = "MEMBERSHIP_REMINDER_SENT";
const RESEND_AFTER_MS = 24 * 60 * 60 * 1000;
/** How long the School Admin's alert stays after a reminder. */
export const REMINDER_ALERT_DAYS = 14;
const MAX_BULK = 200;

export type MembershipFilter = "all" | "ended" | "soon" | "overdue" | "open";

export type MembershipListRow = MembershipRow & {
  /** The latest reminder attempt, and whether its email was delivered. */
  lastRemindedAt: Date | null;
  lastReminderDelivered: boolean | null;
};

/** Every membership with when it was last reminded, filtered for the Membership page. */
export async function listMemberships(actor: SessionUser, filter: MembershipFilter = "all") {
  assertRole(actor, "SUPER_ADMIN");
  const overview = await membershipOverview(actor, Number.MAX_SAFE_INTEGER);
  const ids = overview.rows.flatMap((row) => row.schoolIds);
  const reminders = ids.length
    ? await prisma.auditLog.findMany({ where: { action: REMINDER_ACTION, schoolId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { schoolId: true, createdAt: true, metadata: true } })
    : [];
  const last = new Map<string, { at: Date; delivered: boolean }>();
  for (const row of reminders) {
    if (row.schoolId && !last.has(row.schoolId)) last.set(row.schoolId, { at: row.createdAt, delivered: (row.metadata as { delivered?: boolean } | null)?.delivered === true });
  }
  const rows: MembershipListRow[] = overview.rows.map((row) => {
    const latest = row.schoolIds.map((id) => last.get(id)).filter((entry): entry is { at: Date; delivered: boolean } => Boolean(entry)).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    return { ...row, lastRemindedAt: latest?.at ?? null, lastReminderDelivered: latest ? latest.delivered : null };
  });
  const matches = (row: MembershipListRow) =>
    filter === "ended" ? row.daysLeft !== null && row.daysLeft < 0
    : filter === "soon" ? row.daysLeft !== null && row.daysLeft >= 0 && row.daysLeft <= 30
    : filter === "overdue" ? row.status === "PAST_DUE"
    : filter === "open" ? row.daysLeft === null
    : true;
  return {
    rows: rows.filter(matches),
    counts: {
      all: rows.length,
      ended: overview.ended,
      soon: overview.within30,
      overdue: rows.filter((row) => row.status === "PAST_DUE").length,
      open: overview.noEndDate,
    },
  };
}

type Outcome = { schoolId: string; organization: string; result: "SENT" | "FAILED" | "SKIPPED"; to?: string; reason?: string };

/**
 * Send a reminder for each of the given campuses' memberships — one or many.
 * Campuses of the same organization get one email. Demo sandboxes, schools
 * without a running plan and anything unknown are reported as skipped.
 */
export async function sendMembershipReminders(actor: SessionUser, schoolIds: readonly string[]): Promise<{ sent: number; failed: number; skipped: number; outcomes: Outcome[] }> {
  assertRole(actor, "SUPER_ADMIN");
  const ids = [...new Set(schoolIds)];
  if (!ids.length) throw new AppError("VALIDATION", "Choose at least one school.");
  if (ids.length > MAX_BULK) throw new AppError("VALIDATION", `Send to at most ${MAX_BULK} schools at a time.`);

  const schools = await prisma.school.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      isDemo: true,
      contactName: true,
      contactEmail: true,
      organizationId: true,
      organization: { select: { id: true, name: true, owner: { select: { email: true, firstName: true, isActive: true } }, schools: { select: { id: true } } } },
      users: { where: { role: "SCHOOL_ADMIN", isActive: true }, orderBy: { createdAt: "asc" }, select: { email: true, firstName: true } },
      subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true, endsAt: true, plan: { select: { name: true } } } },
    },
  });

  const outcomes: Outcome[] = ids.filter((id) => !schools.some((school) => school.id === id)).map((id) => ({ schoolId: id, organization: "—", result: "SKIPPED" as const, reason: "Not found" }));
  const done = new Set<string>();
  const since = new Date(Date.now() - RESEND_AFTER_MS);

  for (const school of schools) {
    const organization = school.organization?.name ?? school.name;
    const groupKey = school.organizationId ?? school.id;
    const skip = (reason: string) => outcomes.push({ schoolId: school.id, organization, result: "SKIPPED", reason });
    if (school.isDemo) { skip("Demo sandbox"); continue; }
    const subscription = school.subscriptions[0];
    if (!subscription) { skip("No running plan"); continue; }
    if (done.has(groupKey)) { skip("Same organization — one reminder sent"); continue; }
    done.add(groupKey);

    const campusIds = school.organization?.schools.map((row) => row.id) ?? [school.id];
    const recent = await prisma.auditLog.findFirst({ where: { action: REMINDER_ACTION, schoolId: { in: campusIds }, createdAt: { gte: since }, metadata: { path: ["delivered"], equals: true } }, select: { createdAt: true } });
    if (recent) { skip("Already reminded in the last 24 hours"); continue; }

    const owner = school.organization?.owner?.isActive ? school.organization.owner : null;
    const recipient = owner ?? school.users[0] ?? { email: school.contactEmail, firstName: school.contactName };
    // The same school dates as the Membership page and calendar.
    const endsOn = subscription.endsAt ? dateOnly(subscription.endsAt.getUTCFullYear(), subscription.endsAt.getUTCMonth() + 1, subscription.endsAt.getUTCDate()) : null;
    const daysLeft = endsOn ? Math.round((endsOn.getTime() - today().getTime()) / 86_400_000) : null;
    const mail = membershipReminderEmail({ to: recipient.email, name: recipient.firstName, organization, plan: subscription.plan.name, status: subscription.status as "ACTIVE" | "TRIALING" | "PAST_DUE", endsOn: endsOn ? formatDate(endsOn) : null, daysLeft });
    const delivery = await sendMail(mail);

    // One entry per campus, so each campus's School Admin sees the notice.
    for (const campusId of campusIds) {
      await recordAudit({
        action: REMINDER_ACTION,
        entityType: "School",
        entityId: campusId,
        schoolId: campusId,
        actorId: actor.id,
        summary: delivery.delivered
          ? `Membership reminder sent to ${recipient.email} for ${organization} (${subscription.plan.name}, ends ${endsOn ? formatDate(endsOn) : "—"}).`
          : `Membership reminder not delivered to ${recipient.email} for ${organization} (${subscription.plan.name}, ends ${endsOn ? formatDate(endsOn) : "—"}). ${delivery.error ?? ""}`.trim(),
        metadata: { to: recipient.email, delivered: delivery.delivered, plan: subscription.plan.name, status: subscription.status, endsOn: endsOn?.toISOString().slice(0, 10) ?? null, daysLeft },
      });
    }
    outcomes.push({ schoolId: school.id, organization, result: delivery.delivered ? "SENT" : "FAILED", to: recipient.email, reason: delivery.error });
  }

  return {
    sent: outcomes.filter((row) => row.result === "SENT").length,
    failed: outcomes.filter((row) => row.result === "FAILED").length,
    skipped: outcomes.filter((row) => row.result === "SKIPPED").length,
    outcomes,
  };
}

/** The latest reminder for a campus within the alert window — for the School Admin's alerts. */
export async function latestMembershipReminder(schoolId: string) {
  const row = await prisma.auditLog.findFirst({
    where: { action: REMINDER_ACTION, schoolId, createdAt: { gte: new Date(Date.now() - REMINDER_ALERT_DAYS * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, metadata: true },
  });
  if (!row) return null;
  const meta = (row.metadata ?? {}) as { plan?: string; status?: string; endsOn?: string | null; daysLeft?: number | null };
  return { id: row.id, at: row.createdAt, plan: meta.plan ?? "", status: meta.status ?? "ACTIVE", endsOn: meta.endsOn ? new Date(`${meta.endsOn}T00:00:00Z`) : null };
}
