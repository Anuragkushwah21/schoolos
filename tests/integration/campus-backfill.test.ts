/**
 * The campus migration's backfill, run against schools that predate
 * organizations: each school becomes the primary campus of exactly one
 * organization, keeping its id, name, data and logins — and running it again
 * changes nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSession, validateSessionToken } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

/** The backfill statements, exactly as the migration runs them. */
function backfillStatements(): string[] {
  const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261027090000_campuses/migration.sql"), "utf8");
  const section = sql.slice(sql.indexOf("-- Backfill:"));
  return section
    .split(/;\s*\n/)
    .map((statement) => statement.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean);
}

async function runBackfill() {
  for (const statement of backfillStatements()) await prisma.$executeRawUnsafe(statement);
}

const ids = () => [schoolA.schoolId, schoolB.schoolId];

async function snapshot() {
  const schools = await prisma.school.findMany({ where: { id: { in: ids() } }, orderBy: { id: "asc" }, select: { id: true, slug: true, name: true, status: true, organizationId: true, _count: { select: { students: true, teachers: true, parents: true, users: true, studentAttendance: true, sections: true } } } });
  const organizations = await prisma.organization.findMany({ where: { schools: { some: { id: { in: ids() } } } }, select: { id: true, name: true, ownerId: true, _count: { select: { schools: true } } } });
  return { schools, organizations };
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  // Fixture schools are made like pre-migration schools: no organization.
  expect((await prisma.school.findMany({ where: { id: { in: ids() } }, select: { organizationId: true } })).every((row) => row.organizationId === null)).toBe(true);
}, 60_000);

afterAll(async () => {
  const orgs = (await prisma.school.findMany({ where: { id: { in: ids() } }, select: { organizationId: true } })).flatMap((row) => (row.organizationId ? [row.organizationId] : []));
  await destroyIsolationFixture();
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.$disconnect();
});

describe("campus backfill", () => {
  it("gives each existing school one organization, keeping its identity and data", async () => {
    const before = await snapshot();
    await runBackfill();
    const after = await snapshot();

    for (const school of after.schools) {
      const was = before.schools.find((row) => row.id === school.id)!;
      // Same id, slug, name, status and every count — only the organization link is new.
      expect({ ...school, organizationId: null }).toEqual({ ...was, organizationId: null });
      expect(school.organizationId).toBe(`org_${school.id}`);
    }
    expect(after.organizations).toHaveLength(2);
    const orgA = after.organizations.find((row) => row.id === `org_${schoolA.schoolId}`)!;
    expect(orgA).toMatchObject({ name: "Isolation Test School A", ownerId: schoolA.adminUserId, _count: { schools: 1 } });
    // No "Campus 1" renaming.
    expect(after.schools.map((row) => row.name)).toEqual(before.schools.map((row) => row.name));
  });

  it("running it again creates nothing new", async () => {
    const once = await snapshot();
    const total = await prisma.organization.count();
    await runBackfill();
    await runBackfill();
    expect(await snapshot()).toEqual(once);
    expect(await prisma.organization.count()).toBe(total);
  });

  it("every existing login still signs in to the same school", async () => {
    for (const userId of [schoolA.adminUserId, schoolA.teacherUserId, schoolA.parentUserId, schoolA.studentUserId, schoolB.adminUserId]) {
      const { token } = await createSession(userId);
      const user = await validateSessionToken(token);
      const expected = userId === schoolB.adminUserId ? schoolB.schoolId : schoolA.schoolId;
      expect(user?.schoolId).toBe(expected);
      expect(user?.homeSchoolId).toBe(expected);
    }
  });
});
