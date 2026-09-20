import { registerSchoolSchema } from "@/lib/validation/platform";
import { apiSuccess, publicRoute, readJson } from "@/server/api/handler";
import { registerSchool } from "@/server/platform/registration";

/**
 * Register a school. Creates a PENDING school and nothing else: no account
 * exists, and nobody can sign in, until a Super Admin approves it.
 *
 * A one-time code goes to the contact address; the registration cannot be
 * approved until it is verified through `/registrations/{reference}/verify`.
 */
export const POST = publicRoute(async ({ request }) => {
  const input = await readJson(request, registerSchoolSchema);
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const { reference } = await registerSchool(input, { ipAddress });
  return apiSuccess(
    {
      reference,
      status: "PENDING",
      nextStep: {
        verifyEmail: `/api/v1/public/registrations/${reference}/verify`,
        resendCode: `/api/v1/public/registrations/${reference}/resend`,
      },
    },
    { status: 201 },
  );
});
