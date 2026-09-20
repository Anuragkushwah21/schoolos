import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { mediaSchema } from "@/lib/validation/website";
import { addMedia, listMedia } from "@/server/website/admin";

export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx }) =>
  apiSuccess(await listMedia(ctx)),
);

/** Gallery photos are https links to images the school already hosts. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  await addMedia(ctx, await readJson(request, mediaSchema));
  return apiSuccess(await listMedia(ctx), { status: 201 });
});
