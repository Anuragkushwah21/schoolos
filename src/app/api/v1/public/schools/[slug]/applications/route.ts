import { admissionApplicationSchema } from "@/lib/validation/website";
import { apiSuccess, publicRoute, readJson } from "@/server/api/handler";
import { submitApplication } from "@/server/admissions/service";

/**
 * Submit an admission application. Open to anyone, and it grants nothing: the
 * row is inert contact data until a School Admin accepts it. Rate-limited per
 * address, and a class from another school is refused.
 */
export const POST = publicRoute<{ slug: string }>(async ({ request, params }) => {
  const input = await readJson(request, admissionApplicationSchema);
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const { applicationNumber } = await submitApplication(params.slug, input, { ipAddress });
  return apiSuccess({ applicationNumber }, { status: 201 });
});
