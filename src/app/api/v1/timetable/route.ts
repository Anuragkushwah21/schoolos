import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { AppError } from "@/lib/errors";
import { timetableQuery } from "@/lib/validation/api";
import { slotSchema } from "@/lib/validation/timetable";
import { resolveSession } from "@/server/academics/structure";
import { requireSectionAccess } from "@/server/auth/teacher-access";
import { createSlot, getRoomTimetable, getSectionTimetable, getTeacherTimetable } from "@/server/timetable/service";

/**
 * The weekly timetable for one section (`?section=`), one teacher
 * (`?teacher=`) or one room (`?room=<roomId>`, School Admin). A teacher asking for a
 * section must be entitled to it.
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
      // Another school's teacher id is not found, not an empty week.
      if (!(await ctx.db.teacher.count({ where: { id: query.teacher } }))) {
        throw new AppError("NOT_FOUND", "That teacher was not found.");
      }
      return apiSuccess(await getTeacherTimetable(ctx, query.teacher, session.id), {
        meta: { session },
      });
    }

    if (query.room) {
      if (ctx.user.role !== "SCHOOL_ADMIN") throw new AppError("FORBIDDEN", "Room timetables are for the school office.");
      // Another school's room id is not found, not an empty week.
      if (!(await ctx.db.room.count({ where: { id: query.room } }))) throw new AppError("NOT_FOUND", "That room was not found.");
      return apiSuccess(await getRoomTimetable(ctx, query.room, session.id), { meta: { session } });
    }

    if (!query.section) {
      throw new AppError("VALIDATION", "Pass ?section=, ?teacher= or ?room=.");
    }

    await requireSectionAccess(ctx, query.section);
    return apiSuccess(await getSectionTimetable(ctx, query.section, session.id), {
      meta: { session },
    });
  },
);

/** Add a period. Clashes for the section, the teacher or the room (`roomId`) are refused. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, slotSchema);
  await createSlot(ctx, input);
  const session = await resolveSession(ctx);
  return apiSuccess(await getSectionTimetable(ctx, input.sectionId, session!.id), { status: 201 });
});
