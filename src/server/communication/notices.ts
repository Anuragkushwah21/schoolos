import "server-only";

import type { NoticeAudience, NoticeStatus, UserRole } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { isAllowedScheduleDate, today } from "@/lib/dates";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { CURRENT_STUDENT } from "@/lib/validation/lifecycle";
import type { NoticeInput } from "@/lib/validation/communication";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { accessibleSectionIds } from "@/server/auth/teacher-access";
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
  NON_TEACHING_STAFF: "NON_TEACHING_STAFF",
};

/**
 * Published, its publish moment reached, and its "hide after" day not yet
 * passed. `expiresAt` is a calendar day and inclusive: a notice set to hide
 * after 10 Oct is shown all of 10 Oct in the school's zone, not just until
 * midnight UTC.
 */
function liveWhere(now: Date): Prisma.NoticeWhereInput {
  return {
    status: "PUBLISHED",
    AND: [
      { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gte: today(now) } }] },
    ],
  };
}

const NOTICE_CARD = {
  id: true,
  title: true,
  body: true,
  audience: true,
  scope: true,
  isPublic: true,
  publishAt: true,
  createdAt: true,
} as const;

/**
 * Which notices the signed-in user is addressed by: their role's audience, and
 * — for a targeted notice — their own class, section or name. A student
 * resolves from their own record; a parent through their linked children; a
 * teacher through the sections they teach or are class teacher of.
 */
export async function visibleNoticeWhere(ctx: TenantContext): Promise<Prisma.NoticeWhereInput> {
  if (ctx.user.role === "SCHOOL_ADMIN") return {};
  const audience = AUDIENCE_FOR_ROLE[ctx.user.role];
  const audienceWhere: Prisma.NoticeWhereInput = { audience: { in: ["ALL", ...(audience ? [audience] : [])] } };

  // Non-teaching staff are in no class or section: whole-school notices only.
  if (ctx.user.role === "NON_TEACHING_STAFF") return { ...audienceWhere, scope: "SCHOOL" };

  let sectionIds: string[] = [];
  let classIds: string[] = [];
  let studentIds: string[] = [];

  if (ctx.user.role === "TEACHER") {
    const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
    const reachable = session ? await accessibleSectionIds(ctx, session.id) : [];
    sectionIds = Array.isArray(reachable) ? reachable : [];
  } else if (ctx.user.role === "STUDENT" || ctx.user.role === "PARENT") {
    studentIds =
      ctx.user.role === "STUDENT"
        ? (await ctx.db.student.findMany({ where: { userId: ctx.user.id }, select: { id: true } })).map((row) => row.id)
        : (
            await ctx.db.parentStudent.findMany({
              where: { parent: { userId: ctx.user.id }, student: { status: { in: [...CURRENT_STUDENT] } } },
              select: { studentId: true },
            })
          ).map((row) => row.studentId);
  }

  if (studentIds.length || sectionIds.length) {
    const placements = await ctx.db.studentEnrollment.findMany({
      where: {
        academicSession: { isCurrent: true },
        ...(studentIds.length ? { studentId: { in: studentIds } } : { sectionId: { in: sectionIds } }),
      },
      distinct: ["sectionId"],
      select: { sectionId: true, classId: true },
    });
    if (studentIds.length) sectionIds = placements.map((row) => row.sectionId);
    classIds = [...new Set(placements.map((row) => row.classId))];
    if (!studentIds.length) {
      // A teacher's classes come from their sections, whether or not anyone is enrolled yet.
      const sections = await ctx.db.section.findMany({ where: { id: { in: sectionIds } }, select: { classId: true } });
      classIds = [...new Set(sections.map((row) => row.classId))];
    }
  }

  return {
    ...audienceWhere,
    OR: [
      { scope: "SCHOOL" },
      ...(classIds.length ? [{ scope: "CLASS" as const, classId: { in: classIds } }] : []),
      ...(sectionIds.length ? [{ scope: "SECTION" as const, sectionId: { in: sectionIds } }] : []),
      ...(studentIds.length ? [{ scope: "STUDENTS" as const, recipients: { some: { studentId: { in: studentIds } } } }] : []),
    ],
  };
}

/** Notices for the signed-in user. Admins see every live notice. */
export async function noticesFor(ctx: TenantContext, options: { take?: number } = {}) {
  const now = new Date();

  return ctx.db.notice.findMany({
    where: {
      AND: [liveWhere(now), await visibleNoticeWhere(ctx)],
    },
    orderBy: [{ publishAt: "desc" }, { createdAt: "desc" }],
    take: options.take ?? 50,
    select: NOTICE_CARD,
  });
}

/** Public notices for a school's website. Called with an ACTIVE school's id only. */
export async function publicNotices(schoolId: string, take = 20) {
  return prisma.notice.findMany({
    where: { schoolId, isPublic: true, scope: "SCHOOL", ...liveWhere(new Date()) },
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
  const notice = await ctx.db.notice.findFirst({
    where: { id: noticeId },
    include: { recipients: { select: { student: { select: { admissionNumber: true } } } } },
  });
  if (!notice) throw new NotFoundError();
  return notice;
}

/**
 * Resolve the notice's target inside this school. A class, section or
 * admission number from another school is simply not found.
 */
async function resolveTarget(ctx: TenantContext, input: NoticeInput) {
  switch (input.scope) {
    case "CLASS": {
      const klass = await ctx.db.class.findFirst({ where: { id: input.classId! }, select: { id: true } });
      if (!klass) throw new NotFoundError("That class was not found.");
      return { classId: klass.id, sectionId: null, studentIds: [] as string[] };
    }
    case "SECTION": {
      const section = await ctx.db.section.findFirst({ where: { id: input.sectionId! }, select: { id: true } });
      if (!section) throw new NotFoundError("That section was not found.");
      return { classId: null, sectionId: section.id, studentIds: [] as string[] };
    }
    case "STUDENTS": {
      const wanted = [...new Set(input.studentAdmissionNumbers.map((value) => value.toLowerCase()))];
      const students = await ctx.db.student.findMany({
        where: { admissionNumber: { in: input.studentAdmissionNumbers, mode: "insensitive" } },
        select: { id: true, admissionNumber: true },
      });
      const found = new Set(students.map((student) => student.admissionNumber.toLowerCase()));
      const unknown = wanted.filter((value) => !found.has(value));
      if (unknown.length) {
        throw new ValidationError("Please correct the highlighted fields.", {
          studentAdmissionNumbers: [`Not found: ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? "…" : ""}`],
        });
      }
      return { classId: null, sectionId: null, studentIds: students.map((student) => student.id) };
    }
    default:
      return { classId: null, sectionId: null, studentIds: [] as string[] };
  }
}

export async function saveNotice(ctx: TenantContext, input: NoticeInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const noticeId = input.noticeId;
  const target = await resolveTarget(ctx, input);
  const fields = {
    title: input.title,
    body: input.body,
    audience: input.audience,
    status: input.status,
    isPublic: input.isPublic,
    publishAt: input.publishAt,
    expiresAt: input.expiresAt,
    scope: input.scope,
  };

  // Publishing without a date means "now", so ordering by publish time works.
  const data = {
    ...fields,
    classId: target.classId,
    sectionId: target.sectionId,
    // Only a whole-school notice may appear on the public website.
    isPublic: fields.scope === "SCHOOL" ? fields.isPublic : false,
    publishAt: fields.status === "PUBLISHED" && !fields.publishAt ? new Date() : fields.publishAt,
  };

  let wasPublished = false;

  const previousExpiry = noticeId
    ? (await ctx.db.notice.findFirst({ where: { id: noticeId }, select: { expiresAt: true } }))?.expiresAt
    : null;
  // "Hide after" schedules the notice's removal. A new past date would hide it
  // the moment it is saved; an existing one is left alone.
  if (data.expiresAt && !isAllowedScheduleDate(data.expiresAt, previousExpiry)) {
    throw new ValidationError("Please correct the highlighted fields.", {
      expiresAt: ["Choose today or a later date"],
    });
  }

  if (noticeId) {
    const existing = await ctx.db.notice.findFirst({ where: { id: noticeId }, select: { id: true, status: true } });
    if (!existing) throw new NotFoundError();
    wasPublished = existing.status === "PUBLISHED";
  }

  const id = await ctx.db.$transaction(async (tx) => {
    let noticeRowId: string;
    if (noticeId) {
      await tx.notice.updateMany({ where: { id: noticeId }, data });
      await tx.noticeRecipient.deleteMany({ where: { noticeId } });
      noticeRowId = noticeId;
    } else {
      noticeRowId = (
        await tx.notice.create({ data: { ...data, schoolId: ctx.schoolId, authorId: ctx.user.id }, select: { id: true } })
      ).id;
    }
    if (target.studentIds.length) {
      await tx.noticeRecipient.createMany({
        data: target.studentIds.map((studentId) => ({ schoolId: ctx.schoolId, noticeId: noticeRowId, studentId })),
      });
    }
    return noticeRowId;
  });

  await recordAudit({
    action: data.status === "PUBLISHED" && !wasPublished ? "NOTICE_PUBLISHED" : "NOTICE_UPDATED",
    entityType: "Notice",
    entityId: id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Notice "${data.title}" ${data.status === "PUBLISHED" && !wasPublished ? "published" : "saved"}${
      data.scope === "SCHOOL" ? "" : ` for ${target.studentIds.length ? `${target.studentIds.length} students` : data.scope.toLowerCase()}`
    }.`,
  });

  return id;
}

export async function deleteNotice(ctx: TenantContext, noticeId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { count } = await ctx.db.notice.deleteMany({ where: { id: noticeId } });
  if (!count) throw new NotFoundError();
}

/** Classes and this session's sections, for choosing a notice's target. */
export async function noticeTargetOptions(ctx: TenantContext) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const [classes, sections] = await Promise.all([
    ctx.db.class.findMany({ where: { isActive: true }, orderBy: { level: "asc" }, select: { id: true, name: true } }),
    ctx.db.section.findMany({
      where: { academicSession: { isCurrent: true } },
      select: { id: true, name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } },
    }),
  ]);
  return {
    classes: classes.map((klass) => ({ value: klass.id, label: klass.name })),
    sections: sections
      .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
      .map((section) => ({
        value: section.id,
        label: `${section.class.name} ${section.name}${section.stream ? ` (${section.stream.name})` : ""}`,
      })),
  };
}
