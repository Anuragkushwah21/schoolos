/**
 * The tenant scope must survive into interactive transactions. Services write
 * `tx.model.updateMany({ where: {} })` inside `ctx.db.$transaction`, which is
 * only safe if `tx` is still scoped to the session's school.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { forSchool } from "@/server/tenancy/scope";

import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("tenant scope inside $transaction", () => {
  it("scopes reads and bulk writes made through the transaction client", async () => {
    const db = forSchool(schoolA.schoolId);

    const seen = await db.$transaction(async (tx) => {
      await tx.academicSession.updateMany({ where: {}, data: { isCurrent: false } });
      return tx.student.count();
    });

    expect(seen).toBe(schoolA.studentIds.length);

    const bSession = await prisma.academicSession.findUniqueOrThrow({
      where: { id: schoolB.academicSessionId },
    });
    expect(bSession.isCurrent).toBe(true);

    await prisma.academicSession.update({
      where: { id: schoolA.academicSessionId },
      data: { isCurrent: true },
    });
  });
});
