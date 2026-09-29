import { z } from "zod";

import { ValidationError } from "@/lib/errors";
import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { importStudents } from "@/server/people/bulk-students";

/**
 * Import students from the CSV template: `{ csv: "..." }`. Every row is
 * validated first; with any error nothing is written and the row errors come
 * back as a 422.
 */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { csv } = await readJson(request, z.object({ csv: z.string().min(1).max(2_000_000) }));
  const result = await importStudents(ctx, csv);
  if (result.errors.length) {
    throw new ValidationError(
      `Nothing was imported. ${result.errors.length} rows need fixing.`,
      Object.fromEntries(result.errors.map((error, index) => [`line ${error.line}#${index}`, [error.message]])),
    );
  }
  return apiSuccess(result, { status: 201 });
});
