/**
 * Events, Notices, Meetings, Leave and the Calendar kept apart: notice read
 * state per person, events' publish switch and lifecycle, the calendar's
 * approved-leave marker, and the dashboard summaries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { studentLeaveSummary } from "@/server/attendance/student-leave";
import { getCalendarEntries } from "@/server/calendar/entries";
import { eventSummary, listEvents, setEventPublished, viewEvent } from "@/server/communication/events";
import { markNoticesRead, myNotices, unreadNoticeSummary } from "@/server/communication/notices";
import { prisma } from "@/server/db/prisma";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");

const notice = (school: SeededSchool, title: string, audience: "ALL" | "PARENTS" | "TEACHERS", extra: Record<string, unknown> = {}) =>
  prisma.notice.create({ data: { schoolId: school.schoolId, title, body: `${title} — details.`, audience, status: "PUBLISHED", publishAt: new Date(Date.now() - 60_000), ...extra } });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("notices: read and unread, per person", () => {
  it("starts unread, is read only for the person who marks it, and never for another audience", async () => {
    const forParents = await notice(schoolA, "School closed on 2 October", "PARENTS");
    const forTeachers = await notice(schoolA, "Staff meeting moved", "TEACHERS");

    const before = await myNotices(parentOf(schoolA));
    const mine = before.live.find((row) => row.id === forParents.id)!;
    expect(mine).toMatchObject({ isRead: false, audience: "PARENTS" });
    expect(before.live.some((row) => row.id === forTeachers.id)).toBe(false);
    expect((await unreadNoticeSummary(parentOf(schoolA))).unread).toBe(before.unread);

    // A teacher cannot mark the parents' notice (it is not theirs to see).
    expect(await markNoticesRead(teacherOf(schoolA), [forParents.id])).toBe(0);
    expect(await markNoticesRead(parentOf(schoolA), [forParents.id, forTeachers.id])).toBe(1);

    const after = await myNotices(parentOf(schoolA));
    expect(after.live.find((row) => row.id === forParents.id)!.isRead).toBe(true);
    expect(after.unread).toBe(before.unread - 1);
    // Reading twice changes nothing.
    expect(await markNoticesRead(parentOf(schoolA), [forParents.id])).toBe(0);
    // Another school's notice id is ignored.
    const other = await notice(schoolB, "Elsewhere", "ALL");
    expect(await markNoticesRead(parentOf(schoolA), [other.id])).toBe(0);
  });

  it("marks everything read at once, and keeps expired notices as history", async () => {
    const old = await notice(schoolA, "Last month's notice", "ALL", { expiresAt: addDays(today(), -3) });
    await notice(schoolA, "Fresh notice", "ALL");
    const ctx = studentOf(schoolA);
    const { live, history } = await myNotices(ctx);
    expect(history.map((row) => row.id)).toContain(old.id);
    expect(live.map((row) => row.id)).not.toContain(old.id);
    await markNoticesRead(ctx, "ALL");
    expect((await myNotices(ctx)).unread).toBe(0);
    expect((await unreadNoticeSummary(ctx)).unread).toBe(0);
  });
});

describe("events: publish switch and automatic status", () => {
  it("keeps a draft to the School Admin until it is published", async () => {
    const draft = await prisma.event.create({ data: { schoolId: schoolA.schoolId, title: "Annual Sports Day", date: addDays(today(), 14), isPublished: false } });

    await expect(viewEvent(parentOf(schoolA), draft.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listEvents(parentOf(schoolA))).upcoming.some((row) => row.id === draft.id)).toBe(false);
    expect((await viewEvent(adminOf(schoolA), draft.id)).countdown).toBe("14 days left");

    await expect(setEventPublished(teacherOf(schoolA), draft.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setEventPublished(adminOf(schoolB), draft.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await setEventPublished(adminOf(schoolA), draft.id, true);

    const seen = await viewEvent(parentOf(schoolA), draft.id);
    expect(seen).toMatchObject({ status: "UPCOMING", countdown: "14 days left" });
    const summary = await eventSummary(parentOf(schoolA));
    expect(summary.next?.id).toBe(draft.id);

    await setEventPublished(adminOf(schoolA), draft.id, false);
    await expect(viewEvent(studentOf(schoolA), draft.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("files past events under Completed, and today's under upcoming as Today", async () => {
    const past = await prisma.event.create({ data: { schoolId: schoolA.schoolId, title: "Science fair", date: addDays(today(), -2), isPublished: true } });
    const now = await prisma.event.create({ data: { schoolId: schoolA.schoolId, title: "Assembly", date: today(), isPublished: true } });
    const { upcoming, completed } = await listEvents(teacherOf(schoolA));
    expect(completed.find((row) => row.id === past.id)).toMatchObject({ status: "COMPLETED", countdown: "Completed" });
    expect(upcoming.find((row) => row.id === now.id)).toMatchObject({ status: "TODAY", countdown: "Today" });
  });
});

describe("calendar: approved leave is a marker for those it concerns", () => {
  it("shows a child's approved leave to their parent, the student and the class teacher — not the admin", async () => {
    const studentId = schoolA.studentIds[0]!;
    const from = addDays(today(), 3);
    await prisma.studentLeave.create({
      data: { schoolId: schoolA.schoolId, studentId, sectionId: schoolA.sectionId, fromDate: from, toDate: addDays(from, 1), reason: "SICK", status: "APPROVED", requestedByRole: "PARENT" },
    });
    await prisma.studentLeave.create({
      data: { schoolId: schoolA.schoolId, studentId, sectionId: schoolA.sectionId, fromDate: addDays(from, 5), toDate: addDays(from, 5), reason: "SICK", status: "PENDING", requestedByRole: "PARENT" },
    });
    const range = [today(), addDays(today(), 30)] as const;
    const leaves = async (ctx: Parameters<typeof getCalendarEntries>[0]) => (await getCalendarEntries(ctx, ...range)).filter((entry) => entry.kind === "LEAVE");

    expect(await leaves(parentOf(schoolA))).toHaveLength(1); // pending leave is not on the calendar
    expect(await leaves(studentOf(schoolA))).toHaveLength(1);
    expect(await leaves(teacherOf(schoolA))).toHaveLength(1);
    expect(await leaves(adminOf(schoolA))).toHaveLength(0);
    expect(await leaves(parentOf(schoolB))).toHaveLength(0);

    // The Leave card counts by status for the same people.
    expect(await studentLeaveSummary(teacherOf(schoolA))).toMatchObject({ pending: 1, approved: 1, rejected: 0 });
    expect((await studentLeaveSummary(teacherOf(schoolA))).highlight?.status).toBe("PENDING");
    expect((await studentLeaveSummary(parentOf(schoolA))).highlight?.status).toBe("APPROVED");
    expect(await studentLeaveSummary(parentOf(schoolB))).toMatchObject({ pending: 0, approved: 0 });
  });
});
