import "server-only";

import { today } from "@/lib/dates";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { hashSessionToken } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { financeSnapshot } from "@/server/analytics/admin-dashboard";
import type { TenantContext } from "@/server/auth/current-user";
import { currentPlanOf } from "@/server/platform/entitlements";
import { forSchool } from "@/server/tenancy/scope";

/**
 * Owners/Organizations and their campuses.
 *
 * A campus is a complete school (`School`): all of its operational data is
 * scoped by its own `schoolId`, exactly as before, so two campuses of one
 * owner never share students, staff or money. The organization only groups
 * them, for the owner's campus switcher, the All Campuses summary and campus
 * requests.
 *
 * Multi-campus is off unless the plan (or the Super Admin, for one
 * organization) allows more than one campus.
 */

const COUNTED = ["PENDING", "UNDER_REVIEW", "ACTIVE", "SUSPENDED"] as const;

/** The organization of a school, created on first use for a school that predates organizations. */
export async function ensureOrganization(schoolId: string) {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true, organizationId: true } });
  if (!school) throw new NotFoundError();
  if (school.organizationId) return school.organizationId;
  const owner = await prisma.user.findFirst({ where: { schoolId, role: "SCHOOL_ADMIN", ownedOrganization: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  const organization = await prisma.organization.create({ data: { name: school.name, ownerId: owner?.id ?? null } });
  await prisma.school.update({ where: { id: schoolId }, data: { organizationId: organization.id } });
  return organization.id;
}

/** The organization's campus limit: the Super Admin's override, else the plan of its first campus. */
export async function campusLimitOf(organizationId: string): Promise<{ limit: number; planName: string | null; overridden: boolean }> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { campusLimitOverride: true, schools: { where: { status: { in: [...COUNTED] } }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } } },
  });
  if (!organization) throw new NotFoundError();
  const primary = organization.schools[0];
  const plan = primary ? await currentPlanOf(primary.id) : null;
  if (organization.campusLimitOverride !== null) return { limit: organization.campusLimitOverride, planName: plan?.name ?? null, overridden: true };
  return { limit: plan?.campusLimit ?? 1, planName: plan?.name ?? null, overridden: false };
}

/** Campuses that count towards the limit (live, waiting or suspended — not rejected or closed). */
export async function campusCount(organizationId: string): Promise<number> {
  return prisma.school.count({ where: { organizationId, status: { in: [...COUNTED] } } });
}

/** The organization a School Admin's own campus belongs to, with its campuses and limit. */
export async function myOrganization(user: SessionUser) {
  assertRole(user, "SCHOOL_ADMIN");
  if (!user.homeSchoolId && !user.schoolId) throw new ForbiddenError();
  const homeId = user.homeSchoolId ?? user.schoolId!;
  const organizationId = await ensureOrganization(homeId);
  const [organization, limit, count] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        owner: { select: { firstName: true, lastName: true } },
        schools: { where: { status: { in: [...COUNTED] } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, city: true, state: true, status: true, createdAt: true } },
      },
    }),
    campusLimitOf(organizationId),
    campusCount(organizationId),
  ]);
  const isOwner = organization.ownerId === user.id;
  return {
    ...organization,
    isOwner,
    // Only the owner sees every campus; another School Admin sees their own.
    schools: isOwner ? organization.schools : organization.schools.filter((school) => school.id === homeId),
    limit: limit.limit,
    planName: limit.planName,
    count,
    multiCampus: limit.limit > 1,
  };
}

/** The campuses an Owner may switch between (live ones only); empty for anyone else. */
export async function switchableCampuses(user: SessionUser) {
  if (user.role !== "SCHOOL_ADMIN") return [];
  const organization = await prisma.organization.findUnique({
    where: { ownerId: user.id },
    select: { schools: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } } },
  });
  return organization?.schools ?? [];
}

/**
 * Switch the Owner's session to one of their campuses (or back home with
 * null). Checked here and again on every request in `validateSessionToken`.
 */
export async function switchCampus(user: SessionUser, sessionToken: string, schoolId: string | null): Promise<{ name: string }> {
  assertRole(user, "SCHOOL_ADMIN");
  const home = user.homeSchoolId ?? user.schoolId;
  let target: { id: string; name: string } | null;
  if (!schoolId || schoolId === home) {
    target = home ? await prisma.school.findUnique({ where: { id: home }, select: { id: true, name: true } }) : null;
  } else {
    target = await prisma.school.findFirst({ where: { id: schoolId, status: "ACTIVE", organization: { ownerId: user.id } }, select: { id: true, name: true } });
  }
  // Another owner's campus, a closed one or a made-up id: refused alike.
  if (!target) throw new ForbiddenError("You can only switch to your own active schools.");
  await prisma.session.updateMany({ where: { tokenHash: hashSessionToken(sessionToken), userId: user.id }, data: { activeSchoolId: target.id === home ? null : target.id } });
  return { name: target.name };
}

/**
 * All Campuses: one high-level row per campus for the Owner — never the
 * campuses' detailed records. Each figure is counted inside its own campus.
 */
export async function allCampusesSummary(user: SessionUser) {
  assertRole(user, "SCHOOL_ADMIN");
  const organization = await prisma.organization.findUnique({
    where: { ownerId: user.id },
    select: { id: true, name: true, schools: { where: { status: { in: [...COUNTED] } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, city: true, status: true, optionalModules: true } } },
  });
  if (!organization) throw new ForbiddenError("Only the owner sees the All Campuses summary.");
  const date = today();
  const rows = await Promise.all(
    organization.schools.map(async (school) => {
      const schoolId = school.id;
      const finance = school.optionalModules.includes("FINANCE");
      const [students, teachers, staff, marks, collected, , staffLeave, studentLeave] = await Promise.all([
        prisma.student.count({ where: { schoolId, status: "ACTIVE" } }),
        prisma.teacher.count({ where: { schoolId, status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
        prisma.staffMember.count({ where: { schoolId, status: { in: ["ACTIVE", "ON_LEAVE"] } } }),
        prisma.studentAttendance.groupBy({ by: ["status"], where: { schoolId, date }, _count: { _all: true } }),
        finance ? campusFinance(user, school) : null,
        null,
        prisma.leaveRequest.count({ where: { schoolId, status: "PENDING" } }),
        prisma.studentLeave.count({ where: { schoolId, status: { in: ["PENDING", "TEACHER_APPROVED"] } } }).catch(() => 0),
      ]);
      const total = marks.reduce((sum, row) => sum + row._count._all, 0);
      const present = marks.filter((row) => row.status === "PRESENT" || row.status === "LATE" || row.status === "HALF_DAY").reduce((sum, row) => sum + row._count._all, 0);
      const collectedMinor = collected?.collectedSessionMinor ?? 0;
      return {
        id: schoolId,
        name: school.name,
        city: school.city,
        status: school.status,
        students,
        teachers,
        staff,
        attendance: total ? present / total : null,
        finance,
        collectedMinor,
        pendingMinor: collected?.pendingMinor ?? 0,
        pendingLeave: staffLeave + studentLeave,
      };
    }),
  );
  const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    organization: { id: organization.id, name: organization.name },
    campuses: rows,
    totals: { campuses: rows.length, students: sum((row) => row.students), teachers: sum((row) => row.teachers), staff: sum((row) => row.staff), collectedMinor: sum((row) => row.collectedMinor), pendingMinor: sum((row) => row.pendingMinor), pendingLeave: sum((row) => row.pendingLeave) },
  };
}

/**
 * One campus's fee figures for the current session, by the same rules as its
 * own dashboard — computed inside that campus (its own tenant scope), for the
 * Owner who runs it.
 */
async function campusFinance(user: SessionUser, school: { id: string; name: string }) {
  const session = await prisma.academicSession.findFirst({ where: { schoolId: school.id, isCurrent: true }, select: { id: true } });
  if (!session) return null;
  const ctx: TenantContext = { user: { ...user, schoolId: school.id, schoolName: school.name }, schoolId: school.id, schoolSlug: "", schoolName: school.name, db: forSchool(school.id) };
  const snapshot = await financeSnapshot(ctx, session.id);
  return { collectedSessionMinor: snapshot.collectedSessionMinor, pendingMinor: snapshot.pendingMinor };
}

/** Super Admin: set (or clear) one organization's campus limit. */
export async function setCampusLimitOverride(actor: SessionUser, organizationId: string, limit: number | null): Promise<void> {
  assertRole(actor, "SUPER_ADMIN");
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, campusLimitOverride: true, schools: { take: 1, orderBy: { createdAt: "asc" }, select: { id: true } } } });
  if (!organization) throw new NotFoundError();
  await prisma.organization.update({ where: { id: organizationId }, data: { campusLimitOverride: limit } });
  await recordAudit({
    action: "ORGANIZATION_CAMPUS_LIMIT_CHANGED",
    entityType: "Organization",
    entityId: organizationId,
    schoolId: organization.schools[0]?.id ?? null,
    actorId: actor.id,
    summary: `Campus limit for ${organization.name}: ${limit === null ? "follows the plan" : limit}.`,
    metadata: { previous: organization.campusLimitOverride, next: limit },
  });
}
