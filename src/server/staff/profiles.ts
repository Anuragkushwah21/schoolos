import "server-only";

import type { DocumentVerification, StaffDocumentType } from "@/generated/prisma/enums";
import { today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fullName } from "@/lib/format";
import { type BaseStaffRole, STAFF_ROLE_NAMES, allowedGrants, cleanGrants, grantDef, permissionSummary } from "@/lib/staff-access";
import type { StaffProfileInput } from "@/lib/validation/staff-profile";
import { assertRoleAvailable, assertWithinLimit } from "@/server/platform/entitlements";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import { provisionAccount, sendActivation } from "@/server/auth/account-links";
import type { TenantContext } from "@/server/auth/current-user";
import { isUniqueViolation } from "@/server/db/errors";
import { prisma } from "@/server/db/prisma";
import { auditGrants } from "@/server/operations/staff";
import { setPhoto } from "@/server/people/photos";
import { resolveRoleProfile } from "@/server/staff/roles";
import { type ValidatedRecordFile, deleteStoredFile, readStoredFile, storeRecordFile, validateRecordFile } from "@/server/storage/files";

/**
 * Staff profiles: the creation wizard, role and permission changes, documents
 * and each person's audit trail — on the existing `StaffMember`, role
 * profiles and grants. School Admin only, always inside their own school (the
 * tenant client scopes every read and write).
 *
 * Permissions are for staff only. The School Admin never needs any: they hold
 * every operation of their school by role, and work done by them is recorded
 * as theirs.
 */

export const DOCUMENT_TYPE_LABEL: Record<StaffDocumentType, string> = {
  AADHAAR: "Aadhaar",
  PAN: "PAN",
  QUALIFICATION: "Qualification certificate",
  EXPERIENCE: "Experience certificate",
  PREVIOUS_EMPLOYMENT: "Previous employment certificate",
  APPOINTMENT_LETTER: "Appointment letter",
  JOINING: "Joining document",
  OTHER: "Other document",
};

export type StaffDocumentUpload = { type: StaffDocumentType; label: string | null; file: File };

// -----------------------------------------------------------------------------
// Create — the wizard's last step
// -----------------------------------------------------------------------------

/** STF-0001, STF-0002…: the next free employee ID when the admin leaves it blank. */
async function nextEmployeeId(ctx: TenantContext): Promise<string> {
  const count = await ctx.db.staffMember.count();
  for (let n = count + 1; ; n += 1) {
    const candidate = `STF-${String(n).padStart(4, "0")}`;
    if (!(await ctx.db.staffMember.findFirst({ where: { employeeId: candidate }, select: { id: true } }))) return candidate;
  }
}

/**
 * Create a staff member from the wizard: profile, role and permissions, an
 * optional login (pending activation), salary and documents — all in one
 * transaction. Files are checked before anything is written and stored before
 * the transaction; if it fails they are removed again, so nothing is left half
 * made. The activation email and the photo follow once it has committed.
 */
export async function createStaffProfile(
  ctx: TenantContext,
  input: StaffProfileInput,
  files: { photo?: File | null; documents?: StaffDocumentUpload[] } = {},
): Promise<{ staffId: string; invite: { email: string; delivered: boolean; error?: string } | null }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const profile = await resolveRoleProfile(ctx, { roleProfileId: input.roleProfileId });
  const role = profile.baseRole;
  // The plan decides which designations this campus may have, and how many.
  await assertRoleAvailable(ctx, role);
  await assertWithinLimit(ctx, role);
  await assertWithinLimit(ctx, "STAFF");

  // Exactly the permissions ticked; refused, not dropped, when the designation can never hold one.
  const asked = cleanGrants(input.grants ?? profile.defaultGrants);
  const grants = allowedGrants(role, asked);
  const refused = asked.filter((key) => !grants.includes(key));
  if (refused.length) {
    throw new ValidationError("Please correct the highlighted fields.", {
      grants: [`A ${STAFF_ROLE_NAMES[role as BaseStaffRole].toLowerCase()} can never have: ${refused.map((key) => grantDef(key)?.label ?? key).join(", ")}.`],
    });
  }
  if (input.createLogin && !input.email) throw new ValidationError("Please correct the highlighted fields.", { email: ["Enter an email to create their login."] });
  if (input.employeeId && (await ctx.db.staffMember.findFirst({ where: { employeeId: input.employeeId }, select: { id: true } }))) {
    throw new ValidationError("Please correct the highlighted fields.", { employeeId: ["That employee ID is already in use."] });
  }

  // Every file checked first: one bad file refuses the lot, before anything is stored.
  const documents: Array<{ type: StaffDocumentType; label: string | null; file: ValidatedRecordFile }> = [];
  for (const [index, doc] of (files.documents ?? []).entries()) {
    try {
      documents.push({ type: doc.type, label: doc.label, file: await validateRecordFile(doc.file) });
    } catch (error) {
      throw new ValidationError("Please correct the highlighted fields.", { [`doc.${index}.file`]: [error instanceof AppError ? error.message : "That file could not be read."] });
    }
  }
  const stored: string[] = [];
  try {
    for (const doc of documents) stored.push(await storeRecordFile(ctx.schoolId, "staff-documents", doc.file));
  } catch (error) {
    await Promise.all(stored.map(deleteStoredFile));
    throw error;
  }

  const [firstName, ...rest] = input.fullName.trim().split(/\s+/);
  const lastName = rest.join(" ") || "-";
  let created: { staffId: string; userId: string | null };
  try {
    const employeeId = input.employeeId ?? (await nextEmployeeId(ctx));
    created = await ctx.db.$transaction(async (tx) => {
      const userId = input.createLogin
        ? await provisionAccount(tx, { schoolId: ctx.schoolId, email: input.email!, role: "NON_TEACHING_STAFF", firstName: firstName!, lastName, phone: input.phone })
        : null;
      const staff = await tx.staffMember.create({
        data: {
          schoolId: ctx.schoolId,
          employeeId,
          firstName: firstName!,
          lastName,
          role,
          roleProfileId: profile.id,
          grants,
          // Ticked differently from the role's defaults: the admin's own choice.
          grantsCustomized: grants.length !== allowedGrants(role, profile.defaultGrants).length || grants.some((key) => !allowedGrants(role, profile.defaultGrants).includes(key)),
          designation: input.designation,
          department: input.department,
          phone: input.phone,
          email: input.email,
          joiningDate: input.joiningDate,
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          addressLine: input.addressLine,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          experienceYears: input.experienceYears,
          employmentType: input.employmentType,
          emergencyContactName: input.emergencyContactName,
          emergencyContactPhone: input.emergencyContactPhone,
          notes: input.notes,
          status: "ACTIVE",
          userId,
        },
        select: { id: true },
      });
      if (input.salaryMinor) {
        await tx.teacherSalary.create({
          data: { schoolId: ctx.schoolId, staffMemberId: staff.id, salaryType: "MONTHLY", amountMinor: input.salaryMinor, effectiveFrom: input.joiningDate ?? today(), recordedById: ctx.user.id },
        });
      }
      for (const [index, doc] of documents.entries()) {
        await tx.staffDocument.create({
          data: { schoolId: ctx.schoolId, staffMemberId: staff.id, type: doc.type, label: doc.label, fileName: doc.file.fileName, mimeType: doc.file.mimeType, size: doc.file.size, storageKey: stored[index]!, uploadedById: ctx.user.id },
        });
      }
      return { staffId: staff.id, userId };
    });
  } catch (error) {
    await Promise.all(stored.map(deleteStoredFile));
    if (isUniqueViolation(error)) throw new ConflictError("That employee ID or email is already in use.");
    throw error;
  }

  const name = `${firstName} ${lastName}`;
  await recordAudit({
    action: "STAFF_CREATED",
    entityType: "StaffMember",
    entityId: created.staffId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${name} added as ${profile.name}${input.createLogin ? `, with a login for ${input.email} (pending activation)` : ""}.`,
    metadata: { role: profile.name, documents: documents.length, salary: Boolean(input.salaryMinor) },
  });
  const summary = permissionSummary(role, profile.defaultGrants, grants);
  await auditGrants(ctx, created.staffId, name, grants, []);
  if (summary.removed.length) {
    await recordAudit({
      action: "STAFF_PERMISSION_REMOVED",
      entityType: "StaffMember",
      entityId: created.staffId,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `${name} starts without these ${profile.name} defaults: ${summary.removed.map((key) => grantDef(key)?.label ?? key).join(", ")}.`,
      metadata: { removed: summary.removed },
    });
  }
  for (const doc of documents) {
    await recordAudit({
      action: "STAFF_DOCUMENT_UPLOADED",
      entityType: "StaffMember",
      entityId: created.staffId,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `${DOCUMENT_TYPE_LABEL[doc.type]} uploaded for ${name}.`,
    });
  }
  if (input.salaryMinor) {
    await recordAudit({ action: "STAFF_SALARY_SET", entityType: "StaffMember", entityId: created.staffId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Salary recorded for ${name}.` });
  }
  // After the commit: a photo that fails to save never undoes the profile.
  if (files.photo && files.photo.size > 0) {
    await setPhoto(ctx, { type: "STAFF", id: created.staffId }, files.photo).catch((error) => console.error("[staff] photo not saved", error));
  }
  const invite = created.userId ? await sendActivation(created.userId, ctx.user.id) : null;
  return { staffId: created.staffId, invite };
}

// -----------------------------------------------------------------------------
// Role and permissions
// -----------------------------------------------------------------------------

async function loadStaff(ctx: TenantContext, staffId: string) {
  const staff = await ctx.db.staffMember.findFirst({
    where: { id: staffId },
    select: { id: true, firstName: true, lastName: true, role: true, grants: true, roleProfileId: true, roleProfile: { select: { id: true, name: true, defaultGrants: true } } },
  });
  if (!staff) throw new NotFoundError("That staff member was not found.");
  const profile = staff.roleProfile ?? (await resolveRoleProfile(ctx, { role: staff.role }));
  return { ...staff, profile };
}

/** Defaults, custom added, custom removed and effective permissions of one staff member. */
export async function staffPermissionSummary(ctx: TenantContext, staffId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const staff = await loadStaff(ctx, staffId);
  return { roleName: staff.profile.name, ...permissionSummary(staff.role, staff.profile.defaultGrants, staff.grants) };
}

/**
 * Change someone's role. With `keepCustom`, the admin's own changes carry
 * over: the new role's defaults, plus what was added, minus what was taken
 * away. Without it they start from the new role's defaults. Anything the new
 * designation can never hold is dropped and named in the audit entry.
 */
export async function changeStaffRole(ctx: TenantContext, input: { staffId: string; roleProfileId: string; keepCustom: boolean }) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const staff = await loadStaff(ctx, input.staffId);
  const next = await resolveRoleProfile(ctx, { roleProfileId: input.roleProfileId });
  if (next.id === staff.profile.id) throw new ConflictError(`${fullName(staff)} is already ${next.name}.`);
  const before = permissionSummary(staff.role, staff.profile.defaultGrants, staff.grants);
  const wanted = input.keepCustom ? [...next.defaultGrants.filter((key) => !(before.removed as string[]).includes(key)), ...before.added] : [...next.defaultGrants];
  const grants = allowedGrants(next.baseRole, wanted);
  const dropped = cleanGrants(wanted).filter((key) => !grants.includes(key));
  const custom = permissionSummary(next.baseRole, next.defaultGrants, grants);
  await ctx.db.staffMember.updateMany({
    where: { id: staff.id },
    data: { role: next.baseRole, roleProfileId: next.id, grants, grantsCustomized: custom.added.length + custom.removed.length > 0 },
  });
  await recordAudit({
    action: "STAFF_ROLE_CHANGED",
    entityType: "StaffMember",
    entityId: staff.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${fullName(staff)}: role ${staff.profile.name} → ${next.name}${input.keepCustom ? ", custom permissions kept" : ", permissions reset to the role's defaults"}${dropped.length ? `; dropped (not allowed for ${next.name}): ${dropped.map((key) => grantDef(key)?.label ?? key).join(", ")}` : ""}.`,
    metadata: { oldRole: staff.profile.name, newRole: next.name, keepCustom: input.keepCustom, before: staff.grants, after: grants },
  });
  await auditGrants(ctx, staff.id, fullName(staff), grants, staff.grants);
  return permissionSummary(next.baseRole, next.defaultGrants, grants);
}

/** Back to exactly the role's default permissions — the admin's custom changes are undone. */
export async function restoreRoleDefaults(ctx: TenantContext, staffId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const staff = await loadStaff(ctx, staffId);
  const grants = allowedGrants(staff.role, staff.profile.defaultGrants);
  // Back on the role's defaults: follows the role again.
  await ctx.db.staffMember.updateMany({ where: { id: staff.id }, data: { grants, grantsCustomized: false } });
  await recordAudit({
    action: "STAFF_PERMISSIONS_RESET",
    entityType: "StaffMember",
    entityId: staff.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${fullName(staff)}'s permissions restored to the ${staff.profile.name} defaults.`,
    metadata: { before: staff.grants, after: grants },
  });
  await auditGrants(ctx, staff.id, fullName(staff), grants, staff.grants);
  return permissionSummary(staff.role, staff.profile.defaultGrants, grants);
}

// -----------------------------------------------------------------------------
// Documents
// -----------------------------------------------------------------------------

/** A staff member's documents, current first; archived ones only when asked. */
export async function listStaffDocuments(ctx: TenantContext, staffId: string, options: { archived?: boolean } = {}) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.staffDocument.findMany({
    where: { staffMemberId: staffId, ...(options.archived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    select: { id: true, type: true, label: true, fileName: true, mimeType: true, size: true, verification: true, notes: true, createdAt: true, archivedAt: true, uploadedById: true },
  });
}

export async function addStaffDocument(ctx: TenantContext, input: { staffId: string; type: StaffDocumentType; label: string | null; notes: string | null; file: File }): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const staff = await ctx.db.staffMember.findFirst({ where: { id: input.staffId }, select: { id: true, firstName: true, lastName: true } });
  if (!staff) throw new NotFoundError("That staff member was not found.");
  const file = await validateRecordFile(input.file);
  const key = await storeRecordFile(ctx.schoolId, "staff-documents", file);
  try {
    const row = await ctx.db.staffDocument.create({
      data: { schoolId: ctx.schoolId, staffMemberId: staff.id, type: input.type, label: input.label, notes: input.notes, fileName: file.fileName, mimeType: file.mimeType, size: file.size, storageKey: key, uploadedById: ctx.user.id },
      select: { id: true },
    });
    await recordAudit({
      action: "STAFF_DOCUMENT_UPLOADED",
      entityType: "StaffMember",
      entityId: staff.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `${DOCUMENT_TYPE_LABEL[input.type]}${input.label ? ` (${input.label})` : ""} uploaded for ${fullName(staff)}.`,
      metadata: { documentId: row.id },
    });
    return row.id;
  } catch (error) {
    await deleteStoredFile(key);
    throw error;
  }
}

async function loadDocument(ctx: TenantContext, documentId: string) {
  const doc = await ctx.db.staffDocument.findFirst({
    where: { id: documentId },
    select: { id: true, type: true, label: true, verification: true, archivedAt: true, staffMember: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!doc) throw new NotFoundError("That document was not found.");
  return doc;
}

export async function setDocumentVerification(ctx: TenantContext, input: { documentId: string; verification: DocumentVerification; notes: string | null }): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const doc = await loadDocument(ctx, input.documentId);
  await ctx.db.staffDocument.updateMany({ where: { id: doc.id }, data: { verification: input.verification, ...(input.notes !== null ? { notes: input.notes } : {}) } });
  await recordAudit({
    action: "STAFF_DOCUMENT_VERIFIED",
    entityType: "StaffMember",
    entityId: doc.staffMember.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${DOCUMENT_TYPE_LABEL[doc.type]} of ${fullName(doc.staffMember)}: ${doc.verification.toLowerCase()} → ${input.verification.toLowerCase()}.`,
  });
}

/** Take a document off the record. The row and its file stay, for the history. */
export async function archiveStaffDocument(ctx: TenantContext, documentId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const doc = await loadDocument(ctx, documentId);
  if (doc.archivedAt) return;
  await ctx.db.staffDocument.updateMany({ where: { id: doc.id }, data: { archivedAt: new Date(), archivedById: ctx.user.id } });
  await recordAudit({
    action: "STAFF_DOCUMENT_ARCHIVED",
    entityType: "StaffMember",
    entityId: doc.staffMember.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${DOCUMENT_TYPE_LABEL[doc.type]}${doc.label ? ` (${doc.label})` : ""} removed from ${fullName(doc.staffMember)}'s record.`,
  });
}

/** The file itself — School Admin of the same school only; another school's id is not found. */
export async function readStaffDocument(ctx: TenantContext, documentId: string): Promise<{ bytes: Buffer; fileName: string; mimeType: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const doc = await ctx.db.staffDocument.findFirst({ where: { id: documentId }, select: { storageKey: true, fileName: true, mimeType: true } });
  if (!doc) throw new NotFoundError("That document was not found.");
  try {
    return { bytes: await readStoredFile(doc.storageKey), fileName: doc.fileName, mimeType: doc.mimeType };
  } catch {
    throw new NotFoundError("That file is no longer available.");
  }
}

// -----------------------------------------------------------------------------
// Audit trail of one staff member
// -----------------------------------------------------------------------------

/**
 * What happened to this person's record (created, edited, role, permissions,
 * documents, status, login) and what they did themselves with their login —
 * newest first. Their own school's entries only.
 */
export async function staffAuditLog(ctx: TenantContext, staffId: string, options: { take?: number; by?: "ALL" | "ABOUT" | "BY" } = {}) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const staff = await ctx.db.staffMember.findFirst({ where: { id: staffId }, select: { id: true, userId: true } });
  if (!staff) throw new NotFoundError("That staff member was not found.");
  const about = [{ entityType: "StaffMember", entityId: staff.id }, ...(staff.userId ? [{ entityType: "User", entityId: staff.userId }] : [])];
  const by = staff.userId ? [{ actorId: staff.userId }] : [];
  const or = options.by === "ABOUT" ? about : options.by === "BY" ? by : [...about, ...by];
  if (!or.length) return [];
  // AuditLog is platform-wide, so the session's school is a hard filter here.
  return prisma.auditLog.findMany({
    where: { schoolId: ctx.schoolId, OR: or },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 100,
    select: { id: true, action: true, module: true, actorRole: true, summary: true, metadata: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
  });
}
