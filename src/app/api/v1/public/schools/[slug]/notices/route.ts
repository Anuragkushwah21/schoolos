import { NotFoundError } from "@/lib/errors";
import { listQuery } from "@/lib/validation/api";
import { apiSuccess, publicRoute, readQuery } from "@/server/api/handler";
import { publicNotices } from "@/server/communication/notices";
import { getPublicSchool } from "@/server/website/public";

/** Notices the school marked public, and only while they are live. */
export const GET = publicRoute<{ slug: string }>(async ({ request, params }) => {
  const school = await getPublicSchool(params.slug);
  if (!school) throw new NotFoundError("No such school.");

  const { limit } = readQuery(request, listQuery);
  return apiSuccess(await publicNotices(school.id, limit ?? 20));
});
