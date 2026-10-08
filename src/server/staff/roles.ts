import "server-only";

import type { StaffRole } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { type BaseStaffRole, PREVIOUS_ROLE_DEFAULT_GRANTS, STAFF_ROLE_DEFAULT_GRANTS, STAFF_ROLE_NAMES, allowedGrants, cleanGrants, grantDef } from "@/lib/staff-access";
import { CURRENT_EMPLOYEE } from "@/lib/validation/lifecycle";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { upgradeUntouchedGrants } from "@/server/auth/staff-access";
import { isUniqueViolation } from "@/server/db/errors";

/**
 * Non-teaching roles at a school. Every school has one built-in profile per
 * designation (Librarian, Driver, …), created the first time they are needed
 * with sensible default grants, and may add its own ("Hostel warden" on the
 * Other designation). A role's grants are what a new staff member in it
 * starts with; the admin can push a change to everyone already in the role.
 * A staff member's own grants are always the ones that count.
 */

const BASE_ROLES = Object.keys(STAFF_ROLE_NAMES) as BaseStaffRole[];

function sameGrants(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((grant) => b.includes(grant));
}

/** Create any missing built-in profiles and link staff who have none. Cheap when nothing is missing. */
export async function ensureRoleProfiles(ctx: TenantContext): Promise<void> {
  const existing = await ctx.db.staffRoleProfile.findMany({ where: { isCustom: false }, select: { baseRole: true } });
  const have = new Set(existing.map((row) => row.baseRole));
  const missing = BASE_ROLES.filter((role) => !have.has(role));
  if (missing.length) {
    await ctx.db.staffRoleProfile.createMany({
      data: missing.map((role) => ({ schoolId: ctx.schoolId, name: STAFF_ROLE_NAMES[role], baseRole: role, defaultGrants: STAFF_ROLE_DEFAULT_GRANTS[role] })),
      skipDuplicates: true,
    });
  }
  // Built-in profiles still on an older shipped default (never edited by the
  // admin) move to the current default.
  const builtInProfiles = await ctx.db.staffRoleProfile.findMany({ where: { isCustom: false }, select: { id: true, baseRole: true, defaultGrants: true } });
  for (const profile of builtInProfiles) {
    const role = profile.baseRole as BaseStaffRole;
    const older = PREVIOUS_ROLE_DEFAULT_GRANTS[role] ?? [];
    if (older.some((grants) => sameGrants(grants, profile.defaultGrants))) {
      await ctx.db.staffRoleProfile.updateMany({ where: { id: profile.id }, data: { defaultGrants: STAFF_ROLE_DEFAULT_GRANTS[role] } });
    }
  }
  // Staff never customised by the admin follow their role's updated defaults (audited, one by one).
  const untouched = await ctx.db.staffMember.findMany({
    where: { status: { in: [...CURRENT_EMPLOYEE] }, role: { in: Object.keys(PREVIOUS_ROLE_DEFAULT_GRANTS) as StaffRole[] } },
    select: { id: true, role: true, grants: true, grantsCustomized: true, firstName: true, lastName: true, roleProfile: { select: { isCustom: true } } },
  });
  for (const staff of untouched) await upgradeUntouchedGrants(ctx, staff);
  if (await ctx.db.staffMember.count({ where: { roleProfileId: null } })) {
    const builtIns = await ctx.db.staffRoleProfile.findMany({ where: { isCustom: false }, select: { id: true, baseRole: true } });
    for (const profile of builtIns) {
      await ctx.db.staffMember.updateMany({ where: { roleProfileId: null, role: profile.baseRole }, data: { roleProfileId: profile.id } });
    }
  }
}

/** Every role with how many current staff are in it, built-ins first in the usual order. */
export async function listRoleProfiles(ctx: TenantContext, options: { includeArchived?: boolean } = {}) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await ensureRoleProfiles(ctx);
  const [profiles, counts] = await Promise.all([
    ctx.db.staffRoleProfile.findMany({
      where: options.includeArchived ? {} : { archivedAt: null },
      select: { id: true, name: true, baseRole: true, isCustom: true, description: true, defaultGrants: true, archivedAt: true },
    }),
    ctx.db.staffMember.groupBy({ by: ["roleProfileId"], where: { status: { in: [...CURRENT_EMPLOYEE] } }, _count: true }),
  ]);
  const order = (row: { baseRole: StaffRole; isCustom: boolean; name: string }) => (row.isCustom ? 100 : BASE_ROLES.indexOf(row.baseRole));
  return profiles
    .map((profile) => ({ ...profile, defaultGrants: cleanGrants(profile.defaultGrants), staffCount: counts.find((row) => row.roleProfileId === profile.id)?._count ?? 0 }))
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

/** One role, its staff (current and former) and its default grants. */
export async function getRoleProfile(ctx: TenantContext, roleId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await ensureRoleProfiles(ctx);
  const profile = await ctx.db.staffRoleProfile.findFirst({
    where: { id: roleId },
    select: {
      id: true,
      name: true,
      baseRole: true,
      isCustom: true,
      description: true,
      defaultGrants: true,
      archivedAt: true,
      staff: {
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        select: { id: true, firstName: true, lastName: true, employeeId: true, status: true, phone: true, grants: true, userId: true, department: true },
      },
    },
  });
  if (!profile) throw new NotFoundError("That role was not found.");
  return { ...profile, defaultGrants: cleanGrants(profile.defaultGrants) };
}

/** The profile a staff member should be in: the one asked for, or the built-in for their designation. */
export async function resolveRoleProfile(ctx: TenantContext, input: { roleProfileId?: string | null; role?: StaffRole | null }) {
  await ensureRoleProfiles(ctx);
  const profile = input.roleProfileId
    ? await ctx.db.staffRoleProfile.findFirst({ where: { id: input.roleProfileId, archivedAt: null }, select: { id: true, baseRole: true, defaultGrants: true, name: true } })
    : input.role
      ? await ctx.db.staffRoleProfile.findFirst({ where: { isCustom: false, baseRole: input.role }, select: { id: true, baseRole: true, defaultGrants: true, name: true } })
      : null;
  if (!profile) throw new ValidationError("Please correct the highlighted fields.", { roleProfileId: ["Choose a role from the list"] });
  return profile;
}

function badGrants(baseRole: string, grants: readonly string[]): string[] {
  const allowed = new Set<string>(allowedGrants(baseRole, grants));
  return grants.filter((grant) => !allowed.has(grant));
}

export type RoleProfileInput = { roleId?: string | null; name: string; baseRole: StaffRole; description: string | null; defaultGrants: string[]; applyToStaff?: boolean };

/**
 * Add a custom role or change a role's description and default grants. A
 * built-in role keeps its name and designation. With `applyToStaff`, everyone
 * currently in the role gets exactly the new defaults (recorded per person).
 */
export async function saveRoleProfile(ctx: TenantContext, input: RoleProfileInput): Promise<{ id: string; updatedStaff: number }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await ensureRoleProfiles(ctx);
  const grants = cleanGrants(input.defaultGrants);
  const existing = input.roleId ? await ctx.db.staffRoleProfile.findFirst({ where: { id: input.roleId }, select: { id: true, isCustom: true, baseRole: true, name: true } }) : null;
  if (input.roleId && !existing) throw new NotFoundError("That role was not found.");
  const baseRole = existing && !existing.isCustom ? existing.baseRole : input.baseRole;
  const refused = badGrants(baseRole, grants);
  if (refused.length) {
    throw new ValidationError("Please correct the highlighted fields.", {
      defaultGrants: [`A ${STAFF_ROLE_NAMES[baseRole as BaseStaffRole].toLowerCase()} can never have: ${refused.map((key) => grantDef(key)?.label ?? key).join(", ")}.`],
    });
  }
  if (!existing && (Object.values(STAFF_ROLE_NAMES) as string[]).some((name) => name.toLowerCase() === input.name.trim().toLowerCase())) {
    throw new ConflictError(`"${input.name}" is already a built-in role.`);
  }

  try {
    let id: string;
    if (existing) {
      await ctx.db.staffRoleProfile.updateMany({
        where: { id: existing.id },
        data: { ...(existing.isCustom ? { name: input.name.trim(), baseRole } : {}), description: input.description, defaultGrants: grants },
      });
      id = existing.id;
    } else {
      id = (await ctx.db.staffRoleProfile.create({ data: { schoolId: ctx.schoolId, name: input.name.trim(), baseRole, isCustom: true, description: input.description, defaultGrants: grants }, select: { id: true } })).id;
    }

    let updatedStaff = 0;
    if (existing && input.applyToStaff) {
      // Custom roles may have moved designation: each person keeps only what theirs allows.
      const staff = await ctx.db.staffMember.findMany({ where: { roleProfileId: id }, select: { id: true, role: true, firstName: true, lastName: true } });
      for (const person of staff) {
        await ctx.db.staffMember.updateMany({ where: { id: person.id }, data: { grants: allowedGrants(existing.isCustom ? baseRole : person.role, grants), grantsCustomized: false, ...(existing.isCustom ? { role: baseRole } : {}) } });
      }
      updatedStaff = staff.length;
    }
    await recordAudit({
      action: "STAFF_PERMISSIONS_CHANGED",
      entityType: "StaffRoleProfile",
      entityId: id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Role ${input.name.trim()} ${existing ? "updated" : "added"}: new staff start with ${grants.length ? grants.map((key) => grantDef(key)?.label ?? key).join(", ") : "nothing beyond the common staff pages"}${updatedStaff ? `; applied to ${updatedStaff} staff` : ""}.`,
    });
    return { id, updatedStaff };
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`A role called "${input.name}" already exists.`);
    throw error;
  }
}

/** Archive a custom role nobody current is in; restore it later if needed. Built-in roles stay. */
export async function setRoleArchived(ctx: TenantContext, roleId: string, archived: boolean): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const role = await ctx.db.staffRoleProfile.findFirst({ where: { id: roleId }, select: { id: true, isCustom: true, name: true, staff: { where: { status: { in: [...CURRENT_EMPLOYEE] } }, select: { id: true } } } });
  if (!role) throw new NotFoundError("That role was not found.");
  if (!role.isCustom) throw new ConflictError("Built-in roles cannot be archived.");
  if (archived && role.staff.length) throw new ConflictError(`${role.staff.length} current staff are in ${role.name}. Move them to another role first.`);
  await ctx.db.staffRoleProfile.updateMany({ where: { id: role.id }, data: { archivedAt: archived ? new Date() : null } });
}
