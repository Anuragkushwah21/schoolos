import "server-only";

import { today } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import type { EventInput } from "@/lib/validation/communication";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";

/** School events: sports day, PTMs, holidays. Unpublished events are drafts. */

const EVENT_CARD = {
  id: true,
  title: true,
  description: true,
  date: true,
  startMinute: true,
  endMinute: true,
  location: true,
  imageUrl: true,
  isPublished: true,
} as const;

export async function upcomingEvents(ctx: TenantContext, take = 5) {
  return ctx.db.event.findMany({
    where: { isPublished: true, date: { gte: today() } },
    orderBy: [{ date: "asc" }, { startMinute: "asc" }],
    take,
    select: EVENT_CARD,
  });
}

export async function publicEvents(schoolId: string, take = 20) {
  return prisma.event.findMany({
    where: { schoolId, isPublished: true, date: { gte: today() } },
    orderBy: [{ date: "asc" }, { startMinute: "asc" }],
    take,
    select: EVENT_CARD,
  });
}

export async function listEventsForAdmin(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.event.findMany({ orderBy: { date: "desc" }, select: EVENT_CARD });
}

export async function getEvent(ctx: TenantContext, eventId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const event = await ctx.db.event.findFirst({ where: { id: eventId }, select: EVENT_CARD });
  if (!event) throw new NotFoundError();
  return event;
}

export async function saveEvent(ctx: TenantContext, input: EventInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { eventId, ...data } = input;

  let id: string;
  if (eventId) {
    const { count } = await ctx.db.event.updateMany({ where: { id: eventId }, data });
    if (!count) throw new NotFoundError();
    id = eventId;
  } else {
    id = (await ctx.db.event.create({ data: { ...data, schoolId: ctx.schoolId }, select: { id: true } })).id;
  }

  await recordAudit({
    action: "EVENT_UPDATED",
    entityType: "Event",
    entityId: id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Event "${data.title}" saved${data.isPublished ? " and published" : ""}.`,
  });
  return id;
}

export async function deleteEvent(ctx: TenantContext, eventId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { count } = await ctx.db.event.deleteMany({ where: { id: eventId } });
  if (!count) throw new NotFoundError();
}
