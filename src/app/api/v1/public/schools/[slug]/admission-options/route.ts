import { NotFoundError } from "@/lib/errors";
import { apiSuccess, publicRoute } from "@/server/api/handler";
import { getAdmissionOptions, getPublicSchool } from "@/server/website/public";

/** The classes and streams an application may ask for, and the session. */
export const GET = publicRoute<{ slug: string }>(async ({ params }) => {
  const school = await getPublicSchool(params.slug);
  if (!school) throw new NotFoundError("No such school.");

  return apiSuccess(await getAdmissionOptions(school.id));
});
