import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { schoolPageSchema } from "@/lib/validation/website";
import { listPages, savePage } from "@/server/website/admin";

export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx }) =>
  apiSuccess(await listPages(ctx)),
);

/** `body` is Markdown-ish plain text; it is rendered without ever becoming HTML. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  await savePage(ctx, await readJson(request, schoolPageSchema, { pageId: undefined }));
  return apiSuccess(await listPages(ctx), { status: 201 });
});
