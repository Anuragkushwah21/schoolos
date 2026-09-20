import { apiSuccess, platformRoute, readJson } from "@/server/api/handler";
import { apiTokenBody } from "@/lib/validation/api";
import { createApiToken, listApiTokens } from "@/server/auth/api-token";

const ROLES = ["SCHOOL_ADMIN", "SUPER_ADMIN"] as const;

/** Tokens belonging to the caller's school (or the platform, for a Super Admin). */
export const GET = platformRoute({ roles: ROLES }, async ({ actor }) =>
  apiSuccess(await listApiTokens(actor.user)),
);

/**
 * Issue a token. The secret is returned once, here, and never again — only its
 * hash is stored.
 */
export const POST = platformRoute({ roles: ROLES }, async ({ request, actor }) => {
  const input = await readJson(request, apiTokenBody);
  const { token, id } = await createApiToken(actor.user, input);
  return apiSuccess({ id, token, scope: input.scope, expiresAt: input.expiresAt }, { status: 201 });
});
