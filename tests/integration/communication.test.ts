/**
 * Notice visibility: audience, status, publish window, public flag, tenant.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { noticeSchema } from "@/lib/validation/communication";
import { prisma } from "@/server/db/prisma";
import { noticesFor, publicNotices, saveNotice } from "@/server/communication/notices";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const day = 24 * 60 * 60 * 1000;

function notice(overrides: Record<string, string>) {
  return noticeSchema.parse({ title: "T", body: "Body", audience: "ALL", status: "PUBLISHED", ...overrides });
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const admin = adminOf(schoolA);
  await saveNotice(admin, notice({ title: "For teachers", audience: "TEACHERS" }));
  await saveNotice(admin, notice({ title: "For parents", audience: "PARENTS", isPublic: "on" }));
  await saveNotice(admin, notice({ title: "Draft", status: "DRAFT" }));
  await saveNotice(admin, notice({ title: "Archived", status: "ARCHIVED", isPublic: "on" }));
  await prisma.notice.create({
    data: {
      schoolId: schoolA.schoolId,
      title: "Scheduled",
      body: "Later",
      status: "PUBLISHED",
      publishAt: new Date(Date.now() + 3 * day),
    },
  });
  await prisma.notice.create({
    data: {
      schoolId: schoolA.schoolId,
      title: "Expired",
      body: "Old",
      status: "PUBLISHED",
      publishAt: new Date(Date.now() - 9 * day),
      expiresAt: new Date(Date.now() - day),
    },
  });
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

const titles = (rows: Array<{ title: string }>) => rows.map((r) => r.title).sort();

describe("notice visibility", () => {
  it("shows a teacher only live notices for everyone or for teachers", async () => {
    const seen = titles(await noticesFor(teacherOf(schoolA)));
    expect(seen).toContain("For teachers");
    expect(seen).not.toContain("For parents");
    expect(seen).not.toContain("Draft");
    expect(seen).not.toContain("Archived");
    expect(seen).not.toContain("Scheduled");
    expect(seen).not.toContain("Expired");
  });

  it("shows a parent the parents' notice and not the teachers'", async () => {
    const parent = contextFor(schoolA, schoolA.parentUserId, "PARENT");
    const seen = titles(await noticesFor(parent));
    expect(seen).toContain("For parents");
    expect(seen).not.toContain("For teachers");
  });

  it("never shows one school's notices to another", async () => {
    const seen = titles(await noticesFor(adminOf(schoolB)));
    expect(seen).not.toContain("For teachers");
    expect(seen).toContain("Notice for b");
  });

  it("puts only live public notices on the website", async () => {
    expect(titles(await publicNotices(schoolA.schoolId))).toEqual(["For parents"]);
    expect(await publicNotices(schoolB.schoolId)).toHaveLength(0);
  });
});
