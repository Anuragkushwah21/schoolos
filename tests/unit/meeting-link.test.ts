/** The meeting link is optional; a link typed without https:// is completed. */
import { describe, expect, it } from "vitest";

import { meetingSchema } from "@/lib/validation/meetings";

const base = { type: "PTM", title: "Term 1 PTM", date: "2026-11-20", startMinute: "10:00", endMinute: "12:00", audiences: ["PARENTS"], scope: "SCHOOL" };

describe("meeting link", () => {
  it("can be left out or empty", () => {
    expect(meetingSchema.parse(base).meetingLink).toBeNull();
    expect(meetingSchema.parse({ ...base, meetingLink: "" }).meetingLink).toBeNull();
    expect(meetingSchema.parse({ ...base, meetingLink: "   " }).meetingLink).toBeNull();
  });

  it("adds https:// when it is missing, and keeps a full link as it is", () => {
    expect(meetingSchema.parse({ ...base, meetingLink: "meet.google.com/abc-defg-hij" }).meetingLink).toBe("https://meet.google.com/abc-defg-hij");
    expect(meetingSchema.parse({ ...base, meetingLink: "https://zoom.us/j/123" }).meetingLink).toBe("https://zoom.us/j/123");
  });

  it("still refuses a plain http:// or broken link", () => {
    expect(() => meetingSchema.parse({ ...base, meetingLink: "http://example.com" })).toThrow(/https/);
    expect(() => meetingSchema.parse({ ...base, meetingLink: "not a link at all" })).toThrow();
  });
});
