import { apiRoute, apiSuccess } from "@/server/api/handler";
import { getReceipt } from "@/server/finance/receipts";

type Params = { paymentId: string };

/**
 * One fee receipt as data: the school's own branding, the student, the fee
 * breakdown and what this payment left owing. The receipt number is the one
 * stored with the payment, so every call returns the same number.
 *
 * School Admin: any payment of their school. Parent: a linked child's. Staff
 * with COLLECT_FEES: what the fee desk collects. Students never see fees.
 * Anything else is 404.
 */
export const GET = apiRoute<Params>(
  { roles: ["SCHOOL_ADMIN", "PARENT", "NON_TEACHING_STAFF"] },
  async ({ ctx, params }) => apiSuccess(await getReceipt(ctx, params.paymentId)),
);
