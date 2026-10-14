import "server-only";

import { type LimitKey, type Limits, type OptionalRole, OPTIONAL_ROLE_KEYS, cleanLimits, cleanRoles } from "@/lib/school-roles";
import { CURRENT_EMPLOYEE } from "@/lib/validation/lifecycle";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { currentPlanOf, planLimits } from "@/server/platform/entitlements";

/**
 * Which roles each school uses, for the Super Admin: the optional roles the
 * school has switched on (from its plan or adjusted by SchoolOS), and how many
 * current people hold each role. Counts only — never names or records, like
 * the rest of the platform's view of a school.
 *
 * "In use" means at least one current person: an active Principal login, or
 * a staff member in the designation who is employed (active or on leave).
 */

export type RoleUsageRow = {
  role: OptionalRole;
  enabled: boolean;
  people: number;
  /** The campus limit for this role (its own, else the plan's); null = no limit. */
  limit: number | null;
};

export type SchoolRoleUsage = {
  /** School Admins with an active login; teachers active or on leave; active students; all current staff. */
  core: { schoolAdmins: number; teachers: number; students: number; staff: number };
  /** How many people each limit key counts today — for "N in use" next to a limit. */
  used: Partial<Record<LimitKey, number>>;
  /** The plan's limits (before this school's own), for "Plan: N" next to a limit. */
  planLimits: Limits;
  roles: RoleUsageRow[];
  enabledCount: number;
  /** Roles with at least one person. */
  inUse: RoleUsageRow[];
  /** People in a role the school no longer has switched on (kept from before). */
  outsideEnabled: RoleUsageRow[];
};

export async function roleUsage(actor: SessionUser, schoolIds: readonly string[]): Promise<Map<string, SchoolRoleUsage>> {
  assertRole(actor, "SUPER_ADMIN");
  const ids = [...new Set(schoolIds)];
  if (!ids.length) return new Map();

  const [schools, staff, users, teachers, students] = await Promise.all([
    prisma.school.findMany({ where: { id: { in: ids } }, select: { id: true, enabledRoles: true, roleLimits: true } }),
    prisma.staffMember.groupBy({ by: ["schoolId", "role"], where: { schoolId: { in: ids }, status: { in: [...CURRENT_EMPLOYEE] } }, _count: { _all: true } }),
    prisma.user.groupBy({ by: ["schoolId", "role"], where: { schoolId: { in: ids }, role: { in: ["SCHOOL_ADMIN", "PRINCIPAL"] }, isActive: true }, _count: { _all: true } }),
    prisma.teacher.groupBy({ by: ["schoolId"], where: { schoolId: { in: ids }, status: { in: ["ACTIVE", "ON_LEAVE"] } }, _count: { _all: true } }),
    prisma.student.groupBy({ by: ["schoolId"], where: { schoolId: { in: ids }, status: "ACTIVE" }, _count: { _all: true } }),
  ]);
  const plans = await Promise.all(schools.map(async (school) => [school.id, await currentPlanOf(school.id)] as const));
  const planOf = new Map(plans);

  const result = new Map<string, SchoolRoleUsage>();
  for (const school of schools) {
    const enabled = cleanRoles(school.enabledRoles);
    const plan = planOf.get(school.id);
    const fromPlan = plan ? planLimits(plan) : {};
    const limits = { ...fromPlan, ...cleanLimits(school.roleLimits) };
    const people = (role: OptionalRole) =>
      role === "PRINCIPAL"
        ? (users.find((row) => row.schoolId === school.id && row.role === "PRINCIPAL")?._count._all ?? 0)
        : (staff.find((row) => row.schoolId === school.id && row.role === role)?._count._all ?? 0);
    const roles = OPTIONAL_ROLE_KEYS.map((role) => ({ role, enabled: enabled.includes(role), people: people(role), limit: limits[role] ?? null }));
    const core = {
      schoolAdmins: users.find((row) => row.schoolId === school.id && row.role === "SCHOOL_ADMIN")?._count._all ?? 0,
      teachers: teachers.find((row) => row.schoolId === school.id)?._count._all ?? 0,
      students: students.find((row) => row.schoolId === school.id)?._count._all ?? 0,
      staff: staff.filter((row) => row.schoolId === school.id).reduce((sum, row) => sum + row._count._all, 0),
    };
    result.set(school.id, {
      core,
      used: { STUDENTS: core.students, TEACHERS: core.teachers, STAFF: core.staff, ...Object.fromEntries(roles.map((row) => [row.role, row.people])) },
      planLimits: fromPlan,
      roles,
      enabledCount: enabled.length,
      inUse: roles.filter((row) => row.people > 0),
      outsideEnabled: roles.filter((row) => row.people > 0 && !row.enabled),
    });
  }
  return result;
}
