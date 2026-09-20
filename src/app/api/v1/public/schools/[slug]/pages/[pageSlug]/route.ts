import { NotFoundError } from "@/lib/errors";
import { apiSuccess, publicRoute } from "@/server/api/handler";
import { getPublicPage, getPublicSchool } from "@/server/website/public";

/** One published page. Unpublished pages are 404s, like pages that do not exist. */
export const GET = publicRoute<{ slug: string; pageSlug: string }>(async ({ params }) => {
  const school = await getPublicSchool(params.slug);
  if (!school) throw new NotFoundError("No such school.");

  const page = await getPublicPage(school.id, params.pageSlug);
  if (!page) throw new NotFoundError("No such page.");

  return apiSuccess(page);
});
