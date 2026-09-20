import { NotFoundError } from "@/lib/errors";
import { listQuery } from "@/lib/validation/api";
import { apiSuccess, publicRoute, readQuery } from "@/server/api/handler";
import { publicEvents } from "@/server/communication/events";
import { getPublicSchool } from "@/server/website/public";

export const GET = publicRoute<{ slug: string }>(async ({ request, params }) => {
  const school = await getPublicSchool(params.slug);
  if (!school) throw new NotFoundError("No such school.");

  const { limit } = readQuery(request, listQuery);
  return apiSuccess(await publicEvents(school.id, limit ?? 20));
});
