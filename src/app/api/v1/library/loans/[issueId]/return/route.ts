import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { returnBookSchema } from "@/lib/validation/operations";
import { returnBook } from "@/server/operations/library";

type Params = { issueId: string };

/** Return a copy: `{ returnedOn, finePaid? }`. The fine is worked out at the school's daily rate. */
export const POST = apiRoute<Params>({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx, params }) =>
  apiSuccess(await returnBook(ctx, await readJson(request, returnBookSchema, { issueId: params.issueId }))),
);
