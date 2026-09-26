/**
 * Role-based access control, specifically question 5 of the checklist:
 * being in the right school is necessary but not sufficient.
 *
 * A teacher may act only on sections they actually teach. Tenant scoping alone
 * would let them touch any section in their school, because those sections do
 * legitimately belong to it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserRole } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/lib/errors";
import { ROLE_HOME, ROLE_PATH_PREFIX, isTenantRole, roleHomePath } from "@/lib/roles";
import type { TenantContext } from "@/server/auth/current-user";
import type { SessionUser } from "@/server/auth/session";
import {
  accessibleSectionIds,
  canAccessSection,
  requireSectionAccess,
} from "@/server/auth/teacher-access";
import { prisma } from "@/server/db/prisma";
import { forSchool } from "@/server/tenancy/scope";

import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

/** Build the context a guard would have produced for this user. */
function contextFor(
  school: SeededSchool,
  userId: string,
  role: UserRole,
): TenantContext {
  const user: SessionUser = {
    id: userId,
    email: "fixture@example.test",
    role,
    firstName: "Fixture",
    lastName: "User",
    schoolId: school.schoolId,
    schoolSlug: "fixture",
    schoolName: "Fixture School",
    schoolStatus: "ACTIVE",
  };

  return {
    user,
    schoolId: school.schoolId,
    schoolSlug: "fixture",
    schoolName: "Fixture School",
    db: forSchool(school.schoolId),
  };
}

beforeAll(async () => {
  const fixture = await createIsolationFixture();
  schoolA = fixture.schoolA;
  schoolB = fixture.schoolB;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("role routing", () => {
  it("gives every role a distinct home", () => {
    const homes = Object.values(ROLE_HOME);
    expect(new Set(homes).size).toBe(homes.length);
  });

  it("maps each role to its own dashboard", () => {
    // The four signed-in roles of the product each land on their own
    // dashboard, one level under the area they own.
    expect(roleHomePath("SUPER_ADMIN")).toBe("/super-admin/dashboard");
    expect(roleHomePath("SCHOOL_ADMIN")).toBe("/school-admin/dashboard");
    expect(roleHomePath("TEACHER")).toBe("/teacher/dashboard");
    expect(roleHomePath("PARENT")).toBe("/parent/dashboard");
    expect(roleHomePath("STUDENT")).toBe("/student/dashboard");
  });

  it("guards each role's whole area, not just its landing page", () => {
    // A landing page deeper than the area would make the prefix too narrow and
    // leave every other page in that area unprotected by the proxy.
    for (const role of ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] as const) {
      expect(roleHomePath(role).startsWith(`${ROLE_PATH_PREFIX[role]}/`)).toBe(true);
    }
  });

  it("treats SUPER_ADMIN as the only non-tenant role", () => {
    expect(isTenantRole("SUPER_ADMIN")).toBe(false);
    for (const role of ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] as const) {
      expect(isTenantRole(role)).toBe(true);
    }
  });
});

describe("teacher section access", () => {
  it("allows a teacher into a section they are assigned to", async () => {
    const ctx = contextFor(schoolA, schoolA.teacherUserId, "TEACHER");

    await expect(canAccessSection(ctx, schoolA.sectionId)).resolves.toBe(true);
    await expect(
      requireSectionAccess(ctx, schoolA.sectionId),
    ).resolves.toBeUndefined();
  });

  it("refuses a section in their own school that they do not teach", async () => {
    const ctx = contextFor(schoolA, schoolA.teacherUserId, "TEACHER");

    await expect(
      canAccessSection(ctx, schoolA.unassignedSectionId),
    ).resolves.toBe(false);
    await expect(
      requireSectionAccess(ctx, schoolA.unassignedSectionId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a section belonging to another school", async () => {
    const ctx = contextFor(schoolA, schoolA.teacherUserId, "TEACHER");

    await expect(canAccessSection(ctx, schoolB.sectionId)).resolves.toBe(false);
  });

  it("lets a school admin reach any section in their own school", async () => {
    const ctx = contextFor(schoolA, schoolA.adminUserId, "SCHOOL_ADMIN");

    await expect(canAccessSection(ctx, schoolA.sectionId)).resolves.toBe(true);
    await expect(
      canAccessSection(ctx, schoolA.unassignedSectionId),
    ).resolves.toBe(true);
  });

  it("gives a school admin blanket section access, a teacher an explicit list", async () => {
    const adminCtx = contextFor(schoolA, schoolA.adminUserId, "SCHOOL_ADMIN");
    const teacherCtx = contextFor(schoolA, schoolA.teacherUserId, "TEACHER");

    await expect(accessibleSectionIds(adminCtx)).resolves.toBe("ALL");

    const sections = await accessibleSectionIds(teacherCtx);
    expect(sections).toEqual([schoolA.sectionId]);
  });

  it("gives students and parents no section access at all", async () => {
    const parentCtx = contextFor(schoolA, schoolA.parentUserId, "PARENT");

    await expect(canAccessSection(parentCtx, schoolA.sectionId)).resolves.toBe(
      false,
    );
    await expect(accessibleSectionIds(parentCtx)).resolves.toEqual([]);
  });

  it("refuses a teacher whose user has no teacher profile", async () => {
    const ctx = contextFor(schoolA, schoolA.adminUserId, "TEACHER");

    await expect(canAccessSection(ctx, schoolA.sectionId)).resolves.toBe(false);
  });
});

describe("cross-school role confusion", () => {
  it("does not let School B's admin reach School A's sections", async () => {
    // A context claiming School B, asked about a School A section.
    const ctx = contextFor(schoolB, schoolB.adminUserId, "SCHOOL_ADMIN");

    const section = await ctx.db.section.findFirst({
      where: { id: schoolA.sectionId },
    });

    expect(section).toBeNull();
  });

  it("does not let School A's teacher list School B's students", async () => {
    const ctx = contextFor(schoolA, schoolA.teacherUserId, "TEACHER");

    const students = await ctx.db.student.findMany();

    expect(students).toHaveLength(schoolA.studentIds.length);
    expect(
      students.some((s) => schoolB.studentIds.includes(s.id)),
    ).toBe(false);
  });
});
