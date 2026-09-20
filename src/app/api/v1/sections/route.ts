import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { AppError } from "@/lib/errors";
import { sectionsQuery } from "@/lib/validation/api";
import { sectionSchema } from "@/lib/validation/school";
import {
  createSection,
  getSection,
  listSections,
  resolveSession,
} from "@/server/academics/structure";

/** Sections of one session — the current one unless `?session=` says otherwise. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx }) => {
  const { session } = readQuery(request, sectionsQuery);
  const resolved = await resolveSession(ctx, session);
  if (!resolved) throw new AppError("CONFLICT", "This school has no academic session yet.");

  return apiSuccess(await listSections(ctx, resolved.id), { meta: { session: resolved } });
});

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, sectionSchema);
  const sectionId = await createSection(ctx, input);
  return apiSuccess(await getSection(ctx, sectionId), { status: 201 });
});
