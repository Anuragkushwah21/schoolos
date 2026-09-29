import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { handleComplaintSchema } from "@/lib/validation/complaints";
import { getComplaint, handleComplaint } from "@/server/communication/complaints";

type Params = { complaintId: string };

export const GET = apiRoute<Params>({ roles: ["SCHOOL_ADMIN", "TEACHER", "PARENT", "STUDENT"] }, async ({ ctx, params }) =>
  apiSuccess(await getComplaint(ctx, params.complaintId)),
);

/** Update status, assignment (office only) and response: `{ status, assignedToId?, response? }`. */
export const PATCH = apiRoute<Params>({ roles: ["SCHOOL_ADMIN", "TEACHER"] }, async ({ request, ctx, params }) => {
  await handleComplaint(ctx, await readJson(request, handleComplaintSchema, { complaintId: params.complaintId }));
  return apiSuccess(await getComplaint(ctx, params.complaintId));
});
