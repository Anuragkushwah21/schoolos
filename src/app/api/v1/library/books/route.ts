import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { bookSchema } from "@/lib/validation/operations";
import { listBooks, saveBook } from "@/server/operations/library";

const query = z.object({ q: z.string().trim().max(100).optional(), category: z.string().trim().max(60).optional() });

/** Titles with copies available. School Admin only. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN", "NON_TEACHING_STAFF"] }, async ({ request, ctx }) => apiSuccess(await listBooks(ctx, readQuery(request, query))));

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN", "NON_TEACHING_STAFF"] }, async ({ request, ctx }) => {
  const id = await saveBook(ctx, await readJson(request, bookSchema, { bookId: undefined }));
  return apiSuccess({ id }, { status: 201 });
});
