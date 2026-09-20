import { apiSuccess, publicRoute } from "@/server/api/handler";
import { maskEmail, sendVerificationCode } from "@/server/platform/verification";

/** Send another code. Throttled per registration, and capped per hour. */
export const POST = publicRoute<{ reference: string }>(async ({ request, params }) => {
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const state = await sendVerificationCode(params.reference, { force: true, ipAddress });

  return apiSuccess(
    state.status === "verified"
      ? { verified: true }
      : { verified: false, email: maskEmail(state.email), canResendInSeconds: state.canResendInSeconds },
  );
});
