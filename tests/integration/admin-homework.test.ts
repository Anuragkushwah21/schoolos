/**
 * The School Admin's read-only homework overview: every published piece of
 * homework in their own school, nothing from another school, and no drafts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays, today } from "@/lib/dates";
import { ForbiddenError } from "@/lib/errors";
import { listHomeworkForAdmin } from "@/server/classwork/homework";
import { prisma } from "@/server/db/prisma";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

async function homework(school: SeededSchool, title: string, status: "PUBLISHED" | "DRAFT", dueInDays: number) {
  await prisma.homework.create({
    data: {
      schoolId: school.schoolId,
      academicSessionId: school.academicSessionId,
      sectionId: school.sectionId,
      subjectId: school.subjectId,
      teacherId: school.teacherId,
      title,
      assignedOn: today(),
      dueOn: addDays(today(), dueInDays),
      status,
    },
  });
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await homework(schoolA, "Fractions worksheet", "PUBLISHED", 2);
  await homework(schoolA, "Due today essay", "PUBLISHED", 0);
  await homework(schoolA, "Unfinished draft", "DRAFT", 3);
  await homework(schoolB, "Other school's work", "PUBLISHED", 2);
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("admin homework overview", () => {
  it("lists this school's published homework only", async () => {
    const { rows, setToday, dueToday } = await listHomeworkForAdmin(adminOf(schoolA));
    const titles = rows.map((row) => row.title).sort();
    expect(titles).toEqual(["Due today essay", "Fractions worksheet"]);
    expect(setToday).toBe(2);
    expect(dueToday).toBe(1);
    expect(rows.find((row) => row.title === "Due today essay")?.timeStatus).toBe("DUE_TODAY");
  });

  it("filters by when it is due", async () => {
    const { rows } = await listHomeworkForAdmin(adminOf(schoolA), { due: "upcoming" });
    expect(rows.map((row) => row.title)).toEqual(["Fractions worksheet"]);
  });

  it("is for the School Admin only", async () => {
    await expect(listHomeworkForAdmin(teacherOf(schoolA))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listHomeworkForAdmin(contextFor(schoolA, schoolA.parentUserId, "PARENT"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
