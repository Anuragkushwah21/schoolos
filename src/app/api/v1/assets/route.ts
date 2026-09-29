import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { ASSET_CATEGORIES, ASSET_STATUSES, assetSchema } from "@/lib/validation/operations";
import { listAssets, saveAsset } from "@/server/operations/inventory";

const query = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  location: z.string().trim().max(80).optional(),
});

/** The school's assets. School Admin only. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => apiSuccess(await listAssets(ctx, readQuery(request, query))));

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const id = await saveAsset(ctx, await readJson(request, assetSchema, { assetId: undefined }));
  return apiSuccess({ id }, { status: 201 });
});
