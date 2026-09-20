import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { ApiTokenScope } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

/**
 * Bearer tokens for the REST API.
 *
 * A token acts as the user who created it. It carries no role of its own, so
 * it can never do more than that person could, and it dies the moment their
 * account is deactivated or their school stops being ACTIVE — exactly like a
 * session, and for the same reason: revocation has to be immediate.
 *
 * Only the SHA-256 hash is stored. The token is shown once, at creation.
 */

/** Recognisable in logs and pastes, and obviously not a session cookie. */
const TOKEN_PREFIX = "sos_";

export type TokenActor = {
  user: SessionUser;
  tokenId: string;
  scope: ApiTokenScope;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The leading characters shown in listings, e.g. `sos_9fA2…`. */
function displayPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + 4);
}

export function generateApiToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * Resolve a raw bearer token to the user it acts as.
 *
 * Returns null for every failure — unknown, revoked, expired, deactivated
 * owner, school no longer active — so a caller cannot tell them apart.
 */
export async function authenticateApiToken(raw: string | null | undefined): Promise<TokenActor | null> {
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) return null;

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: {
      id: true,
      scope: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          firstName: true,
          lastName: true,
          isActive: true,
          schoolId: true,
          school: { select: { slug: true, name: true, status: true } },
        },
      },
    },
  });

  if (!token || token.revokedAt) return null;
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return null;

  const { user } = token;
  if (!user.isActive) return null;
  if (user.role !== "SUPER_ADMIN" && (!user.schoolId || user.school?.status !== "ACTIVE")) {
    return null;
  }

  // Best effort: a failed touch must never fail the request it is recording.
  void prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    tokenId: token.id,
    scope: token.scope,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      schoolId: user.schoolId,
      schoolSlug: user.school?.slug ?? null,
      schoolName: user.school?.name ?? null,
      schoolStatus: user.school?.status ?? null,
    },
  };
}

// -----------------------------------------------------------------------------
// Management
// -----------------------------------------------------------------------------

/** Tokens belonging to the caller's school, or the platform's own. */
export async function listApiTokens(actor: SessionUser) {
  assertRole(actor, "SCHOOL_ADMIN", "SUPER_ADMIN");

  return prisma.apiToken.findMany({
    where: actor.role === "SUPER_ADMIN" ? { schoolId: null } : { schoolId: actor.schoolId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scope: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });
}

export async function createApiToken(
  actor: SessionUser,
  input: { name: string; scope: ApiTokenScope; expiresAt: Date | null },
): Promise<{ token: string; id: string }> {
  assertRole(actor, "SCHOOL_ADMIN", "SUPER_ADMIN");

  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new ConflictError("Choose an expiry date in the future.");
  }

  const token = generateApiToken();
  const created = await prisma.apiToken.create({
    data: {
      name: input.name,
      tokenHash: hashToken(token),
      prefix: displayPrefix(token),
      scope: input.scope,
      userId: actor.id,
      schoolId: actor.schoolId,
      expiresAt: input.expiresAt,
    },
    select: { id: true },
  });

  await recordAudit({
    action: "API_TOKEN_CREATED",
    entityType: "ApiToken",
    entityId: created.id,
    schoolId: actor.schoolId,
    actorId: actor.id,
    summary: `API token "${input.name}" created (${input.scope.toLowerCase()} access).`,
  });

  return { token, id: created.id };
}

export async function revokeApiToken(actor: SessionUser, tokenId: string): Promise<void> {
  assertRole(actor, "SCHOOL_ADMIN", "SUPER_ADMIN");

  // Scoped by school, so one school's admin cannot revoke another's token.
  const { count } = await prisma.apiToken.updateMany({
    where: {
      id: tokenId,
      revokedAt: null,
      ...(actor.role === "SUPER_ADMIN" ? { schoolId: null } : { schoolId: actor.schoolId }),
    },
    data: { revokedAt: new Date() },
  });
  if (!count) throw new NotFoundError();

  await recordAudit({
    action: "API_TOKEN_REVOKED",
    entityType: "ApiToken",
    entityId: tokenId,
    schoolId: actor.schoolId,
    actorId: actor.id,
    summary: "API token revoked.",
  });
}
