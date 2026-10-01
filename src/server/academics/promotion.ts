import "server-only";

import { today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { fullName, humanize } from "@/lib/format";
import { LEFT_STUDENT } from "@/lib/validation/lifecycle";
import { OPEN_SUPPORT } from "@/lib/validation/support";
import { claimSeatsForGroup } from "@/server/academics/streams";
import { sectionLabel } from "@/server/academics/structure";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { isUniqueViolation } from "@/server/db/errors";
import { changeStudentStatus } from "@/server/people/lifecycle";

/**
 * Whole-school promotion from one academic session to a later one.
 *
 * The admin previews every selected section with a suggested destination,
 * changes whatever does not fit, ticks students in or out, and confirms. The
 * browser then sends one batch per section (or per 100 students) so it can
 * show progress; each batch is a single transaction and is safe to repeat.
 *
 * What promotion never does:
 *   * rewrite last session's placement — it is closed as COMPLETED and a new
 *     placement is created, so attendance, marks, homework, remarks and fees
 *     stay with the session and section they were recorded against;
 *   * copy class teachers or subject teachers — a section it creates starts
 *     with neither, and the admin assigns them separately;
 *   * move a student who has left, or one already placed in the new session.
 *
 * Students in the school's highest class graduate through the people
 * lifecycle, so their history, login and status change like any other leaver.
 */

export const PROMOTION_BATCH_SIZE = 100;

export type PromotionDestination =
  | { kind: "SECTION"; sectionId: string }
  | { kind: "NEW_SECTION"; classId: string; name: string }
  | { kind: "GRADUATE" };

export type Eligibility = "READY" | "REVIEW" | "BLOCKED";

type SessionRow = { id: string; name: string; startDate: Date; isCurrent: boolean };

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------

/**
 * Sessions oldest first, with a sensible default pair: from the current
 * session (or the one asked for) to the session straight after it.
 */
export async function promotionSessions(ctx: TenantContext, requested: { from?: string; to?: string } = {}) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const sessions: SessionRow[] = await ctx.db.academicSession.findMany({
    orderBy: { startDate: "asc" },
    select: { id: true, name: true, startDate: true, isCurrent: true },
  });

  const from =
    sessions.find((s) => s.id === requested.from) ?? sessions.find((s) => s.isCurrent) ?? sessions.at(-2) ?? null;
  const later = from ? sessions.filter((s) => s.startDate > from.startDate) : [];
  const to = later.find((s) => s.id === requested.to) ?? later[0] ?? null;

  return { sessions, from, to, later };
}

async function requireSessionPair(ctx: TenantContext, fromSessionId: string, toSessionId: string) {
  const [from, to] = await Promise.all([
    ctx.db.academicSession.findFirst({ where: { id: fromSessionId }, select: { id: true, name: true, startDate: true, isCurrent: true } }),
    ctx.db.academicSession.findFirst({ where: { id: toSessionId }, select: { id: true, name: true, startDate: true, isCurrent: true } }),
  ]);
  if (!from || !to) throw new NotFoundError("That academic session was not found.");
  if (from.id === to.id) throw new AppError("VALIDATION", "Choose a different session to promote into.");
  if (to.startDate <= from.startDate) throw new AppError("VALIDATION", `${to.name} does not come after ${from.name}.`);
  return { from, to };
}

// -----------------------------------------------------------------------------
// Eligibility
// -----------------------------------------------------------------------------

type Assessed = {
  studentId: string;
  enrollmentId: string;
  name: string;
  admissionNumber: string | null;
  rollNumber: string | null;
  eligibility: Eligibility;
  reason: string | null;
};

/**
 * Who in these source sections can move, who needs a look first, and who
 * cannot move at all — the one rule set shared by the preview and the batch.
 */
async function assessStudents(
  ctx: TenantContext,
  from: SessionRow,
  to: SessionRow,
  where: { sectionIds: string[]; studentIds?: string[] },
): Promise<Map<string, Assessed[]>> {
  const enrollments = await ctx.db.studentEnrollment.findMany({
    where: {
      academicSessionId: from.id,
      sectionId: { in: where.sectionIds },
      ...(where.studentIds ? { studentId: { in: where.studentIds } } : {}),
    },
    select: {
      id: true,
      sectionId: true,
      status: true,
      rollNumber: true,
      student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true, status: true } },
    },
  });
  const studentIds = enrollments.map((row) => row.student.id);

  const [placed, support] = await Promise.all([
    ctx.db.studentEnrollment.findMany({
      where: { academicSessionId: to.id, studentId: { in: studentIds } },
      select: {
        studentId: true,
        section: { select: { name: true, class: { select: { name: true } }, stream: { select: { name: true } } } },
      },
    }),
    ctx.db.studentSupport.findMany({
      where: { studentId: { in: studentIds }, status: { in: [...OPEN_SUPPORT] } },
      select: { studentId: true },
    }),
  ]);
  const placedIn = new Map(placed.map((row) => [row.studentId, sectionLabel(row.section)]));
  const supported = new Set(support.map((row) => row.studentId));

  const bySection = new Map<string, Assessed[]>();
  for (const row of enrollments) {
    const student = row.student;
    let eligibility: Eligibility = "READY";
    let reason: string | null = null;

    const alreadyIn = placedIn.get(student.id);
    if (alreadyIn) {
      eligibility = "BLOCKED";
      reason = `Already placed in ${to.name} (${alreadyIn}).`;
    } else if ((LEFT_STUDENT as readonly string[]).includes(student.status)) {
      eligibility = "BLOCKED";
      reason = `${humanize(student.status)} — has left the school. Bring them back from their profile first.`;
    } else if (row.status === "TRANSFERRED" || row.status === "WITHDRAWN") {
      eligibility = "REVIEW";
      reason = `Their ${from.name} place is marked ${humanize(row.status).toLowerCase()}.`;
    } else if (row.status === "COMPLETED") {
      eligibility = "REVIEW";
      reason = `Their ${from.name} place was already closed, but they have no place in ${to.name}.`;
    } else if (student.status === "ON_LEAVE") {
      eligibility = "REVIEW";
      reason = "On leave.";
    } else if (supported.has(student.id)) {
      eligibility = "REVIEW";
      reason = "Has an open support plan — confirm they should move up.";
    }

    const list = bySection.get(row.sectionId) ?? [];
    list.push({
      studentId: student.id,
      enrollmentId: row.id,
      name: fullName(student),
      admissionNumber: student.admissionNumber,
      rollNumber: row.rollNumber,
      eligibility,
      reason,
    });
    bySection.set(row.sectionId, list);
  }

  for (const list of bySection.values()) {
    list.sort((a, b) => rollOrder(a.rollNumber, b.rollNumber) || a.name.localeCompare(b.name));
  }
  return bySection;
}

function rollOrder(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, undefined, { numeric: true });
}

// -----------------------------------------------------------------------------
// Preview
// -----------------------------------------------------------------------------

/** The school's classes and this session's sections, for choosing what to promote. */
export async function promotionSourceClasses(ctx: TenantContext, fromSessionId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const classes = await ctx.db.class.findMany({
    orderBy: { level: "asc" },
    select: {
      id: true,
      name: true,
      sections: {
        where: { academicSessionId: fromSessionId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          stream: { select: { name: true } },
          _count: { select: { enrollments: true } },
        },
      },
    },
  });
  return classes
    .filter((klass) => klass.sections.length)
    .map((klass) => ({
      id: klass.id,
      name: klass.name,
      sections: klass.sections.map((section) => ({
        id: section.id,
        label: sectionLabel({ ...section, class: klass }),
        name: section.name,
        students: section._count.enrollments,
      })),
    }));
}

export type DestinationOption = { value: string; label: string };

/** `SECTION:<id>`, `NEW:<classId>:<name>` or `GRADUATE` — how a destination travels through a form. */
export function encodeDestination(destination: PromotionDestination): string {
  if (destination.kind === "SECTION") return `SECTION:${destination.sectionId}`;
  if (destination.kind === "NEW_SECTION") return `NEW:${destination.classId}:${destination.name}`;
  return "GRADUATE";
}

export function decodeDestination(value: string): PromotionDestination | null {
  if (value === "GRADUATE") return { kind: "GRADUATE" };
  const [kind, first, ...rest] = value.split(":");
  if (kind === "SECTION" && first) return { kind: "SECTION", sectionId: first };
  const name = rest.join(":").trim();
  if (kind === "NEW" && first && name) return { kind: "NEW_SECTION", classId: first, name };
  return null;
}

export async function previewPromotion(
  ctx: TenantContext,
  input: { fromSessionId: string; toSessionId: string; sectionIds: string[] },
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { from, to } = await requireSessionPair(ctx, input.fromSessionId, input.toSessionId);

  const [sources, classes, targets] = await Promise.all([
    ctx.db.section.findMany({
      where: { academicSessionId: from.id, id: { in: input.sectionIds } },
      select: {
        id: true,
        name: true,
        streamId: true,
        class: { select: { id: true, name: true, level: true } },
        stream: { select: { name: true } },
      },
    }),
    ctx.db.class.findMany({ where: { isActive: true }, orderBy: { level: "asc" }, select: { id: true, name: true, level: true } }),
    ctx.db.section.findMany({
      where: { academicSessionId: to.id },
      select: {
        id: true,
        name: true,
        capacity: true,
        streamId: true,
        class: { select: { id: true, name: true, level: true } },
        stream: { select: { name: true } },
        _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
      },
    }),
  ]);
  if (!sources.length) throw new AppError("VALIDATION", `Choose at least one ${from.name} section to promote.`);

  sources.sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name));
  targets.sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name));
  const assessed = await assessStudents(ctx, from, to, { sectionIds: sources.map((s) => s.id) });

  const targetOptions: DestinationOption[] = targets.map((section) => ({
    value: encodeDestination({ kind: "SECTION", sectionId: section.id }),
    label: `${sectionLabel(section)} · ${section._count.enrollments}${section.capacity ? ` / ${section.capacity}` : ""} students`,
  }));

  const groups = sources.map((source) => {
    const next = classes.find((klass) => klass.level > source.class.level) ?? null;
    const sameName = next
      ? targets.find((t) => t.class.id === next.id && t.name === source.name && t.streamId === source.streamId) ??
        targets.find((t) => t.class.id === next.id && t.name === source.name)
      : undefined;

    // A suggestion only. The admin sees it and can change it before anything is written.
    const suggested: PromotionDestination = !next
      ? { kind: "GRADUATE" }
      : sameName
        ? { kind: "SECTION", sectionId: sameName.id }
        : { kind: "NEW_SECTION", classId: next.id, name: source.name };

    const options: DestinationOption[] = [...targetOptions];
    if (next && !sameName) {
      options.unshift({
        value: encodeDestination({ kind: "NEW_SECTION", classId: next.id, name: source.name }),
        label: `${next.name} – ${source.name} (new section, no class teacher yet)`,
      });
    }
    options.push({ value: "GRADUATE", label: next ? "Graduate / completed school" : "Graduate / completed school (final class)" });

    const repeatSection = targets.find((t) => t.class.id === source.class.id && t.name === source.name);
    return {
      fromSectionId: source.id,
      fromLabel: sectionLabel(source),
      isFinalClass: !next,
      suggested: encodeDestination(suggested),
      options,
      repeatLabel: repeatSection ? sectionLabel(repeatSection) : `${source.class.name} – ${source.name} (new section)`,
      students: assessed.get(source.id) ?? [],
    };
  });

  return {
    from: { id: from.id, name: from.name },
    to: { id: to.id, name: to.name },
    groups,
  };
}

export type PromotionPreview = Awaited<ReturnType<typeof previewPromotion>>;

// -----------------------------------------------------------------------------
// Running one batch
// -----------------------------------------------------------------------------

export type PromotionBatchInput = {
  runId: string;
  fromSessionId: string;
  toSessionId: string;
  fromSectionId: string;
  destination: PromotionDestination;
  /** `repeat` keeps the student in the same class for the new session. */
  students: Array<{ studentId: string; repeat: boolean }>;
};

export type PromotionBatchResult = {
  promoted: number;
  repeated: number;
  graduated: number;
  skipped: Array<{ studentId: string; name: string; reason: string }>;
};

type Tx = Parameters<Parameters<TenantContext["db"]["$transaction"]>[0]>[0];

/** Find the section in the target session, creating it — with no class teacher — if asked. */
async function resolveSection(
  tx: Tx,
  ctx: TenantContext,
  toSessionId: string,
  destination: { kind: "SECTION"; sectionId: string } | { kind: "NEW_SECTION"; classId: string; name: string; streamId: string | null },
) {
  const select = { id: true, classId: true, streamId: true, capacity: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } } as const;
  if (destination.kind === "SECTION") {
    const section = await tx.section.findFirst({ where: { id: destination.sectionId, academicSessionId: toSessionId }, select });
    if (!section) throw new NotFoundError("The destination section was not found in the new session.");
    return section;
  }
  const name = destination.name.trim().toUpperCase().slice(0, 20);
  const klass = await tx.class.findFirst({ where: { id: destination.classId }, select: { id: true, isActive: true, name: true } });
  if (!klass) throw new NotFoundError("The destination class was not found.");
  const existing = await tx.section.findFirst({ where: { academicSessionId: toSessionId, classId: klass.id, name }, select });
  if (existing) return existing;
  if (!klass.isActive) throw new ConflictError(`${klass.name} is not offered. Offer it again under Classes before promoting into it.`);
  // Deliberately no class teacher: last year's is not carried over.
  return tx.section.create({
    data: { schoolId: ctx.schoolId, academicSessionId: toSessionId, classId: klass.id, name, streamId: destination.streamId },
    select,
  });
}

export async function runPromotionBatch(ctx: TenantContext, input: PromotionBatchInput): Promise<PromotionBatchResult> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  if (!input.students.length) return { promoted: 0, repeated: 0, graduated: 0, skipped: [] };
  if (input.students.length > PROMOTION_BATCH_SIZE) {
    throw new AppError("VALIDATION", `Send at most ${PROMOTION_BATCH_SIZE} students at a time.`);
  }
  const { from, to } = await requireSessionPair(ctx, input.fromSessionId, input.toSessionId);

  const source = await ctx.db.section.findFirst({
    where: { id: input.fromSectionId, academicSessionId: from.id },
    select: { id: true, name: true, streamId: true, classId: true, class: { select: { name: true } }, stream: { select: { name: true } } },
  });
  if (!source) throw new NotFoundError("That section was not found.");

  // Everything is re-checked here; the browser's view of who is eligible is
  // only ever a suggestion. A student from another section or another school
  // is simply not found and is refused.
  const wanted = new Map(input.students.map((s) => [s.studentId, s.repeat]));
  const assessed = (await assessStudents(ctx, from, to, { sectionIds: [source.id], studentIds: [...wanted.keys()] })).get(source.id) ?? [];
  if (assessed.length !== wanted.size) throw new NotFoundError("One or more students are not in that section.");

  // Already placed or has left: skipped with a reason, never duplicated. This
  // is what makes a repeated batch — a double click, a retry, a second admin —
  // harmless.
  const skipped = assessed
    .filter((s) => s.eligibility === "BLOCKED")
    .map((s) => ({ studentId: s.studentId, name: s.name, reason: s.reason ?? "Not eligible." }));
  const moving = assessed.filter((s) => s.eligibility !== "BLOCKED");
  const repeating = moving.filter((s) => wanted.get(s.studentId));
  const graduating = input.destination.kind === "GRADUATE" ? moving.filter((s) => !wanted.get(s.studentId)) : [];
  const advancing = input.destination.kind === "GRADUATE" ? [] : moving.filter((s) => !wanted.get(s.studentId));

  const destination = input.destination;
  try {
    await ctx.db.$transaction(async (tx) => {
      const placements: Array<{ section: Awaited<ReturnType<typeof resolveSection>>; students: Assessed[] }> = [];
      if (advancing.length && destination.kind !== "GRADUATE") {
        const section = await resolveSection(
          tx,
          ctx,
          to.id,
          destination.kind === "SECTION" ? destination : { ...destination, streamId: source.streamId },
        );
        placements.push({ section, students: advancing });
      }
      if (repeating.length) {
        const section = await resolveSection(tx, ctx, to.id, { kind: "NEW_SECTION", classId: source.classId, name: source.name, streamId: source.streamId });
        placements.push({ section, students: repeating });
      }

      // Each student keeps their stream; the section's seats and each
      // stream's share are claimed under lock (see streams.ts).
      const currentStreams = new Map(
        (await tx.studentEnrollment.findMany({ where: { id: { in: [...advancing, ...repeating].map((s) => s.enrollmentId) } }, select: { studentId: true, streamId: true } })).map((row) => [
          row.studentId,
          row.streamId ?? source.streamId,
        ]),
      );
      for (const { section, students } of placements) {
        const streams = await claimSeatsForGroup(
          tx,
          section.id,
          students.map((student) => ({ studentId: student.studentId, streamId: currentStreams.get(student.studentId) ?? null })),
        ).catch((error: unknown) => {
          if (error instanceof ConflictError && /has room for/.test(error.message)) {
            throw new ConflictError(`${error.message} Raise its capacity or choose another section.`);
          }
          throw error;
        });
        await tx.studentEnrollment.createMany({
          data: students.map((student) => ({
            schoolId: ctx.schoolId,
            studentId: student.studentId,
            academicSessionId: to.id,
            classId: section.classId,
            sectionId: section.id,
            streamId: streams.get(student.studentId) ?? null,
            enrolledOn: today(),
          })),
        });
      }

      // Last session's placement is closed, never edited: same section, same
      // roll number, and every record made against it stays where it was.
      const closing = [...advancing, ...repeating, ...graduating].map((s) => s.enrollmentId);
      if (closing.length) {
        await tx.studentEnrollment.updateMany({ where: { id: { in: closing }, status: "ACTIVE" }, data: { status: "COMPLETED" } });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("Some of these students were placed in the new session a moment ago. Refresh the preview and try again.");
    }
    throw error;
  }

  // Graduation is a status change, so it goes through the lifecycle: the
  // student's history gets a dated entry and their login closes like any
  // other leaver's.
  for (const student of graduating) {
    await changeStudentStatus(ctx, student.studentId, "GRADUATED", {
      effectiveDate: today(),
      reason: `Completed ${source.class.name} in ${from.name}`,
      remarks: null,
      confirmReturn: false,
    });
  }

  const result = { promoted: advancing.length, repeated: repeating.length, graduated: graduating.length, skipped };
  await recordAudit({
    action: "STUDENTS_PROMOTED",
    entityType: "Section",
    entityId: source.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${sectionLabel(source)}, ${from.name} → ${to.name}: ${[
      `${advancing.length} promoted`,
      repeating.length ? `${repeating.length} kept in ${source.class.name}` : null,
      graduating.length ? `${graduating.length} graduated` : null,
      skipped.length ? `${skipped.length} skipped` : null,
    ]
      .filter(Boolean)
      .join(", ")}.`,
    metadata: {
      runId: input.runId,
      fromSessionId: from.id,
      toSessionId: to.id,
      promoted: result.promoted,
      repeated: result.repeated,
      graduated: result.graduated,
      skipped: skipped.length,
      studentIds: moving.map((s) => s.studentId),
    },
  });
  return result;
}

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------

/**
 * Past promotions, read from the audit trail rather than a table of their
 * own. The batches of one run share a `runId`, so they are shown together;
 * promotions made one section at a time from the Students page each count as
 * their own run.
 */
export async function promotionHistory(ctx: TenantContext, limit = 12) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const rows = await prisma.auditLog.findMany({
    where: { schoolId: ctx.schoolId, action: "STUDENTS_PROMOTED" },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      summary: true,
      metadata: true,
      createdAt: true,
      actor: { select: { firstName: true, lastName: true } },
    },
  });

  type Run = {
    id: string;
    toSessionId: string | null;
    fromSessionId: string | null;
    promoted: number;
    repeated: number;
    graduated: number;
    at: Date;
    by: string | null;
    summaries: string[];
  };
  const runs = new Map<string, Run>();
  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const key = typeof meta.runId === "string" ? meta.runId : row.id;
    const run: Run = runs.get(key) ?? {
      id: key,
      toSessionId: typeof meta.toSessionId === "string" ? meta.toSessionId : null,
      fromSessionId: typeof meta.fromSessionId === "string" ? meta.fromSessionId : null,
      promoted: 0,
      repeated: 0,
      graduated: 0,
      at: row.createdAt,
      by: row.actor ? fullName(row.actor) : null,
      summaries: [],
    };
    run.promoted += typeof meta.promoted === "number" ? meta.promoted : Array.isArray(meta.studentIds) ? meta.studentIds.length : 0;
    run.repeated += typeof meta.repeated === "number" ? meta.repeated : 0;
    run.graduated += typeof meta.graduated === "number" ? meta.graduated : 0;
    if (row.createdAt < run.at) run.at = row.createdAt;
    run.summaries.push(row.summary);
    runs.set(key, run);
  }

  const list = [...runs.values()].slice(0, limit);
  const sessionIds = [...new Set(list.flatMap((run) => [run.fromSessionId, run.toSessionId]).filter((id): id is string => !!id))];
  const sessions = new Map(
    (await ctx.db.academicSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]),
  );
  return list.map((run) => ({
    ...run,
    fromName: run.fromSessionId ? sessions.get(run.fromSessionId) ?? null : null,
    toName: run.toSessionId ? sessions.get(run.toSessionId) ?? null : null,
  }));
}
