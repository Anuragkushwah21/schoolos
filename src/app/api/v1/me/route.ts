import { apiSuccess, platformRoute } from "@/server/api/handler";

/** Who the caller is, and how they proved it. The client's sanity check. */
export const GET = platformRoute(
  { roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT"] },
  async ({ actor }) =>
    apiSuccess({
      user: {
        id: actor.user.id,
        email: actor.user.email,
        firstName: actor.user.firstName,
        lastName: actor.user.lastName,
        role: actor.user.role,
      },
      school: actor.user.schoolId
        ? { id: actor.user.schoolId, slug: actor.user.schoolSlug, name: actor.user.schoolName }
        : null,
      auth: { via: actor.via, scope: actor.scope, tokenId: actor.tokenId },
    }),
);
