import "server-only";

import { isAllowedScheduleDate, today } from "@/lib/dates";
import { type Lifecycle, countdownLabel, lifecycle, schoolNow } from "@/lib/time-status";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { EventInput } from "@/lib/validation/communication";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";

/**
 * School events: sports day, annual function, a trip — something happening.
 * Unpublished events are drafts only the School Admin sees. An event's status
 * (Upcoming → Today → Completed) is worked out from its date and times on
 * every read; nobody marks an event completed.
 */

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

  // An event is a future schedule: a new one, or a moved one, cannot be put in
  // the past. An event that has already happened keeps its date when edited.
  const previous = eventId
    ? (await ctx.db.event.findFirst({ where: { id: eventId }, select: { date: true } }))?.date
    : null;
  if (!isAllowedScheduleDate(data.date, previous)) {
    throw new ValidationError("Please correct the highlighted fields.", {
      date: ["Choose today or a later date for an event"],
    });
  }

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

// -----------------------------------------------------------------------------
// Events for everyone: the Events pages and dashboard cards
// -----------------------------------------------------------------------------

export type EventRow = Awaited<ReturnType<typeof listEvents>>["upcoming"][number];

/**
 * Events for the signed-in person, split into upcoming (including today) and
 * completed. Everyone sees published events; the School Admin also sees drafts.
 */
export async function listEvents(ctx: TenantContext, options: { completedTake?: number } = {}) {
  const admin = ctx.user.role === "SCHOOL_ADMIN";
  const clock = schoolNow();
  const rows = await ctx.db.event.findMany({
    where: admin ? {} : { isPublished: true },
    orderBy: [{ date: "asc" }, { startMinute: "asc" }],
    take: 500,
    select: EVENT_CARD,
  });
  const withStatus = rows.map((row) => {
    const status: Lifecycle = lifecycle(row, clock);
    return { ...row, status, countdown: countdownLabel(row.date, status, clock) };
  });
  return {
    upcoming: withStatus.filter((row) => row.status !== "COMPLETED"),
    completed: withStatus.filter((row) => row.status === "COMPLETED").reverse().slice(0, options.completedTake ?? 100),
    completedCount: withStatus.filter((row) => row.status === "COMPLETED").length,
  };
}

/** One event for its detail page. Drafts are the School Admin's only. */
export async function viewEvent(ctx: TenantContext, eventId: string) {
  const event = await ctx.db.event.findFirst({
    where: { id: eventId, ...(ctx.user.role === "SCHOOL_ADMIN" ? {} : { isPublished: true }) },
    select: EVENT_CARD,
  });
  if (!event) throw new NotFoundError();
  const status = lifecycle(event);
  return { ...event, status, countdown: countdownLabel(event.date, status) };
}

/** Publish or unpublish an event without opening the form. */
export async function setEventPublished(ctx: TenantContext, eventId: string, isPublished: boolean): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const event = await ctx.db.event.findFirst({ where: { id: eventId }, select: { title: true } });
  if (!event) throw new NotFoundError();
  await ctx.db.event.updateMany({ where: { id: eventId }, data: { isPublished } });
  await recordAudit({
    action: "EVENT_UPDATED",
    entityType: "Event",
    entityId: eventId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Event "${event.title}" ${isPublished ? "published" : "unpublished"}.`,
  });
}

/** The dashboard's Events card: how many are coming, the next one, how many are done. */
export async function eventSummary(ctx: TenantContext) {
  const { upcoming, completedCount } = await listEvents(ctx, { completedTake: 0 });
  const visible = ctx.user.role === "SCHOOL_ADMIN" ? upcoming.filter((row) => row.isPublished) : upcoming;
  return { upcoming: visible.length, completed: completedCount, next: visible[0] ?? null };
}
