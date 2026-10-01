import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { renewLoanSchema } from "@/lib/validation/operations";
import { renewLoan } from "@/server/operations/library";

type Params = { issueId: string };

/** Renew a loan still out: `{ dueOn }`. School Admin, or staff who run the library. */
export const POST = apiRoute<Params>({ roles: ["SCHOOL_ADMIN", "NON_TEACHING_STAFF"] }, async ({ request, ctx, params }) => {
  await renewLoan(ctx, await readJson(request, renewLoanSchema, { issueId: params.issueId }));
  return apiSuccess({ ok: true });
});
