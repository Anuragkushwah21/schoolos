/**
 * Statuses worked out from the date: the rules each module relies on.
 */
import { describe, expect, it } from "vitest";

import { dateOnly } from "@/lib/dates";
import { countdownLabel, daysUntil, homeworkStatus, leaveStatus, lifecycle, noticeStatus, schoolNow, sessionStatus, spanStatus } from "@/lib/time-status";

const d = (day: number) => dateOnly(2026, 10, day);

describe("time statuses", () => {
  it("places a span of days before, during and after — both ends inclusive", () => {
    expect(spanStatus(d(10), d(12), d(9))).toBe("UPCOMING");
    expect(spanStatus(d(10), d(12), d(10))).toBe("ONGOING");
    expect(spanStatus(d(10), d(12), d(12))).toBe("ONGOING");
    expect(spanStatus(d(10), d(12), d(13))).toBe("COMPLETED");
  });

  it("uses the clock for a single day with times", () => {
    expect(sessionStatus(d(10), 600, 720, { date: d(9), minutes: 0 })).toBe("UPCOMING");
    expect(sessionStatus(d(10), 600, 720, { date: d(10), minutes: 540 })).toBe("TODAY");
    expect(sessionStatus(d(10), 600, 720, { date: d(10), minutes: 650 })).toBe("ONGOING");
    expect(sessionStatus(d(10), 600, 720, { date: d(10), minutes: 720 })).toBe("COMPLETED");
    expect(sessionStatus(d(10), null, null, { date: d(10), minutes: 1400 })).toBe("TODAY");
    expect(sessionStatus(d(10), null, null, { date: d(11), minutes: 0 })).toBe("COMPLETED");
  });

  it("moves homework from assigned to due to overdue", () => {
    expect(homeworkStatus(d(10), d(9))).toBe("ASSIGNED");
    expect(homeworkStatus(d(10), d(10))).toBe("DUE_TODAY");
    expect(homeworkStatus(d(10), d(11))).toBe("OVERDUE");
  });

  it("moves only approved leave with the calendar", () => {
    expect(leaveStatus("APPROVED", d(10), d(12), d(9))).toBe("UPCOMING");
    expect(leaveStatus("APPROVED", d(10), d(12), d(11))).toBe("ON_LEAVE");
    expect(leaveStatus("APPROVED", d(10), d(12), d(13))).toBe("COMPLETED");
    expect(leaveStatus("PENDING", d(10), d(12), d(13))).toBe("PENDING");
    expect(leaveStatus("CANCELLED", d(10), d(12), d(11))).toBe("CANCELLED");
  });

  it("keeps a notice active through its hide-after day, and never overrides draft or archived", () => {
    expect(noticeStatus("PUBLISHED", d(10), d(12), d(9))).toBe("SCHEDULED");
    expect(noticeStatus("PUBLISHED", d(10), d(12), d(12))).toBe("ACTIVE");
    expect(noticeStatus("PUBLISHED", d(10), d(12), d(13))).toBe("EXPIRED");
    expect(noticeStatus("DRAFT", null, null, d(13))).toBe("DRAFT");
    expect(noticeStatus("ARCHIVED", null, d(1), d(13))).toBe("ARCHIVED");
  });

  it("reads the school's own wall clock", () => {
    // 18:30 UTC on 9 Oct is midnight in India on 10 Oct.
    expect(schoolNow(new Date(Date.UTC(2026, 9, 9, 18, 30)))).toEqual({ date: d(10), minutes: 0 });
    expect(schoolNow(new Date(Date.UTC(2026, 9, 10, 4, 0))).minutes).toBe(570);
  });
});

describe("the event and meeting lifecycle shown to people", () => {
  const d = (day: number) => new Date(Date.UTC(2026, 9, day));
  const at = (day: number, minutes = 9 * 60) => ({ date: d(day), minutes });
  const sportsDay = { date: d(15), startMinute: 9 * 60, endMinute: 13 * 60 };

  it("counts down, then says Tomorrow, Today and Completed — from the date alone", () => {
    const cases: Array<[number, number, string, string]> = [
      [1, 9 * 60, "UPCOMING", "14 days left"],
      [13, 9 * 60, "UPCOMING", "2 days left"],
      [14, 23 * 60, "UPCOMING", "Tomorrow"],
      [15, 8 * 60, "TODAY", "Today"],
      [15, 10 * 60, "TODAY", "Today"], // running now is still "Today"
      [15, 13 * 60, "COMPLETED", "Completed"], // ended this afternoon
      [16, 8 * 60, "COMPLETED", "Completed"],
    ];
    for (const [day, minutes, status, label] of cases) {
      const clock = at(day, minutes);
      const stage = lifecycle(sportsDay, clock);
      expect(stage, `${day} ${minutes}`).toBe(status);
      expect(countdownLabel(sportsDay.date, stage, clock), `${day} ${minutes}`).toBe(label);
    }
  });

  it("treats an all-day event as Today until the day is over", () => {
    const allDay = { date: d(15), startMinute: null, endMinute: null };
    expect(lifecycle(allDay, at(15, 23 * 60 + 59))).toBe("TODAY");
    expect(lifecycle(allDay, at(16, 0))).toBe("COMPLETED");
  });

  it("lets Cancelled win over the clock, before and after the date", () => {
    expect(lifecycle({ ...sportsDay, cancelled: true }, at(1))).toBe("CANCELLED");
    expect(lifecycle({ ...sportsDay, cancelled: true }, at(20))).toBe("CANCELLED");
    expect(countdownLabel(sportsDay.date, "CANCELLED", at(1))).toBe("Cancelled");
  });

  it("counts whole days", () => {
    expect(daysUntil(d(15), at(1))).toBe(14);
    expect(daysUntil(d(15), at(15))).toBe(0);
    expect(daysUntil(d(15), at(17))).toBe(-2);
  });
});
