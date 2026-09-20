import "server-only";

import type { NoticeAudience, NoticeStatus, UserRole } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/errors";
import type { NoticeInput } from "@/lib/validation/communication";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";

/**
 * Notices. `audience` decides who sees a notice once signed in; `isPublic`
 * additionally puts it on the school's website. A notice is live when it is
 * PUBLISHED, its publish time has arrived, and it has not expired.
 */

const AUDIENCE_FOR_ROLE: Partial<Record<UserRole, NoticeAudience>> = {
  TEACHER: "TEACHERS",
  STUDENT: "STUDENTS",
  PARENT: "PARENTS",
};

function liveWhere(now: Date): Prisma.NoticeWhereInput {
  return {
    status: "PUBLISHED",
    AND: [
      { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
    ],
  };
}

const NOTICE_CARD = {
  id: true,
  title: true,
  body: true,
  audience: true,
  isPublic: true,
  publishAt: true,
  createdAt: true,
} as const;

/** Notices for the signed-in user's role. Admins see every live notice. */
export async function noticesFor(ctx: TenantContext, options: { take?: number } = {}) {
  const now = new Date();
  const audience = AUDIENCE_FOR_ROLE[ctx.user.role];

  return ctx.db.notice.findMany({
    where: {
      ...liveWhere(now),
      ...(ctx.user.role === "SCHOOL_ADMIN" ? {} : { audience: { in: ["ALL", ...(audience ? [audience] : [])] } }),
    },
    orderBy: [{ publishAt: "desc" }, { createdAt: "desc" }],
    take: options.take ?? 50,
    select: NOTICE_CARD,
  });
}

/** Public notices for a school's website. Called with an ACTIVE school's id only. */
export async function publicNotices(schoolId: string, take = 20) {
  return prisma.notice.findMany({
    where: { schoolId, isPublic: true, ...liveWhere(new Date()) },
    orderBy: [{ publishAt: "desc" }, { createdAt: "desc" }],
    take,
    select: NOTICE_CARD,
  });
}

export async function listNoticesForAdmin(ctx: TenantContext, status?: NoticeStatus) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.notice.findMany({
    where: status ? { status } : {},
    orderBy: [{ updatedAt: "desc" }],
    select: {
      ...NOTICE_CARD,
      status: true,
      expiresAt: true,
      updatedAt: true,
      author: { select: { firstName: true, lastName: true } },
    },
  });
}

export async function getNotice(ctx: TenantContext, noticeId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const notice = await ctx.db.notice.findFirst({ where: { id: noticeId } });
  if (!notice) throw new NotFoundError();
  return notice;
}

export async function saveNotice(ctx: TenantContext, input: NoticeInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { noticeId, ...fields } = input;

  // Publishing without a date means "now", so ordering by publish time works.
  const data = {
    ...fields,
    publishAt: fields.status === "PUBLISHED" && !fields.publishAt ? new Date() : fields.publishAt,
  };

  let id: string;
  let wasPublished = false;

  if (noticeId) {
    const existing = await ctx.db.notice.findFirst({ where: { id: noticeId }, select: { id: true, status: true } });
    if (!existing) throw new NotFoundError();
    wasPublished = existing.status === "PUBLISHED";
    await ctx.db.notice.updateMany({ where: { id: existing.id }, data });
    id = existing.id;
  } else {
    const created = await ctx.db.notice.create({
      data: { ...data, schoolId: ctx.schoolId, authorId: ctx.user.id },
      select: { id: true },
    });
    id = created.id;
  }

  await recordAudit({
    action: data.status === "PUBLISHED" && !wasPublished ? "NOTICE_PUBLISHED" : "NOTICE_UPDATED",
    entityType: "Notice",
    entityId: id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Notice "${data.title}" ${data.status === "PUBLISHED" && !wasPublished ? "published" : "saved"}.`,
  });

  return id;
}

export async function deleteNotice(ctx: TenantContext, noticeId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { count } = await ctx.db.notice.deleteMany({ where: { id: noticeId } });
  if (!count) throw new NotFoundError();
}
