import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { AppError } from "@/lib/errors";
import { timetableQuery } from "@/lib/validation/api";
import { slotSchema } from "@/lib/validation/timetable";
import { resolveSession } from "@/server/academics/structure";
import { requireSectionAccess } from "@/server/auth/teacher-access";
import { createSlot, getSectionTimetable, getTeacherTimetable } from "@/server/timetable/service";

/**
 * The weekly timetable for one section (`?section=`) or one teacher
 * (`?teacher=`). A teacher asking for a section must be entitled to it.
 */
export const GET = apiRoute(
  { roles: ["SCHOOL_ADMIN", "TEACHER"] },
  async ({ request, ctx }) => {
    const query = readQuery(request, timetableQuery);
    const session = await resolveSession(ctx, query.session);
    if (!session) throw new AppError("CONFLICT", "This school has no academic session yet.");

    if (query.teacher) {
      if (ctx.user.role !== "SCHOOL_ADMIN") {
        throw new AppError("FORBIDDEN", "Use /api/v1/me/timetable for your own week.");
      }
      return apiSuccess(await getTeacherTimetable(ctx, query.teacher, session.id), {
        meta: { session },
      });
    }

    if (!query.section) {
      throw new AppError("VALIDATION", "Pass ?section= or ?teacher=.");
    }

    await requireSectionAccess(ctx, query.section);
    return apiSuccess(await getSectionTimetable(ctx, query.section, session.id), {
      meta: { session },
    });
  },
);

/** Add a period. Clashes for the section or the teacher are refused. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, slotSchema);
  await createSlot(ctx, input);
  const session = await resolveSession(ctx);
  return apiSuccess(await getSectionTimetable(ctx, input.sectionId, session!.id), { status: 201 });
});
