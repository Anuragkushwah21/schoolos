import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { noticeSchema } from "@/lib/validation/communication";
import { deleteNotice, getNotice, saveNotice } from "@/server/communication/notices";

type Params = { noticeId: string };

export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) =>
  apiSuccess(await getNotice(ctx, params.noticeId)),
);

export const PUT = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) => {
  const input = await readJson(request, noticeSchema, { noticeId: params.noticeId });
  await saveNotice(ctx, input);
  return apiSuccess(await getNotice(ctx, params.noticeId));
});

/** Deleting removes it everywhere; archive instead to keep a record. */
export const DELETE = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx, params }) => {
  await deleteNotice(ctx, params.noticeId);
  return apiSuccess({ deleted: true });
});
