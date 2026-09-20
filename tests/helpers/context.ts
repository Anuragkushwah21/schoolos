import type { UserRole } from "@/generated/prisma/enums";
import type { TenantContext } from "@/server/auth/current-user";
import type { SessionUser } from "@/server/auth/session";
import { forSchool } from "@/server/tenancy/scope";

import type { SeededSchool } from "./isolation-fixture";

/** The context a guard would have produced for this user. */
export function contextFor(school: SeededSchool, userId: string, role: UserRole): TenantContext {
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

export function adminOf(school: SeededSchool): TenantContext {
  return contextFor(school, school.adminUserId, "SCHOOL_ADMIN");
}

export function teacherOf(school: SeededSchool): TenantContext {
  return contextFor(school, school.teacherUserId, "TEACHER");
}
