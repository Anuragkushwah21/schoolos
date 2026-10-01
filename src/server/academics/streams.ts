import "server-only";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { CURRENT_EMPLOYEE } from "@/lib/validation/lifecycle";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import type { TenantDb } from "@/server/tenancy/scope";

/** The client inside `ctx.db.$transaction(async (tx) => …)`. */
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

/**
 * Streams / groups inside a section, and the seats each one has.
 *
 *   * A section has a total capacity. The admin may split it among streams —
 *     "Class 9 – A: Science 15, Commerce 10, Arts 10, Agriculture 5" — in any
 *     proportion. Each section is configured on its own; nothing is copied
 *     from its neighbour, and no class is assumed to have streams.
 *   * The shares add up to at most the section's capacity. What is left over
 *     is shown as "remaining", never silently spread.
 *   * A section may instead be wholly one stream (`Section.streamId`, the
 *     older "11 – A (Science)" form). The two are exclusive.
 *   * Occupied seats are ACTIVE enrollments — the same count every other
 *     capacity check in the app uses; a withdrawn or transferred student's
 *     enrollment is closed by the lifecycle code, which frees the seat.
 *   * Lowering a share or the capacity never moves or removes a student: the
 *     admin is told how far over it is and decides.
 *   * Seat claims lock the section and share rows, so two admissions at once
 *     cannot both take the last seat.
 */

type Db = TenantDb | TenantTx;

export const ALLOCATION_TOO_LARGE = "Stream allocation cannot exceed the section's total capacity.";

export type StreamSeats = { streamId: string; name: string; capacity: number; occupied: number; remaining: number; full: boolean };

export type SeatPlan = {
  sectionId: string;
  capacity: number | null;
  occupied: number;
  /** Set when the whole section is one stream. */
  wholeStream: { id: string; name: string } | null;
  allocations: StreamSeats[];
  allocated: number;
  /** Capacity not given to any stream; null without a capacity. */
  unallocated: number | null;
  /** Current students in the section whose stream has no share here. */
  outsideAllocations: number;
};

/** The seat plan of each section given, keyed by section id. */
export async function seatPlans(db: Db, sectionIds: string[]): Promise<Map<string, SeatPlan>> {
  if (!sectionIds.length) return new Map();
  const [sections, allocations, occupancy] = await Promise.all([
    db.section.findMany({
      where: { id: { in: sectionIds } },
      select: { id: true, capacity: true, stream: { select: { id: true, name: true } } },
    }),
    db.sectionStream.findMany({
      where: { sectionId: { in: sectionIds } },
      select: { sectionId: true, streamId: true, capacity: true, stream: { select: { name: true } } },
    }),
    db.studentEnrollment.groupBy({
      by: ["sectionId", "streamId"],
      where: { sectionId: { in: sectionIds }, status: "ACTIVE" },
      _count: { _all: true },
    }),
  ]);

  const count = new Map<string, number>();
  for (const row of occupancy) count.set(`${row.sectionId}|${row.streamId ?? ""}`, row._count._all);

  const plans = new Map<string, SeatPlan>();
  for (const section of sections) {
    const shares = allocations
      .filter((row) => row.sectionId === section.id)
      .map((row) => {
        const occupied = count.get(`${section.id}|${row.streamId}`) ?? 0;
        return { streamId: row.streamId, name: row.stream.name, capacity: row.capacity, occupied, remaining: Math.max(row.capacity - occupied, 0), full: occupied >= row.capacity };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const occupied = occupancy.filter((row) => row.sectionId === section.id).reduce((sum, row) => sum + row._count._all, 0);
    const allocated = shares.reduce((sum, row) => sum + row.capacity, 0);
    plans.set(section.id, {
      sectionId: section.id,
      capacity: section.capacity,
      occupied,
      wholeStream: section.stream,
      allocations: shares,
      allocated,
      unallocated: section.capacity === null ? null : Math.max(section.capacity - allocated, 0),
      outsideAllocations: shares.length ? occupied - shares.reduce((sum, row) => sum + row.occupied, 0) : 0,
    });
  }
  return plans;
}

export async function seatPlan(db: Db, sectionId: string): Promise<SeatPlan> {
  const plan = (await seatPlans(db, [sectionId])).get(sectionId);
  if (!plan) throw new NotFoundError("That section was not found.");
  return plan;
}

/** Each section's seats for a form's stream picker, keyed by section id. */
export async function seatOptionsFor(db: Db, sectionIds: string[]) {
  const plans = await seatPlans(db, sectionIds);
  return Object.fromEntries(
    [...plans.values()].map((plan) => [
      plan.sectionId,
      {
        capacity: plan.capacity,
        occupied: plan.occupied,
        wholeStream: plan.wholeStream?.name ?? null,
        streams: plan.allocations.map((row) => ({ value: row.streamId, name: row.name, remaining: row.remaining, full: row.full })),
      },
    ]),
  );
}

/** Streams that sections of one session offer, for the admission form. */
export async function admissionSeatOptions(ctx: TenantContext, academicSessionId: string) {
  const sections = await ctx.db.section.findMany({ where: { academicSessionId }, select: { id: true } });
  return seatOptionsFor(ctx.db, sections.map((section) => section.id));
}

export type AdmissionSeatOptions = Awaited<ReturnType<typeof seatOptionsFor>>;
export type SectionSeats = AdmissionSeatOptions[string];

// -----------------------------------------------------------------------------
// Configuring
// -----------------------------------------------------------------------------

/**
 * Replace one section's stream shares. Rows with the same stream twice, an
 * unknown stream, or a total over the section's capacity are refused. A share
 * can be removed only when no current student or subject assignment in this
 * section uses it. Returns warnings where a share is now below the students
 * already in it — nobody is moved.
 */
export async function saveStreamAllocations(
  ctx: TenantContext,
  sectionId: string,
  rows: Array<{ streamId: string; capacity: number }>,
): Promise<{ warnings: string[] }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const section = await ctx.db.section.findFirst({
    where: { id: sectionId },
    select: { id: true, name: true, capacity: true, streamId: true, class: { select: { name: true } }, streamAllocations: { select: { streamId: true } } },
  });
  if (!section) throw new NotFoundError("That section was not found.");
  if (section.streamId && rows.length) {
    throw new ConflictError("This section is set up as one stream. Set its stream to None first, then share its seats among streams.");
  }

  const ids = rows.map((row) => row.streamId);
  if (new Set(ids).size !== ids.length) throw new ValidationError("Each stream can appear only once.", { streams: ["Each stream can appear only once."] });
  if (rows.some((row) => !Number.isInteger(row.capacity) || row.capacity < 0 || row.capacity > 500)) {
    throw new ValidationError("Seats must be a whole number from 0 to 500.", { streams: ["Seats must be a whole number from 0 to 500."] });
  }
  const total = rows.reduce((sum, row) => sum + row.capacity, 0);
  if (rows.length && section.capacity === null) {
    throw new ValidationError("Set the section's total capacity before sharing it among streams.", { streams: ["Set the section's total capacity first."] });
  }
  if (section.capacity !== null && total > section.capacity) {
    throw new ValidationError(ALLOCATION_TOO_LARGE, { streams: [`${ALLOCATION_TOO_LARGE} (${total} of ${section.capacity})`] });
  }

  const existing = new Set(section.streamAllocations.map((row) => row.streamId));
  const added = ids.filter((streamId) => !existing.has(streamId));
  if (added.length) {
    const known = await ctx.db.stream.count({ where: { id: { in: added }, isActive: true } });
    if (known !== added.length) throw new NotFoundError("That stream was not found.");
  }

  // Removing a share that current students or subject assignments rely on would orphan them.
  const removed = [...existing].filter((streamId) => !ids.includes(streamId));
  if (removed.length) {
    const [students, assignments] = await Promise.all([
      ctx.db.studentEnrollment.count({ where: { sectionId, streamId: { in: removed }, status: "ACTIVE" } }),
      ctx.db.teacherSubjectAssignment.count({ where: { sectionId, streamId: { in: removed } } }),
    ]);
    if (students || assignments) {
      throw new ConflictError(
        `A stream you removed is still in use in this section (${students} current student${students === 1 ? "" : "s"}, ${assignments} subject assignment${assignments === 1 ? "" : "s"}). Move them first, or keep the stream with fewer seats.`,
      );
    }
  }

  await ctx.db.$transaction(async (tx) => {
    if (removed.length) await tx.sectionStream.deleteMany({ where: { sectionId, streamId: { in: removed } } });
    for (const row of rows) {
      if (existing.has(row.streamId)) {
        await tx.sectionStream.updateMany({ where: { sectionId, streamId: row.streamId }, data: { capacity: row.capacity } });
      } else {
        await tx.sectionStream.create({ data: { schoolId: ctx.schoolId, sectionId, streamId: row.streamId, capacity: row.capacity } });
      }
    }
  });

  const plan = await seatPlan(ctx.db, sectionId);
  const warnings = plan.allocations
    .filter((row) => row.occupied > row.capacity)
    .map((row) => `Current enrollment in ${row.name} exceeds the new capacity by ${row.occupied - row.capacity} student${row.occupied - row.capacity === 1 ? "" : "s"}. Existing student assignments will not be changed automatically.`);

  await recordAudit({
    action: "SECTION_UPDATED",
    entityType: "Section",
    entityId: sectionId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Stream seats for ${section.class.name} – ${section.name}: ${plan.allocations.map((row) => `${row.name} ${row.capacity}`).join(", ") || "none"} (${total}${section.capacity !== null ? ` of ${section.capacity}` : ""}).`,
  });
  return { warnings };
}

/**
 * Checks for a change to a section's capacity or whole-section stream, run
 * before the change is saved: the shares must still fit, and a section with
 * shares cannot also be one stream. Returns a warning when current students
 * exceed the new capacity — they stay where they are.
 */
export async function checkSectionChange(db: Db, sectionId: string, next: { capacity: number | null; streamId: string | null }): Promise<string | null> {
  const plan = await seatPlan(db, sectionId);
  if (plan.allocations.length) {
    if (next.streamId) throw new ConflictError("This section's seats are shared among streams. Remove the stream shares before making it one stream.");
    if (next.capacity === null || next.capacity < plan.allocated) {
      throw new ValidationError(ALLOCATION_TOO_LARGE, {
        capacity: [`The streams here already share ${plan.allocated} seats. Lower their shares first, or keep the capacity at ${plan.allocated} or more.`],
      });
    }
  }
  if (next.capacity !== null && plan.occupied > next.capacity) {
    const over = plan.occupied - next.capacity;
    return `Current enrollment exceeds the new capacity by ${over} student${over === 1 ? "" : "s"}. Existing student assignments will not be changed automatically.`;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Placing students
// -----------------------------------------------------------------------------

/** Lock the section row and check its total capacity has room for `adding` more. */
async function lockSection(tx: TenantTx, sectionId: string, adding: number) {
  // An UPDATE takes the row lock for the rest of the transaction, so the
  // count below already includes any admission that committed meanwhile.
  const locked = await tx.section.updateMany({ where: { id: sectionId }, data: { updatedAt: new Date() } });
  if (!locked.count) throw new NotFoundError("That section was not found.");
  const section = await tx.section.findFirstOrThrow({
    where: { id: sectionId },
    select: { name: true, capacity: true, streamId: true, class: { select: { name: true } }, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
  });
  const label = `${section.class.name} – ${section.name}`;
  const occupied = section._count.enrollments;
  if (section.capacity !== null && occupied + adding > section.capacity) {
    throw new ConflictError(
      adding === 1 ? `That section is full (capacity ${section.capacity}).` : `${label} has room for ${Math.max(section.capacity - occupied, 0)} more (capacity ${section.capacity}).`,
    );
  }
  return { label, streamId: section.streamId };
}

/** Lock one stream's share of a section and check it has room for `adding` more. */
async function claimShare(tx: TenantTx, sectionId: string, streamId: string, adding: number, label: string) {
  const share = await tx.sectionStream.updateMany({ where: { sectionId, streamId }, data: { updatedAt: new Date() } });
  if (!share.count) throw new ValidationError("Please correct the highlighted fields.", { streamId: [`That stream / group is not offered in ${label}.`] });
  const [row, occupied] = await Promise.all([
    tx.sectionStream.findFirstOrThrow({ where: { sectionId, streamId }, select: { capacity: true, stream: { select: { name: true } } } }),
    tx.studentEnrollment.count({ where: { sectionId, streamId, status: "ACTIVE" } }),
  ]);
  if (occupied + adding > row.capacity) {
    throw new ConflictError(
      occupied >= row.capacity
        ? `${row.stream.name} in ${label} is full (${row.capacity} seats).`
        : `${row.stream.name} in ${label} has room for ${row.capacity - occupied} more (${row.capacity} seats).`,
    );
  }
}

/**
 * Take a seat in a section — and in a stream, where the section shares its
 * seats — inside the caller's transaction, and return the enrollment's
 * `streamId`:
 *
 *   * a whole-stream section: that stream;
 *   * a section with shares: `requestedStreamId`, which must be one of them
 *     and have room ("Science in Class 9 – A is full" otherwise);
 *   * neither: no stream.
 *
 * Checked here, in the transaction, whatever the form showed: a stream shown
 * as full cannot be taken by posting its id directly.
 */
export async function claimSeats(tx: TenantTx, sectionId: string, requestedStreamId: string | null | undefined): Promise<string | null> {
  const section = await lockSection(tx, sectionId, 1);
  if (section.streamId) return section.streamId;
  const shares = await tx.sectionStream.count({ where: { sectionId } });
  if (!shares) return null;
  if (!requestedStreamId) {
    throw new ValidationError("Please correct the highlighted fields.", { streamId: [`${section.label} is shared among streams. Choose the stream / group.`] });
  }
  await claimShare(tx, sectionId, requestedStreamId, 1, section.label);
  return requestedStreamId;
}

/**
 * Seats for students moving into one section together (promotion, change of
 * section), each keeping their own stream. Returns each student's stream in
 * the destination. A student whose stream the destination does not offer
 * stops the move: they are moved on their own, with a stream chosen.
 */
export async function claimSeatsForGroup(
  tx: TenantTx,
  sectionId: string,
  students: Array<{ studentId: string; streamId: string | null }>,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (!students.length) return result;
  const section = await lockSection(tx, sectionId, students.length);
  const shares = section.streamId ? [] : await tx.sectionStream.findMany({ where: { sectionId }, select: { streamId: true, stream: { select: { name: true } } } });
  if (!shares.length) {
    for (const student of students) result.set(student.studentId, section.streamId);
    return result;
  }
  const offered = new Set(shares.map((row) => row.streamId));
  const missing = students.filter((student) => !student.streamId || !offered.has(student.streamId)).length;
  if (missing) {
    throw new ConflictError(
      `${section.label} is shared among streams (${shares.map((row) => row.stream.name).join(", ")}), and ${missing} of these student${missing === 1 ? " has" : "s have"} no stream offered there. Move them on their own, choosing a stream.`,
    );
  }
  const byStream = new Map<string, number>();
  for (const student of students) byStream.set(student.streamId!, (byStream.get(student.streamId!) ?? 0) + 1);
  for (const [streamId, count] of byStream) await claimShare(tx, sectionId, streamId, count, section.label);
  for (const student of students) result.set(student.studentId, student.streamId);
  return result;
}

// -----------------------------------------------------------------------------
// Who teaches a subject to a student's group
// -----------------------------------------------------------------------------

export type Placement = { academicSessionId: string; sectionId: string; streamId: string | null };

/**
 * The teachers of `subjectId` for one academic group, in the order they were
 * assigned: those assigned to the group's own stream, or — only when nobody
 * is — those assigned to the whole section. A class teacher is never added
 * just for being class teacher.
 */
export async function groupSubjectTeachers(db: Db, placement: Placement, subjectId: string): Promise<string[]> {
  const rows = await db.teacherSubjectAssignment.findMany({
    where: {
      academicSessionId: placement.academicSessionId,
      sectionId: placement.sectionId,
      subjectId,
      teacher: { status: { in: [...CURRENT_EMPLOYEE] } },
      OR: placement.streamId ? [{ streamId: placement.streamId }, { streamId: null }] : [{ streamId: null }],
    },
    orderBy: { createdAt: "asc" },
    select: { teacherId: true, streamId: true },
  });
  const specific = rows.filter((row) => row.streamId !== null);
  return [...new Set((specific.length ? specific : rows).map((row) => row.teacherId))];
}

/**
 * Subjects taught to one academic group, each with its teacher(s) — the
 * same rule as `groupSubjectTeachers`, for a whole group at once.
 */
export async function groupSubjects(db: Db, placement: Placement) {
  const rows = await db.teacherSubjectAssignment.findMany({
    where: {
      academicSessionId: placement.academicSessionId,
      sectionId: placement.sectionId,
      teacher: { status: { in: [...CURRENT_EMPLOYEE] } },
      OR: placement.streamId ? [{ streamId: placement.streamId }, { streamId: null }] : [{ streamId: null }],
    },
    orderBy: { createdAt: "asc" },
    select: { streamId: true, subject: { select: { id: true, name: true } }, teacher: { select: { id: true, firstName: true, lastName: true } } },
  });
  const bySubject = new Map<string, { id: string; name: string; specific: typeof rows; general: typeof rows }>();
  for (const row of rows) {
    const entry = bySubject.get(row.subject.id) ?? { ...row.subject, specific: [], general: [] };
    (row.streamId ? entry.specific : entry.general).push(row);
    bySubject.set(row.subject.id, entry);
  }
  return [...bySubject.values()]
    .map((entry) => ({ id: entry.id, name: entry.name, teachers: (entry.specific.length ? entry.specific : entry.general).map((row) => row.teacher) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "Class 9 – A • Science" — the section, and the stream when the section shares seats among streams. */
export function groupLabel(section: { name: string; class: { name: string }; stream?: { name: string } | null }, stream?: { name: string } | null): string {
  const base = `${section.class.name} – ${section.name}`;
  const name = section.stream?.name ?? stream?.name;
  return name ? `${base} • ${name}` : base;
}
