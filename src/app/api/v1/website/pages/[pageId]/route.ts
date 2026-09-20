import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { schoolPageSchema } from "@/lib/validation/website";
import { deletePage, getPage, savePage } from "@/server/website/admin";

type Params = { pageId: string };

export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) =>
  apiSuccess(await getPage(ctx, params.pageId)),
);

export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  await savePage(ctx, await readJson(request, schoolPageSchema, { pageId: params.pageId }));
  return apiSuccess(await getPage(ctx, params.pageId));
});

export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await deletePage(ctx, params.pageId);
  return apiSuccess({ deleted: true });
});
