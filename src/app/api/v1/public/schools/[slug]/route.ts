import { NotFoundError } from "@/lib/errors";
import { apiSuccess, publicRoute } from "@/server/api/handler";
import { getGallery, getPublicPages, getPublicSchool } from "@/server/website/public";

/**
 * A school's public profile. Only ACTIVE schools exist here, and only columns
 * meant for the public are selected — the registration contact, subscription
 * and review trail are not among them.
 */
export const GET = publicRoute<{ slug: string }>(async ({ params }) => {
  const school = await getPublicSchool(params.slug);
  if (!school) throw new NotFoundError("No such school.");

  const [pages, gallery] = await Promise.all([getPublicPages(school.id), getGallery(school.id)]);
  return apiSuccess({ school, pages, gallery });
});
