/**
 * Rooms: School Setup → Rooms, and the timetable picking a room per period.
 * A room is never tied to a class; two periods cannot share one room at the
 * same time; a room any period has used is history (deactivate, not delete).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { roomSchema } from "@/lib/validation/rooms";
import { slotSchema, slotUpdateSchema } from "@/lib/validation/timetable";
import { createRoom, deleteRoom, getRoom, listRooms, roomOptions, setRoomActive, updateRoom } from "@/server/academics/rooms";
import { prisma } from "@/server/db/prisma";
import { createSlot, getRoomTimetable, updateSlot } from "@/server/timetable/service";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let otherTeacherId: string;
let artId: string;

const room = (school: SeededSchool, name: string, extra: Record<string, string> = {}) =>
  createRoom(adminOf(school), roomSchema.parse({ name, type: "CLASSROOM", ...extra }));

const period = (sectionId: string, teacherId: string, subjectId: string, day: string, start: string, end: string, roomId?: string) =>
  slotSchema.parse({ sectionId, subjectId, teacherId, dayOfWeek: day, startMinute: start, endMinute: end, roomId: roomId ?? "" });

async function slotAt(sectionId: string, day: string, start: number) {
  return prisma.timetableSlot.findFirstOrThrow({
    where: { schoolId: schoolA.schoolId, sectionId, dayOfWeek: day as never, startMinute: start },
    select: { id: true, room: true, roomId: true },
  });
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const user = await prisma.user.create({
    data: { email: "rooms-teacher@iso-test-a.test", passwordHash: "x", role: "TEACHER", firstName: "Second", lastName: "Teacher", schoolId: schoolA.schoolId },
  });
  otherTeacherId = (
    await prisma.teacher.create({ data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "ROOMS2", firstName: "Second", lastName: "Teacher" } })
  ).id;
  artId = (await prisma.subject.create({ data: { schoolId: schoolA.schoolId, name: "Art", code: "ART-R" } })).id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("School Setup → Rooms", () => {
  it("adds, lists, searches and filters rooms; names are unique ignoring capitals and spaces", async () => {
    const id = await room(schoolA, "  Physics   Lab ", { type: "LAB", capacity: "30", building: "Science block", floor: "First" });
    const saved = await getRoom(adminOf(schoolA), id);
    expect(saved).toMatchObject({ name: "Physics Lab", type: "LAB", capacity: 30, building: "Science block", floor: "First", isActive: true, periodsEver: 0 });

    await expect(room(schoolA, "physics lab")).rejects.toBeInstanceOf(ConflictError);
    // Another school can have its own Physics Lab.
    await room(schoolB, "Physics Lab");

    await room(schoolA, "R101");
    expect((await listRooms(adminOf(schoolA), { q: "science" })).map((r) => r.name)).toEqual(["Physics Lab"]);
    expect((await listRooms(adminOf(schoolA), { type: "CLASSROOM" })).map((r) => r.name)).toContain("R101");
    expect((await listRooms(adminOf(schoolA), { type: "LAB" })).map((r) => r.name)).not.toContain("R101");
  });

  it("validates the form", () => {
    expect(roomSchema.safeParse({ name: "", type: "CLASSROOM" }).success).toBe(false);
    expect(roomSchema.safeParse({ name: "R1", type: "KITCHEN" }).success).toBe(false);
    expect(roomSchema.safeParse({ name: "R1", type: "CLASSROOM", capacity: "0" }).success).toBe(false);
    expect(roomSchema.safeParse({ name: "R1", type: "CLASSROOM", capacity: "12.5" }).success).toBe(false);
    expect(roomSchema.safeParse({ name: "x".repeat(41), type: "CLASSROOM" }).success).toBe(false);
  });

  it("is School Admin only, and another school's room is not found", async () => {
    const id = await room(schoolA, "Staff-only check");
    await expect(listRooms(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createRoom(teacherOf(schoolA), roomSchema.parse({ name: "T", type: "CLASSROOM" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createRoom(contextFor(schoolA, schoolA.parentUserId, "PARENT"), roomSchema.parse({ name: "P", type: "CLASSROOM" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getRoom(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateRoom(adminOf(schoolB), id, roomSchema.parse({ name: "Stolen", type: "HALL" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(setRoomActive(adminOf(schoolB), id, false)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteRoom(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    // Nor can school B timetable school A's room.
    const bSection = schoolB.sectionId;
    await expect(createSlot(adminOf(schoolB), period(bSection, schoolB.teacherId, schoolB.subjectId, "MONDAY", "08:00", "08:40", id))).rejects.toBeInstanceOf(NotFoundError);
    expect((await getRoom(adminOf(schoolA), id)).name).toBe("Staff-only check");
  });
});

describe("timetable rooms", () => {
  it("refuses an occupied room — even a partial overlap — and says who is in it", async () => {
    const lab = await room(schoolA, "Chem Lab", { type: "LAB" });
    await createSlot(adminOf(schoolA), period(schoolA.sectionId, schoolA.teacherId, schoolA.subjectId, "WEDNESDAY", "10:00", "10:45", lab));

    const clash = createSlot(adminOf(schoolA), period(schoolA.unassignedSectionId, otherTeacherId, artId, "WEDNESDAY", "10:30", "11:15", lab));
    await expect(clash).rejects.toBeInstanceOf(ConflictError);
    await expect(clash).rejects.toThrow(/Room Chem Lab is already occupied on Wednesday .*Choose another room or time/);

    // Back to back is fine, and so is the same time on another day.
    await createSlot(adminOf(schoolA), period(schoolA.unassignedSectionId, otherTeacherId, artId, "WEDNESDAY", "10:45", "11:30", lab));
    await createSlot(adminOf(schoolA), period(schoolA.unassignedSectionId, otherTeacherId, artId, "THURSDAY", "10:00", "10:45", lab));
    expect(await getRoomTimetable(adminOf(schoolA), lab, schoolA.academicSessionId)).toHaveLength(3);

    // The room is not tied to a class: both sections used it.
    const sections = new Set((await getRoomTimetable(adminOf(schoolA), lab, schoolA.academicSessionId)).map((s) => s.section.id));
    expect(sections.size).toBe(2);
  });

  it("lets only one of two simultaneous bookings of a room through", async () => {
    const hall = await room(schoolA, "Hall", { type: "HALL" });
    const results = await Promise.allSettled([
      createSlot(adminOf(schoolA), period(schoolA.sectionId, schoolA.teacherId, schoolA.subjectId, "FRIDAY", "13:00", "13:45", hall)),
      createSlot(adminOf(schoolA), period(schoolA.unassignedSectionId, otherTeacherId, artId, "FRIDAY", "13:15", "14:00", hall)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
  });

  it("an inactive room takes no new periods, but periods already in it keep it", async () => {
    const r = await room(schoolA, "Old Room");
    await createSlot(adminOf(schoolA), period(schoolA.sectionId, schoolA.teacherId, schoolA.subjectId, "TUESDAY", "14:00", "14:45", r));
    const slot = await slotAt(schoolA.sectionId, "TUESDAY", 14 * 60);

    expect(await setRoomActive(adminOf(schoolA), r, false)).toBe(1);
    expect((await roomOptions(adminOf(schoolA))).some((o) => o.value === r)).toBe(false);
    expect((await roomOptions(adminOf(schoolA), r)).some((o) => o.value === r)).toBe(true);

    await expect(
      createSlot(adminOf(schoolA), period(schoolA.unassignedSectionId, otherTeacherId, artId, "TUESDAY", "15:00", "15:45", r)),
    ).rejects.toThrow(/inactive/);
    // Editing the existing period (a new time) keeps its room.
    await updateSlot(adminOf(schoolA), slotUpdateSchema.parse({ slotId: slot.id, subjectId: schoolA.subjectId, teacherId: schoolA.teacherId, dayOfWeek: "TUESDAY", startMinute: "14:05", endMinute: "14:50", roomId: r }));
    expect((await slotAt(schoolA.sectionId, "TUESDAY", 14 * 60 + 5)).roomId).toBe(r);
  });

  it("renaming a room renames it on every period", async () => {
    const r = await room(schoolA, "R2O1");
    await createSlot(adminOf(schoolA), period(schoolA.sectionId, schoolA.teacherId, schoolA.subjectId, "MONDAY", "08:00", "08:40", r));
    await updateRoom(adminOf(schoolA), r, roomSchema.parse({ name: "R201", type: "CLASSROOM" }));
    expect((await slotAt(schoolA.sectionId, "MONDAY", 8 * 60)).room).toBe("R201");
  });

  it("deletes only a room no period has ever used", async () => {
    const unused = await room(schoolA, "Spare");
    await deleteRoom(adminOf(schoolA), unused);
    await expect(getRoom(adminOf(schoolA), unused)).rejects.toBeInstanceOf(NotFoundError);

    const used = (await prisma.room.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, name: "R201" } })).id;
    await expect(deleteRoom(adminOf(schoolA), used)).rejects.toThrow(/Deactivate it instead/);
  });

  it("edits a period's room with the same clash rules, ignoring the period itself", async () => {
    const [a, b] = [await room(schoolA, "Edit A"), await room(schoolA, "Edit B")];
    await createSlot(adminOf(schoolA), period(schoolA.sectionId, schoolA.teacherId, schoolA.subjectId, "SATURDAY", "09:00", "09:45", a));
    await createSlot(adminOf(schoolA), period(schoolA.unassignedSectionId, otherTeacherId, artId, "SATURDAY", "09:00", "09:45", b));
    const mine = await slotAt(schoolA.sectionId, "SATURDAY", 9 * 60);
    const edit = (roomId: string, start = "09:00", end = "09:45") =>
      updateSlot(adminOf(schoolA), slotUpdateSchema.parse({ slotId: mine.id, subjectId: schoolA.subjectId, teacherId: schoolA.teacherId, dayOfWeek: "SATURDAY", startMinute: start, endMinute: end, roomId }));

    // Saving it unchanged in its own room is not a clash with itself.
    await edit(a, "09:00", "09:40");
    await expect(edit(b)).rejects.toThrow(/Room Edit B is already occupied/);
    await edit("");
    expect((await slotAt(schoolA.sectionId, "SATURDAY", 9 * 60)).roomId).toBeNull();
  });

  it("once lessons are recorded, only the room of a period can change", async () => {
    const [x, y] = [await room(schoolA, "Rec X"), await room(schoolA, "Rec Y")];
    await createSlot(adminOf(schoolA), period(schoolA.sectionId, schoolA.teacherId, schoolA.subjectId, "THURSDAY", "15:00", "15:45", x));
    const slot = await slotAt(schoolA.sectionId, "THURSDAY", 15 * 60);
    await prisma.classSession.create({
      data: { schoolId: schoolA.schoolId, timetableSlotId: slot.id, date: new Date("2026-09-03"), scheduledTeacherId: schoolA.teacherId },
    });
    const base = { slotId: slot.id, subjectId: schoolA.subjectId, teacherId: schoolA.teacherId, dayOfWeek: "THURSDAY", startMinute: "15:00", endMinute: "15:45" };
    await expect(updateSlot(adminOf(schoolA), slotUpdateSchema.parse({ ...base, startMinute: "15:10", endMinute: "15:55", roomId: x }))).rejects.toThrow(/only its room can change/);
    await updateSlot(adminOf(schoolA), slotUpdateSchema.parse({ ...base, roomId: y }));
    expect((await slotAt(schoolA.sectionId, "THURSDAY", 15 * 60)).roomId).toBe(y);
  });

  it("only the School Admin edits periods", async () => {
    const slot = await slotAt(schoolA.sectionId, "THURSDAY", 15 * 60);
    const input = slotUpdateSchema.parse({ slotId: slot.id, subjectId: schoolA.subjectId, teacherId: schoolA.teacherId, dayOfWeek: "THURSDAY", startMinute: "15:00", endMinute: "15:45", roomId: "" });
    await expect(updateSlot(teacherOf(schoolA), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateSlot(adminOf(schoolB), input)).rejects.toBeInstanceOf(NotFoundError);
  });
});
