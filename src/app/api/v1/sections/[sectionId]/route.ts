import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { updateSectionSchema } from "@/lib/validation/school";
import { deleteSection, getSection, updateSection } from "@/server/academics/structure";

type Params = { sectionId: string };

/** A section with its roster and subject teachers. */
export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) =>
  apiSuccess(await getSection(ctx, params.sectionId)),
);

export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const { sectionId, ...input } = await readJson(request, updateSectionSchema, {
    sectionId: params.sectionId,
  });
  await updateSection(ctx, sectionId, input);
  return apiSuccess(await getSection(ctx, sectionId));
});

/** Only an empty section can be deleted; anything with history is kept. */
export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await deleteSection(ctx, params.sectionId);
  return apiSuccess({ deleted: true });
});
