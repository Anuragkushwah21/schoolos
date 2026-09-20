/**
 * Timetable clash rules. The database refuses identical start times; partial
 * overlaps are the application's job.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { slotSchema } from "@/lib/validation/timetable";
import { canAccessSection } from "@/server/auth/teacher-access";
import { prisma } from "@/server/db/prisma";
import { createSlot } from "@/server/timetable/service";

import { adminOf, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

function slot(overrides: Record<string, string>) {
  return slotSchema.parse({
    sectionId: schoolA.sectionId,
    subjectId: schoolA.subjectId,
    teacherId: schoolA.teacherId,
    dayOfWeek: "MONDAY",
    startMinute: "09:00",
    endMinute: "09:45",
    ...overrides,
  });
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("timetable", () => {
  it("adds a period", async () => {
    await createSlot(adminOf(schoolA), slot({}));
    expect(await prisma.timetableSlot.count({ where: { sectionId: schoolA.sectionId } })).toBe(1);
  });

  it("refuses a period that partly overlaps the section's existing one", async () => {
    await expect(
      createSlot(adminOf(schoolA), slot({ startMinute: "09:30", endMinute: "10:15" })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses to double-book the teacher in another section", async () => {
    await expect(
      createSlot(
        adminOf(schoolA),
        slot({ sectionId: schoolA.unassignedSectionId, startMinute: "09:15", endMinute: "10:00" }),
      ),
    ).rejects.toThrow(/already has a period/);
  });

  it("allows back-to-back periods", async () => {
    await createSlot(adminOf(schoolA), slot({ startMinute: "09:45", endMinute: "10:30" }));
  });

  it("assigns the subject to the teacher, granting section access", async () => {
    expect(await canAccessSection(teacherOf(schoolA), schoolA.unassignedSectionId)).toBe(false);
    await createSlot(
      adminOf(schoolA),
      slot({ sectionId: schoolA.unassignedSectionId, dayOfWeek: "TUESDAY" }),
    );
    expect(await canAccessSection(teacherOf(schoolA), schoolA.unassignedSectionId)).toBe(true);
  });

  it("rejects another school's teacher", async () => {
    await expect(
      createSlot(adminOf(schoolA), slot({ teacherId: schoolB.teacherId, dayOfWeek: "FRIDAY" })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a period that ends before it starts", () => {
    expect(() => slot({ startMinute: "11:00", endMinute: "10:00" })).toThrow();
  });
});
