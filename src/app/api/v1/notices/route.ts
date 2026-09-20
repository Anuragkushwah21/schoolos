import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { noticesQuery } from "@/lib/validation/api";
import { noticeSchema } from "@/lib/validation/communication";
import { getNotice, listNoticesForAdmin, saveNotice } from "@/server/communication/notices";

/** Every notice, including drafts. Role-filtered reading is /api/v1/me/notices. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { status } = readQuery(request, noticesQuery);
  return apiSuccess(await listNoticesForAdmin(ctx, status));
});

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(request, noticeSchema, { noticeId: undefined });
  const id = await saveNotice(ctx, input);
  return apiSuccess(await getNotice(ctx, id), { status: 201 });
});
