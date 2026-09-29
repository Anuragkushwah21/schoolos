import { apiRoute, apiSuccess } from "@/server/api/handler";
import { myLoans } from "@/server/operations/library";

/** The signed-in student's own library loans. */
export const GET = apiRoute({ roles: ["STUDENT"] }, async ({ ctx }) => apiSuccess(await myLoans(ctx)));
