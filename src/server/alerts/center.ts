import "server-only";

import { createHash } from "node:crypto";

import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { type FeedAlert, getAdminAlerts, getStaffAlerts, getStudentAlerts, getTeacherAlerts } from "@/server/alerts/feeds";
import { finalizeDueRegisters } from "@/server/attendance/register";
import { getParentAlerts } from "@/server/parent/alerts";

/**
 * The notification center: every role's derived alerts, with read / unread.
 *
 * Alerts are still worked out from the school's own rows on each read — there
 * is no notification table to fall out of step with the data. The only thing
 * stored is what this person has read, on their own `User` row: a "read up to"
 * moment (Mark all as read) and the keys of alerts read one by one since.
 */

export type CenterAlert = Omit<FeedAlert, "at"> & { at: Date; key: string; read: boolean; childName?: string | null };

const ROLES = ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT", "NON_TEACHING_STAFF"] as const;

async function rawAlerts(ctx: TenantContext): Promise<Array<FeedAlert & { childName?: string | null }>> {
  switch (ctx.user.role) {
    case "SCHOOL_ADMIN":
      return getAdminAlerts(ctx);
    case "TEACHER":
      return getTeacherAlerts(ctx);
    case "STUDENT":
      return getStudentAlerts(ctx);
    case "NON_TEACHING_STAFF":
      return getStaffAlerts(ctx);
    default:
      return getParentAlerts(ctx);
  }
}

/** A stable id for an alert, from what it is about — never from anything the browser sends. */
export function alertKey(alert: Pick<FeedAlert, "kind" | "childId" | "title" | "at" | "key">): string {
  if (alert.key) return alert.key;
  return createHash("sha1").update(`${alert.kind}|${alert.childId ?? ""}|${alert.title}|${alert.at.toISOString()}`).digest("hex").slice(0, 20);
}

export async function notificationCenter(ctx: TenantContext): Promise<{ alerts: CenterAlert[]; unread: number }> {
  assertRole(ctx.user, ...ROLES);
  // Every page load asks for the bell, which makes this the steadiest place
  // to submit drafts whose attendance period has ended (see `register.ts`).
  await finalizeDueRegisters(ctx);
  const [alerts, user] = await Promise.all([
    rawAlerts(ctx),
    prisma.user.findUnique({ where: { id: ctx.user.id }, select: { alertsReadAt: true, readAlertKeys: true } }),
  ]);
  const readKeys = new Set(user?.readAlertKeys ?? []);
  const readUpTo = user?.alertsReadAt ?? null;
  const rows = alerts.map((alert) => {
    const key = alertKey(alert);
    // Count alerts ("3 leave requests") are always "now", so only their key
    // — which carries the count — can mark them read.
    const read = readKeys.has(key) || (!alert.key && readUpTo !== null && alert.at <= readUpTo);
    return { ...alert, key, read };
  });
  return { alerts: rows, unread: rows.filter((row) => !row.read).length };
}

/**
 * Mark some alerts read, or all of them. Keys are kept only for alerts still
 * showing, so the stored list never grows past one screen of alerts.
 */
export async function markAlertsRead(ctx: TenantContext, input: { keys?: string[]; all?: boolean }): Promise<void> {
  assertRole(ctx.user, ...ROLES);
  const { alerts } = await notificationCenter(ctx);
  const showing = new Set(alerts.map((alert) => alert.key));
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { readAlertKeys: true } });

  if (input.all) {
    await prisma.user.update({
      where: { id: ctx.user.id },
      data: { alertsReadAt: new Date(), readAlertKeys: [...showing] },
    });
    return;
  }
  const next = new Set(user.readAlertKeys.filter((key) => showing.has(key)));
  for (const key of input.keys ?? []) if (showing.has(key)) next.add(key);
  await prisma.user.update({ where: { id: ctx.user.id }, data: { readAlertKeys: [...next] } });
}
