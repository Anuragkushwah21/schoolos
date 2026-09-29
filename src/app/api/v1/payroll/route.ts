import { z } from "zod";

import { apiRoute, apiSuccess, readJson, readQuery } from "@/server/api/handler";
import { dateQuery } from "@/lib/validation/api";
import { id } from "@/lib/validation/common";
import { PAYMENT_METHODS } from "@/lib/validation/school";
import { getPayroll, payPayroll } from "@/server/finance/payroll";

const monthQuery = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM").transform((value) => {
  const [year, month] = value.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 1));
});

/** The payroll for `?month=YYYY-MM` (default this month). School Admin only. */
export const GET = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { month } = readQuery(request, z.object({ month: monthQuery.optional() }));
  const now = new Date();
  return apiSuccess(await getPayroll(ctx, month ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))));
});

/**
 * Pay a batch for one month: `{ month, paidOn, method, reference?, entries:
 * [{ teacherId, amountMinor }] }`. All or nothing; nobody is paid twice.
 */
export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const input = await readJson(
    request,
    z.object({
      month: monthQuery,
      paidOn: dateQuery,
      method: z.enum(PAYMENT_METHODS),
      reference: z.string().trim().max(60).nullish().transform((value) => value || null),
      entries: z.array(z.object({ teacherId: id, amountMinor: z.number().int().positive() })).min(1).max(500),
    }),
  );
  return apiSuccess(await payPayroll(ctx, input), { status: 201 });
});
