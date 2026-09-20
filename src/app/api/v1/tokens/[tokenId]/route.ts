import { apiSuccess, platformRoute } from "@/server/api/handler";
import { revokeApiToken } from "@/server/auth/api-token";

/** Revoking takes effect on the token's very next request. */
export const DELETE = platformRoute<{ tokenId: string }>(
  { roles: ["SCHOOL_ADMIN", "SUPER_ADMIN"] },
  async ({ actor, params }) => {
    await revokeApiToken(actor.user, params.tokenId);
    return apiSuccess({ revoked: true });
  },
);
