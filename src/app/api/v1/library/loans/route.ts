import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { issueBookSchema } from "@/lib/validation/operations";
import { issueBook, listLoans } from "@/server/operations/library";

const query = z.object({ view: z.enum(["open", "overdue", "returned", "fines"]).optional(), q: z.string().trim().max(100).optional() });

export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "NON_TEACHING_STAFF"] }, async ({ request, ctx }) => apiSuccess(await listLoans(ctx, readQuery(request, query))));

/** Issue a copy: `{ bookId, borrowerKind, borrowerCode, issuedOn, dueOn }`. */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN", "NON_TEACHING_STAFF"] }, async ({ request, ctx }) =>
  apiSuccess(await issueBook(ctx, await readJson(request, issueBookSchema)), { status: 201 }),
);
