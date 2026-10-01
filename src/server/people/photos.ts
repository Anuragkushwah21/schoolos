import "server-only";

import type { PhotoOwner } from "@/generated/prisma/enums";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/current-user";
import { staffPermissions } from "@/server/auth/staff-access";
import type { SessionUser } from "@/server/auth/session";
import { canAccessSection } from "@/server/auth/teacher-access";
import { forSchool } from "@/server/tenancy/scope";
import { deleteStoredFile, readStoredFile, storeImage, validateImage } from "@/server/storage/files";

/**
 * Profile photos for students, teachers, staff, parents and School Admins.
 *
 * Stored in the school's private upload folder, never under `public/`, and
 * only ever served by `/api/v1/photos/{id}` after `canViewPhoto`. Only the
 * person themselves changes their photo, from their own profile; the School
 * Admin sees everyone's but changes only their own.
 */

export type PhotoTarget = { type: PhotoOwner; id: string };

/** The signed-in person's own record, as a photo owner. */
export async function selfTarget(ctx: TenantContext): Promise<PhotoTarget> {
  const by = { userId: ctx.user.id };
  switch (ctx.user.role) {
    case "TEACHER": {
      const row = await ctx.db.teacher.findFirst({ where: by, select: { id: true } });
      if (row) return { type: "TEACHER", id: row.id };
      break;
    }
    case "STUDENT": {
      const row = await ctx.db.student.findFirst({ where: by, select: { id: true } });
      if (row) return { type: "STUDENT", id: row.id };
      break;
    }
    case "PARENT": {
      const row = await ctx.db.parent.findFirst({ where: by, select: { id: true } });
      if (row) return { type: "PARENT", id: row.id };
      break;
    }
    case "NON_TEACHING_STAFF": {
      const row = await ctx.db.staffMember.findFirst({ where: by, select: { id: true } });
      if (row) return { type: "STAFF", id: row.id };
      break;
    }
    default:
      return { type: "USER", id: ctx.user.id };
  }
  throw new NotFoundError("Your profile is not set up yet.");
}

/** A photo is changed only by its owner — the School Admin sees everyone's but changes only their own. */
async function assertMayChange(ctx: TenantContext, target: PhotoTarget): Promise<void> {
  const own = await selfTarget(ctx);
  if (own.type !== target.type || own.id !== target.id) throw new ForbiddenError("You can change only your own photo.");
}

function servedUrl(photoId: string, version: Date): string {
  return `/api/v1/photos/${photoId}?v=${version.getTime()}`;
}

/** Keep the record's own `photoUrl` in step, for the screens that read it. */
async function syncPhotoUrl(ctx: TenantContext, target: PhotoTarget, url: string | null): Promise<void> {
  if (target.type === "STUDENT") await ctx.db.student.updateMany({ where: { id: target.id }, data: { photoUrl: url } });
  if (target.type === "TEACHER") await ctx.db.teacher.updateMany({ where: { id: target.id }, data: { photoUrl: url } });
}

export async function setPhoto(ctx: TenantContext, target: PhotoTarget, file: File): Promise<string> {
  await assertMayChange(ctx, target);
  const image = await validateImage(file);
  const key = await storeImage(ctx.schoolId, image);
  const existing = await ctx.db.profilePhoto.findFirst({ where: { ownerType: target.type, ownerId: target.id }, select: { storageKey: true } });
  const photo = await ctx.db.profilePhoto.upsert({
    where: { schoolId_ownerType_ownerId: { schoolId: ctx.schoolId, ownerType: target.type, ownerId: target.id } },
    create: { schoolId: ctx.schoolId, ownerType: target.type, ownerId: target.id, storageKey: key, mimeType: image.mimeType, sizeBytes: image.size, uploadedById: ctx.user.id },
    update: { storageKey: key, mimeType: image.mimeType, sizeBytes: image.size, uploadedById: ctx.user.id },
    select: { id: true, updatedAt: true },
  });
  if (existing) await deleteStoredFile(existing.storageKey);
  const url = servedUrl(photo.id, photo.updatedAt);
  await syncPhotoUrl(ctx, target, url);
  await recordAudit({ action: "PROFILE_PHOTO_CHANGED", entityType: target.type, entityId: target.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: "Profile photo updated." });
  return url;
}

export async function removePhoto(ctx: TenantContext, target: PhotoTarget): Promise<void> {
  await assertMayChange(ctx, target);
  const existing = await ctx.db.profilePhoto.findFirst({ where: { ownerType: target.type, ownerId: target.id }, select: { id: true, storageKey: true } });
  if (!existing) return;
  await ctx.db.profilePhoto.deleteMany({ where: { id: existing.id } });
  await deleteStoredFile(existing.storageKey);
  await syncPhotoUrl(ctx, target, null);
  await recordAudit({ action: "PROFILE_PHOTO_CHANGED", entityType: target.type, entityId: target.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: "Profile photo removed." });
}

/**
 * Photo URLs for a list of people of one kind — one query for a whole table.
 * Missing ids have no photo (the list shows initials). The URL is only a
 * pointer: each image is still checked by `readPhoto` when fetched.
 */
export async function photoUrlsFor(ctx: TenantContext, type: PhotoOwner, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await ctx.db.profilePhoto.findMany({ where: { ownerType: type, ownerId: { in: ids } }, select: { id: true, ownerId: true, updatedAt: true } });
  return new Map(rows.map((row) => [row.ownerId, servedUrl(row.id, row.updatedAt)]));
}

/** The photo's URL for a person, or null — for pages that show one. */
export async function photoUrlFor(ctx: TenantContext, target: PhotoTarget): Promise<string | null> {
  const photo = await ctx.db.profilePhoto.findFirst({ where: { ownerType: target.type, ownerId: target.id }, select: { id: true, updatedAt: true } });
  return photo ? servedUrl(photo.id, photo.updatedAt) : null;
}

/**
 * Who may see a photo (always within one school — another school's photo is
 * simply not found):
 *   * the School Admin — anyone in the school; the person themselves;
 *   * a teacher's or staff member's photo — colleagues (teachers and staff);
 *     a parent or student only for a teacher who teaches, or is class
 *     teacher of, their child / them this year;
 *   * a student's — their teachers, their parents, and staff who work with
 *     the student list or the library;
 *   * a parent's or admin's — only the admin and the person.
 */
async function canViewPhoto(ctx: TenantContext, owner: PhotoTarget): Promise<boolean> {
  if (ctx.user.role === "SCHOOL_ADMIN") return true;
  const own = await selfTarget(ctx).catch(() => null);
  if (own && own.type === owner.type && own.id === owner.id) return true;
  if (owner.type === "TEACHER" || owner.type === "STAFF") {
    if (ctx.user.role === "TEACHER" || ctx.user.role === "NON_TEACHING_STAFF") return true;
    if (owner.type === "STAFF") return false;
    return teachesViewerOrChild(ctx, owner.id);
  }
  if (owner.type !== "STUDENT") return false;

  if (ctx.user.role === "PARENT") {
    return (await ctx.db.parentStudent.count({ where: { studentId: owner.id, parent: { userId: ctx.user.id } } })) > 0;
  }
  if (ctx.user.role === "TEACHER") {
    const placement = await ctx.db.studentEnrollment.findFirst({ where: { studentId: owner.id, academicSession: { isCurrent: true } }, select: { sectionId: true } });
    return placement ? canAccessSection(ctx, placement.sectionId) : false;
  }
  if (ctx.user.role === "NON_TEACHING_STAFF") {
    const held = await staffPermissions(ctx);
    return held.includes("VIEW_STUDENTS") || held.includes("MANAGE_LIBRARY");
  }
  return false;
}

/** Whether this teacher teaches (or is class teacher of) the signed-in student, or one of the signed-in parent's children. */
async function teachesViewerOrChild(ctx: TenantContext, teacherId: string): Promise<boolean> {
  const students =
    ctx.user.role === "STUDENT"
      ? { userId: ctx.user.id }
      : ctx.user.role === "PARENT"
        ? { parents: { some: { parent: { userId: ctx.user.id } } } }
        : null;
  if (!students) return false;
  const sections = (
    await ctx.db.studentEnrollment.findMany({ where: { status: "ACTIVE", academicSession: { isCurrent: true }, student: students }, select: { sectionId: true } })
  ).map((row) => row.sectionId);
  if (!sections.length) return false;
  const [assigned, classTeacher] = await Promise.all([
    ctx.db.teacherSubjectAssignment.count({ where: { teacherId, sectionId: { in: sections }, academicSession: { isCurrent: true } } }),
    ctx.db.section.count({ where: { id: { in: sections }, classTeacherId: teacherId } }),
  ]);
  return assigned + classTeacher > 0;
}

/** The signed-in person's own photo, for the header and sidebar — from the session alone. */
export async function selfPhotoUrl(user: SessionUser): Promise<string | null> {
  if (!user.schoolId) return null;
  const ctx = { user, schoolId: user.schoolId, schoolSlug: user.schoolSlug ?? "", schoolName: user.schoolName ?? "", db: forSchool(user.schoolId) } as TenantContext;
  const target = await selfTarget(ctx).catch(() => null);
  return target ? photoUrlFor(ctx, target) : null;
}

/** The photo's bytes, after the viewer is checked. Another school's photo is simply not found. */
export async function readPhoto(ctx: TenantContext, photoId: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const photo = await ctx.db.profilePhoto.findFirst({ where: { id: photoId }, select: { ownerType: true, ownerId: true, storageKey: true, mimeType: true } });
  if (!photo || !(await canViewPhoto(ctx, { type: photo.ownerType, id: photo.ownerId }))) throw new NotFoundError();
  return { bytes: await readStoredFile(photo.storageKey), mimeType: photo.mimeType };
}
