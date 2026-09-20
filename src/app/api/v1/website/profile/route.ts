import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { websiteProfileSchema } from "@/lib/validation/website";
import { getWebsiteProfile, updateWebsiteProfile } from "@/server/website/admin";

/** The school's own public profile and branding. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ ctx }) =>
  apiSuccess(await getWebsiteProfile(ctx)),
);

export const PUT = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  await updateWebsiteProfile(ctx, await readJson(request, websiteProfileSchema));
  return apiSuccess(await getWebsiteProfile(ctx));
});
