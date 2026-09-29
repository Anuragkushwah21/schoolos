/**
 * A person's interface language is stored on their own user row and read with
 * their session; it changes nothing about what they may reach.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSession, validateSessionToken } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { listStudents } from "@/server/people/students";

import { adminOf, contextFor } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("language preference", () => {
  it("is per person and travels with the session", async () => {
    await prisma.user.update({ where: { id: schoolA.teacherUserId }, data: { preferredLanguage: "hi" } });
    const teacher = await validateSessionToken((await createSession(schoolA.teacherUserId)).token);
    const parent = await validateSessionToken((await createSession(schoolA.parentUserId)).token);
    expect(teacher?.preferredLanguage).toBe("hi");
    // Someone else in the same school keeps their own (unset) choice.
    expect(parent?.preferredLanguage).toBeNull();
  });

  it("grants nothing: a Hindi-speaking admin still sees only their own school", async () => {
    await prisma.user.update({ where: { id: schoolA.adminUserId }, data: { preferredLanguage: "hi" } });
    const ctx = adminOf(schoolA);
    const { rows } = await listStudents({ ...ctx, user: { ...ctx.user, preferredLanguage: "hi" } }, {});
    expect(rows.map((row) => row.admissionNumber).sort()).toEqual(["ADM1", "ADM2", "ADM3"]);
    await expect(listStudents(contextFor(schoolB, schoolA.adminUserId, "TEACHER"), {})).rejects.toThrow();
  });
});
