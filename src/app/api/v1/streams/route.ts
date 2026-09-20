import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { streamSchema } from "@/lib/validation/school";
import { createStream, listStreams } from "@/server/academics/structure";

export const GET = apiRoute(
  { roles: ["SCHOOL_ADMIN", "TEACHER"] },
  async ({ ctx }) => apiSuccess(await listStreams(ctx)),
);

export const POST = apiRoute({ roles: ["SCHOOL_ADMIN"] }, async ({ request, ctx }) => {
  const { name } = await readJson(request, streamSchema);
  await createStream(ctx, name);
  return apiSuccess(await listStreams(ctx), { status: 201 });
});
