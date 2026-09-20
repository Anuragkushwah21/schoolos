import { z } from "zod";

import { apiSuccess, publicRoute, readJson } from "@/server/api/handler";
import { verifyCode } from "@/server/platform/verification";

const body = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code from the email"),
});

/**
 * Verify a registration's contact address.
 *
 * Open, because the person verifying has no account yet — and it grants
 * nothing: the school stays PENDING until a Super Admin approves it. Wrong,
 * expired and unknown all answer the same way, and five wrong guesses retire
 * the code.
 */
export const POST = publicRoute<{ reference: string }>(async ({ request, params }) => {
  const { code } = await readJson(request, body);
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  await verifyCode(params.reference, code, { ipAddress });
  return apiSuccess({ verified: true, status: "PENDING_REVIEW" });
});
