import "server-only";

import { today } from "@/lib/dates";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { homeworkStatus } from "@/lib/time-status";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import {
  accessibleSectionIds,
  requireSubjectAssignment,
  requireTeacherSelf,
} from "@/server/auth/teacher-access";
import { requireCurrentSession, sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import {
  type MaterialFields,
  type PreparedMaterial,
  assertRoomForMore,
  isValidWebAddress,
  prepareMaterial,
  saveMaterial,
} from "@/server/classwork/materials";
import { deleteStoredFile, storeDocument, validateDocument } from "@/server/storage/files";

/**
 * Work set for a section in one subject.
 *
 * Two rules do all the work here:
 *
 *   * Setting homework needs `requireSubjectAssignment`, not section access.
 *     A class teacher can take any register in their section, but only the
 *     Mathematics teacher may set Mathematics homework.
 *   * Editing needs authorship. The row records who set it, and that is the
 *     only teacher who may change it — being in the same school, or even
 *     teaching the same class, is not enough.
 */

export const HOMEWORK_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type HomeworkStatus = (typeof HOMEWORK_STATUSES)[number];

/** What a teacher can attach to homework: a PDF, a video, or a link. */
export const HOMEWORK_RESOURCE_KINDS = ["DOCUMENT", "VIDEO", "LINK"] as const;
export type HomeworkResourceKind = (typeof HOMEWORK_RESOURCE_KINDS)[number];

export type HomeworkResourceInput = Omit<MaterialFields, "kind" | "body"> & {
  kind: HomeworkResourceKind;
};

export type HomeworkInput = {
  sectionId: string;
  subjectId: string;
  title: string;
  description: string | null;
  /** Step-by-step instructions for the student. */
  instructions?: string | null;
  assignedOn: Date;
  dueOn: Date;
  status: HomeworkStatus;
};

const HOMEWORK_SELECT = {
  id: true,
  title: true,
  description: true,
  instructions: true,
  assignedOn: true,
  dueOn: true,
  status: true,
  teacherId: true,
  createdAt: true,
  _count: { select: { resources: true } },
  subject: { select: { id: true, name: true } },
  section: {
    select: {
      id: true,
      name: true,
      class: { select: { name: true, level: true } },
      stream: { select: { name: true } },
    },
  },
} as const;

type HomeworkRow = {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  assignedOn: Date;
  dueOn: Date;
  status: HomeworkStatus;
  teacherId: string;
  _count: { resources: number };
  subject: { id: string; name: string };
  section: { id: string; name: string; class: { name: string }; stream: { name: string } | null };
};

function shape(row: HomeworkRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    assignedOn: row.assignedOn,
    dueOn: row.dueOn,
    status: row.status,
    resourceCount: row._count.resources,
    subjectId: row.subject.id,
    subject: row.subject.name,
    sectionId: row.section.id,
    section: sectionLabel(row.section),
    overdue: row.status === "PUBLISHED" && row.dueOn < today(),
    /** ASSIGNED, DUE_TODAY or OVERDUE for published work, from the due date. */
    timeStatus: row.status === "PUBLISHED" ? homeworkStatus(row.dueOn) : null,
  };
}

/** Work cannot be due before it is set. */
function assertDates(assignedOn: Date, dueOn: Date): void {
  if (dueOn < assignedOn) {
    throw new AppError("VALIDATION", "The due date cannot be before the date it is set.");
  }
}

/** Check every resource before anything is written, so one bad file refuses the lot. */
async function prepareResources(resources: HomeworkResourceInput[]): Promise<PreparedMaterial[]> {
  const prepared: PreparedMaterial[] = [];
  for (const resource of resources) {
    if (!(HOMEWORK_RESOURCE_KINDS as readonly string[]).includes(resource.kind)) {
      throw new AppError("VALIDATION", "Homework resources are a PDF, a video or a link.");
    }
    prepared.push(await prepareMaterial(resource));
  }
  return prepared;
}

/**
 * Set homework, with any study resources attached in the same save.
 *
 * Resources are checked first, then the homework is created, then each
 * resource is stored. If storing fails part-way, the homework and whatever was
 * already stored are removed again, so a failed save never leaves half an
 * assignment in front of the class.
 */
export async function createHomework(
  ctx: TenantContext,
  input: HomeworkInput,
  resources: HomeworkResourceInput[] = [],
): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");
  const session = await requireCurrentSession(ctx);

  // The one check that matters: do they teach this subject to this section?
  const { teacherId } = await requireSubjectAssignment(
    ctx,
    input.sectionId,
    input.subjectId,
    session.id,
  );
  assertDates(input.assignedOn, input.dueOn);

  // A double-clicked or re-sent form must not set the same work twice.
  const duplicate = await ctx.db.homework.findFirst({
    where: {
      teacherId,
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      title: input.title,
      assignedOn: input.assignedOn,
      dueOn: input.dueOn,
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new ConflictError("This homework has already been set for that class.");
  }

  if (resources.length > 20) {
    throw new AppError("VALIDATION", "At most 20 resources can be attached.");
  }
  const prepared = await prepareResources(resources);

  const created = await ctx.db.homework.create({
    data: {
      schoolId: ctx.schoolId,
      academicSessionId: session.id,
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      teacherId,
      title: input.title,
      description: input.description,
      instructions: input.instructions ?? null,
      assignedOn: input.assignedOn,
      dueOn: input.dueOn,
      status: input.status,
    },
    select: { id: true, section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } } },
  });

  await recordAudit({
    action: "HOMEWORK_CREATED",
    entityType: "Homework",
    entityId: created.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Homework "${input.title}" set for ${sectionLabel(created.section)}.`,
  });

  const stored: string[] = [];
  try {
    for (const resource of prepared) {
      const saved = await saveMaterial(ctx, { homeworkId: created.id }, resource);
      if (saved.storageKey) stored.push(saved.storageKey);
    }
  } catch (error) {
    // Resources cascade with the homework; their files do not.
    await ctx.db.homework.deleteMany({ where: { id: created.id } });
    await Promise.all(stored.map(deleteStoredFile));
    throw error;
  }

  return { id: created.id };
}

/**
 * The teacher's own homework row, or a refusal.
 *
 * Someone else's homework and a non-existent id answer identically, so the
 * response cannot be used to discover what other teachers have set.
 */
async function requireOwnHomework(ctx: TenantContext, homeworkId: string) {
  const teacher = await requireTeacherSelf(ctx);

  const row = await ctx.db.homework.findFirst({
    where: { id: homeworkId },
    select: { id: true, teacherId: true, title: true, sectionId: true, subjectId: true, academicSessionId: true },
  });

  if (!row) throw new NotFoundError("That homework was not found.");
  if (row.teacherId !== teacher.id) {
    throw new ForbiddenError("You can only change homework you set yourself.");
  }

  return row;
}

export async function updateHomework(
  ctx: TenantContext,
  homeworkId: string,
  input: HomeworkInput,
): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const session = await requireCurrentSession(ctx);

  const existing = await requireOwnHomework(ctx, homeworkId);
  // Moving homework to a different class or subject is still setting it there,
  // so the destination is checked exactly as a new one would be.
  await requireSubjectAssignment(ctx, input.sectionId, input.subjectId, session.id);
  assertDates(input.assignedOn, input.dueOn);

  await ctx.db.homework.update({
    where: { id: existing.id },
    data: {
      sectionId: input.sectionId,
      subjectId: input.subjectId,
      title: input.title,
      description: input.description,
      ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
      assignedOn: input.assignedOn,
      dueOn: input.dueOn,
      status: input.status,
    },
  });

  await recordAudit({
    action: "HOMEWORK_UPDATED",
    entityType: "Homework",
    entityId: existing.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Homework "${input.title}" updated.`,
  });
}

export async function deleteHomework(ctx: TenantContext, homeworkId: string): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const existing = await requireOwnHomework(ctx, homeworkId);

  // The resource rows cascade with the homework; the files they point at are
  // removed here, once the rows are gone.
  const files = await ctx.db.lessonMaterial.findMany({
    where: { homeworkId: existing.id, storageKey: { not: null } },
    select: { storageKey: true },
  });

  await ctx.db.homework.delete({ where: { id: existing.id } });
  await Promise.all(files.map((file) => deleteStoredFile(file.storageKey!)));

  await recordAudit({
    action: "HOMEWORK_DELETED",
    entityType: "Homework",
    entityId: existing.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Homework "${existing.title}" deleted.`,
  });
}

export type HomeworkFilters = {
  sectionId?: string | null;
  subjectId?: string | null;
  status?: HomeworkStatus | null;
  take?: number;
};

/** Everything this teacher has set, newest first. */
export async function listMyHomework(ctx: TenantContext, filters: HomeworkFilters = {}) {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);

  const rows = await ctx.db.homework.findMany({
    where: {
      teacherId: teacher.id,
      ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
      ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: [{ dueOn: "desc" }, { createdAt: "desc" }],
    take: filters.take ?? 50,
    select: HOMEWORK_SELECT,
  });

  return rows.map(shape);
}

/** One row for the edit form — the teacher's own, or a refusal. */
export async function getMyHomework(ctx: TenantContext, homeworkId: string) {
  assertRole(ctx.user, "TEACHER");
  await requireOwnHomework(ctx, homeworkId);

  const row = await ctx.db.homework.findFirstOrThrow({
    where: { id: homeworkId },
    select: {
      ...HOMEWORK_SELECT,
      resources: { orderBy: { createdAt: "asc" }, select: RESOURCE_SELECT },
    },
  });
  return { ...shape(row), resources: row.resources };
}

// -----------------------------------------------------------------------------
// Study resources on existing homework
// -----------------------------------------------------------------------------

/** The storage key stays on the server; everything else is safe to show. */
export const RESOURCE_SELECT = {
  id: true,
  kind: true,
  title: true,
  url: true,
  description: true,
  fileName: true,
  fileSize: true,
} as const;

/** A resource on homework this teacher set, or "not found". */
async function requireOwnResource(ctx: TenantContext, resourceId: string) {
  const teacher = await requireTeacherSelf(ctx);
  const resource = await ctx.db.lessonMaterial.findFirst({
    where: { id: resourceId, homework: { teacherId: teacher.id } },
    select: { id: true, kind: true, title: true, url: true, storageKey: true, homeworkId: true },
  });
  // Another teacher's resource, a class material and a missing id look alike.
  if (!resource?.homeworkId) throw new NotFoundError("That resource was not found.");
  return { ...resource, homeworkId: resource.homeworkId };
}

export async function addHomeworkResource(
  ctx: TenantContext,
  homeworkId: string,
  input: HomeworkResourceInput,
): Promise<{ id: string }> {
  assertRole(ctx.user, "TEACHER");
  const homework = await requireOwnHomework(ctx, homeworkId);
  const owner = { homeworkId: homework.id };

  await assertRoomForMore(ctx, owner);
  const [prepared] = await prepareResources([input]);
  const saved = await saveMaterial(ctx, owner, prepared!);

  await recordAudit({
    action: "LESSON_MATERIAL_ADDED",
    entityType: "Homework",
    entityId: homework.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `"${input.title}" attached to homework "${homework.title}".`,
  });

  return { id: saved.id };
}

export type HomeworkResourceUpdate = {
  title: string;
  description: string | null;
  /** For a video or link, or a document hosted elsewhere. */
  url: string | null;
  /** A replacement PDF for an uploaded document. */
  file?: File | null;
};

/**
 * Change a resource's title, description or address, or replace its PDF.
 *
 * The kind stays what it was: turning a video into a PDF is removing one and
 * adding the other. A replaced PDF is written before the old one is deleted,
 * so a failed upload leaves the original in place.
 */
export async function updateHomeworkResource(
  ctx: TenantContext,
  resourceId: string,
  input: HomeworkResourceUpdate,
): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const resource = await requireOwnResource(ctx, resourceId);

  const replacement =
    resource.kind === "DOCUMENT" && input.file && input.file.size > 0
      ? await validateDocument(input.file)
      : null;

  if (!replacement && !resource.storageKey) {
    // A link-shaped resource must keep a working address.
    if (!input.url) throw new AppError("VALIDATION", "Give a web address.");
    if (!isValidWebAddress(input.url)) {
      throw new AppError("VALIDATION", "Enter a valid https:// web address.");
    }
  }

  const newKey = replacement ? await storeDocument(ctx.schoolId, replacement) : null;
  try {
    await ctx.db.lessonMaterial.updateMany({
      where: { id: resource.id },
      data: {
        title: input.title,
        description: input.description,
        ...(replacement
          ? {
              url: null,
              storageKey: newKey,
              fileName: replacement.fileName,
              fileSize: replacement.size,
              mimeType: replacement.mimeType,
            }
          : resource.storageKey
            ? {}
            : { url: input.url }),
      },
    });
  } catch (error) {
    if (newKey) await deleteStoredFile(newKey);
    throw error;
  }
  if (newKey && resource.storageKey) await deleteStoredFile(resource.storageKey);

  await recordAudit({
    action: "HOMEWORK_UPDATED",
    entityType: "Homework",
    entityId: resource.homeworkId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Resource "${input.title}" updated${replacement ? " with a new PDF" : ""}.`,
  });
}

/** Remove one resource. The homework itself is untouched. */
export async function removeHomeworkResource(ctx: TenantContext, resourceId: string): Promise<void> {
  assertRole(ctx.user, "TEACHER");
  const resource = await requireOwnResource(ctx, resourceId);

  await ctx.db.lessonMaterial.deleteMany({ where: { id: resource.id } });
  if (resource.storageKey) await deleteStoredFile(resource.storageKey);

  await recordAudit({
    action: "LESSON_MATERIAL_REMOVED",
    entityType: "Homework",
    entityId: resource.homeworkId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `"${resource.title}" removed from homework.`,
  });
}

/**
 * Work this teacher has set that is still ahead of its due date — the
 * "pending" count on the dashboard.
 */
export async function pendingHomeworkCount(ctx: TenantContext): Promise<number> {
  assertRole(ctx.user, "TEACHER");
  const teacher = await requireTeacherSelf(ctx);

  return ctx.db.homework.count({
    where: { teacherId: teacher.id, status: "PUBLISHED", dueOn: { gte: today() } },
  });
}

/**
 * Homework due for the sections a teacher can reach, whoever set it.
 *
 * This is the class-teacher's view — what a section owes this week across all
 * its subjects — so it is scoped by section access rather than authorship.
 */
export async function homeworkDueForMySections(
  ctx: TenantContext,
  options: { from: Date; to: Date; take?: number },
) {
  assertRole(ctx.user, "TEACHER");
  const session = await requireCurrentSession(ctx);
  const sectionIds = await accessibleSectionIds(ctx, session.id);

  // "ALL" belongs to admins; a teacher with no sections sees nothing.
  const mine = sectionIds === "ALL" ? [] : sectionIds;
  if (mine.length === 0) return [];

  const rows = await ctx.db.homework.findMany({
    where: {
      sectionId: { in: mine },
      status: "PUBLISHED",
      dueOn: { gte: options.from, lte: options.to },
    },
    orderBy: { dueOn: "asc" },
    take: options.take ?? 20,
    select: HOMEWORK_SELECT,
  });

  return rows.map(shape);
}

export const ADMIN_HOMEWORK_PAGE_SIZE = 30;

/**
 * The School Admin's read-only view of homework across the school — what has
 * been set, by whom, and when it is due. Teachers remain the only people who
 * set or change homework; drafts stay private to their teacher.
 */
export async function listHomeworkForAdmin(
  ctx: TenantContext,
  filters: { q?: string; sectionId?: string; due?: "upcoming" | "today" | "past"; page?: number } = {},
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const now = today();
  const page = Math.max(1, filters.page ?? 1);
  const where = {
    status: "PUBLISHED" as const,
    academicSession: { isCurrent: true },
    ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
    ...(filters.due === "upcoming" ? { dueOn: { gt: now } } : filters.due === "today" ? { dueOn: now } : filters.due === "past" ? { dueOn: { lt: now } } : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" as const } },
            { subject: { name: { contains: filters.q, mode: "insensitive" as const } } },
            { teacher: { firstName: { contains: filters.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
  const [rows, total, setToday, dueToday] = await Promise.all([
    ctx.db.homework.findMany({
      where,
      orderBy: [{ dueOn: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * ADMIN_HOMEWORK_PAGE_SIZE,
      take: ADMIN_HOMEWORK_PAGE_SIZE,
      select: {
        id: true,
        title: true,
        assignedOn: true,
        dueOn: true,
        subject: { select: { name: true } },
        teacher: { select: { firstName: true, lastName: true } },
        section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
        _count: { select: { resources: true } },
      },
    }),
    ctx.db.homework.count({ where }),
    ctx.db.homework.count({ where: { status: "PUBLISHED", assignedOn: now } }),
    ctx.db.homework.count({ where: { status: "PUBLISHED", dueOn: now } }),
  ]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      subject: row.subject.name,
      teacher: `${row.teacher.firstName} ${row.teacher.lastName}`.trim(),
      section: sectionLabel(row.section),
      assignedOn: row.assignedOn,
      dueOn: row.dueOn,
      resources: row._count.resources,
      timeStatus: homeworkStatus(row.dueOn, now),
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / ADMIN_HOMEWORK_PAGE_SIZE)),
    setToday,
    dueToday,
  };
}
