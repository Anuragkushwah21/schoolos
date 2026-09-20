import "server-only";

import { ConflictError, NotFoundError } from "@/lib/errors";
import type { SchoolPageInput, WebsiteProfileInput } from "@/lib/validation/website";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { isUniqueViolation } from "@/server/db/errors";

/**
 * The School Admin's editor for their own public website. `ctx.db` scopes the
 * `School` model to the admin's own row, so there is no way to address another
 * school's profile from here.
 */

export async function getWebsiteProfile(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const school = await ctx.db.school.findFirst({
    where: { id: ctx.schoolId },
    select: {
      slug: true,
      name: true,
      shortName: true,
      about: true,
      principalName: true,
      principalMessage: true,
      establishedYear: true,
      affiliationBoard: true,
      email: true,
      phone: true,
      addressLine: true,
      city: true,
      state: true,
      postalCode: true,
      logoUrl: true,
      bannerUrl: true,
      primaryColor: true,
      secondaryColor: true,
    },
  });
  if (!school) throw new NotFoundError();
  return school;
}

export async function updateWebsiteProfile(ctx: TenantContext, input: WebsiteProfileInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await ctx.db.school.updateMany({ where: { id: ctx.schoolId }, data: input });
  await recordAudit({
    action: "WEBSITE_UPDATED",
    entityType: "School",
    entityId: ctx.schoolId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: "School profile and branding updated.",
  });
}

export async function listPages(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.schoolPage.findMany({
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    select: { id: true, slug: true, title: true, isPublished: true, sortOrder: true, updatedAt: true },
  });
}

export async function getPage(ctx: TenantContext, pageId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const page = await ctx.db.schoolPage.findFirst({ where: { id: pageId } });
  if (!page) throw new NotFoundError();
  return page;
}

export async function savePage(ctx: TenantContext, input: SchoolPageInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { pageId, ...fields } = input;
  const data = { ...fields, sortOrder: fields.sortOrder ?? 0 };

  try {
    if (pageId) {
      const { count } = await ctx.db.schoolPage.updateMany({ where: { id: pageId }, data });
      if (!count) throw new NotFoundError();
    } else {
      await ctx.db.schoolPage.create({ data: { ...data, schoolId: ctx.schoolId } });
    }
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Another page already uses that web address.");
    throw error;
  }

  await recordAudit({
    action: "WEBSITE_UPDATED",
    entityType: "SchoolPage",
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Page "${data.title}" saved${data.isPublished ? " and published" : ""}.`,
  });
}

export async function deletePage(ctx: TenantContext, pageId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { count } = await ctx.db.schoolPage.deleteMany({ where: { id: pageId } });
  if (!count) throw new NotFoundError();
}

export async function listMedia(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.schoolMedia.findMany({
    where: { category: "GALLERY" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    select: { id: true, url: true, caption: true },
  });
}

export async function addMedia(ctx: TenantContext, input: { url: string; caption: string | null }): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await ctx.db.schoolMedia.create({
    data: { schoolId: ctx.schoolId, category: "GALLERY", url: input.url, caption: input.caption },
  });
}

export async function deleteMedia(ctx: TenantContext, mediaId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { count } = await ctx.db.schoolMedia.deleteMany({ where: { id: mediaId } });
  if (!count) throw new NotFoundError();
}
