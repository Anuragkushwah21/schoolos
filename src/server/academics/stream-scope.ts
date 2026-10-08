import "server-only";

import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { TenantContext } from "@/server/auth/current-user";
import { requireTeacherSelf } from "@/server/auth/teacher-access";

/**
 * Streams inside one section, for the timetable and homework.
 *
 * A section is one group unless it shares its seats among streams
 * (`SectionStream`: 11-A with Science, Commerce and Arts). Only then can a
 * period or a piece of homework be for one stream; everywhere else the
 * stream is left empty and nothing changes — streams are never forced.
 *
 * A row with no stream is for the whole section. A student sees whole-section
 * rows and their own stream's rows; a student with no stream in a shared
 * section sees the whole-section ones only.
 */

/** The streams a section is split into; empty when it is one group. */
export async function sectionStreamChoices(ctx: TenantContext, sectionId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await ctx.db.sectionStream.findMany({
    where: { sectionId, stream: { isActive: true } },
    orderBy: { stream: { name: "asc" } },
    select: { stream: { select: { id: true, name: true } } },
  });
  return rows.map((row) => row.stream);
}

/** Every split section's streams at once, keyed by section — for forms. */
export async function streamChoicesBySection(ctx: TenantContext, sectionIds: string[]): Promise<Record<string, Array<{ id: string; name: string }>>> {
  if (!sectionIds.length) return {};
  const rows = await ctx.db.sectionStream.findMany({
    where: { sectionId: { in: sectionIds }, stream: { isActive: true } },
    orderBy: { stream: { name: "asc" } },
    select: { sectionId: true, stream: { select: { id: true, name: true } } },
  });
  const out: Record<string, Array<{ id: string; name: string }>> = {};
  for (const row of rows) (out[row.sectionId] ??= []).push(row.stream);
  return out;
}

/**
 * Check a chosen stream against the section: none for a section that is one
 * group, and only one of its own streams for a split one. Returns the stream
 * to store (null = whole section).
 */
export async function resolveSectionStream(ctx: TenantContext, sectionId: string, streamId: string | null | undefined, label = "This section"): Promise<string | null> {
  if (!streamId) return null;
  const choices = await sectionStreamChoices(ctx, sectionId);
  if (!choices.length) throw new ValidationError("Please correct the highlighted fields.", { streamId: [`${label} is not split into streams. Leave the stream as Whole section.`] });
  if (!choices.some((choice) => choice.id === streamId)) throw new ValidationError("Please correct the highlighted fields.", { streamId: ["Choose one of this section's streams."] });
  return streamId;
}

/** Rows a student sees: the whole section's, and their own stream's. */
export function visibleToStream(streamId: string | null): { OR: Array<{ streamId: string | null }> } {
  return { OR: streamId ? [{ streamId: null }, { streamId }] : [{ streamId: null }] };
}

/** Rows that clash with a period for `streamId`: whole-section ones always; one stream's only with the same stream. */
export function clashesWithStream(streamId: string | null): Record<string, unknown> {
  return streamId ? { OR: [{ streamId: null }, { streamId }] } : {};
}

/**
 * May the signed-in teacher set work for this subject, section and stream?
 * A teacher of the whole section may set it for the section or any of its
 * streams; a teacher assigned to one stream only for that stream. In a
 * section that is one group, any assignment for the subject is enough.
 */
export async function requireStreamTeaching(
  ctx: TenantContext,
  input: { sectionId: string; subjectId: string; streamId: string | null; academicSessionId: string },
): Promise<{ teacherId: string; streamId: string | null }> {
  const teacher = await requireTeacherSelf(ctx);
  const rows = await ctx.db.teacherSubjectAssignment.findMany({
    where: { teacherId: teacher.id, sectionId: input.sectionId, subjectId: input.subjectId, academicSessionId: input.academicSessionId },
    select: { streamId: true, stream: { select: { name: true } } },
  });
  if (!rows.length) throw new ForbiddenError("You do not teach that subject to that class.");
  const streamId = await resolveSectionStream(ctx, input.sectionId, input.streamId);
  const choices = await sectionStreamChoices(ctx, input.sectionId);
  if (!choices.length) return { teacherId: teacher.id, streamId: null };
  if (rows.some((row) => row.streamId === null)) return { teacherId: teacher.id, streamId };
  if (streamId && rows.some((row) => row.streamId === streamId)) return { teacherId: teacher.id, streamId };
  const mine = rows.flatMap((row) => (row.stream ? [row.stream.name] : []));
  throw new ForbiddenError(`You teach this subject to the ${mine.join(", ")} stream${mine.length === 1 ? "" : "s"} only. Choose ${mine.length === 1 ? "that stream" : "one of them"}.`);
}
