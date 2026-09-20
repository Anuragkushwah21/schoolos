import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import type { ApiTokenScope } from "@/generated/prisma/enums";
import type { UserRole } from "@/generated/prisma/enums";
import { env } from "@/lib/env";
import {
  AppError,
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import { authenticateApiToken } from "@/server/auth/api-token";
import type { TenantContext } from "@/server/auth/current-user";
import { LOGIN_RATE_LIMIT, rateLimit } from "@/server/auth/rate-limit";
import { SESSION_COOKIE_NAME, type SessionUser, validateSessionToken } from "@/server/auth/session";
import { forSchool } from "@/server/tenancy/scope";

/**
 * The REST API's single entry point.
 *
 * Route files stay declarative: they say which roles may call them and hand
 * back data. Everything that must not be forgotten — authentication, the role
 * check, tenant scoping, read-only tokens, CSRF, error shape, cache headers —
 * happens here, once.
 *
 * Route Handlers are not covered by any page guard, so none of this is
 * duplicated protection: it is the only protection these endpoints have.
 */

// -----------------------------------------------------------------------------
// Responses
// -----------------------------------------------------------------------------

const NO_STORE = {
  "Cache-Control": "private, no-store",
  // Responses are JSON and never rendered; refuse content sniffing anyway.
  "X-Content-Type-Options": "nosniff",
} as const;

export function apiSuccess<T>(data: T, init: { status?: number; meta?: unknown } = {}) {
  return NextResponse.json(
    init.meta === undefined ? { data } : { data, meta: init.meta },
    { status: init.status ?? 200, headers: NO_STORE },
  );
}

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "METHOD_NOT_ALLOWED"
  | "UNSUPPORTED_MEDIA_TYPE";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  extra: { fieldErrors?: Record<string, string[]>; status?: number } = {},
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(extra.fieldErrors ? { fieldErrors: extra.fieldErrors } : {}),
      },
    },
    { status: extra.status ?? STATUS_BY_CODE[code], headers: NO_STORE },
  );
}

// -----------------------------------------------------------------------------
// Authentication
// -----------------------------------------------------------------------------

export type ApiActor = {
  user: SessionUser;
  /** How the caller proved who they are. */
  via: "token" | "session";
  /** Tokens may be read-only; a session can do whatever its user can. */
  scope: ApiTokenScope;
  tokenId: string | null;
};

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value.trim() : null;
}

/**
 * A cookie-authenticated write must come from this site.
 *
 * The session cookie is SameSite=Lax, which already blocks cross-site form
 * posts, but an explicit Origin check costs nothing and does not depend on
 * that one setting staying as it is. Token callers are exempt: a bearer token
 * is not attached by the browser automatically, so there is nothing to forge.
 */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients send no Origin

  try {
    const allowed = new Set([new URL(env.APP_URL).host, request.nextUrl.host]);
    return allowed.has(new URL(origin).host);
  } catch {
    return false;
  }
}

async function authenticate(request: NextRequest): Promise<ApiActor | null> {
  const raw = bearerToken(request);

  if (raw) {
    const actor = await authenticateApiToken(raw);
    return actor ? { user: actor.user, via: "token", scope: actor.scope, tokenId: actor.tokenId } : null;
  }

  // `cookies()` throws outside a request scope; treat that as "no session"
  // rather than an error, so an unauthenticated call is a clean 401.
  let cookieValue: string | undefined;
  try {
    cookieValue = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  } catch {
    return null;
  }

  const user = await validateSessionToken(cookieValue);
  return user ? { user, via: "session", scope: "FULL", tokenId: null } : null;
}

// -----------------------------------------------------------------------------
// Route wrapper
// -----------------------------------------------------------------------------

export type ApiHandlerArgs<P> = {
  request: NextRequest;
  params: P;
  actor: ApiActor;
  /** Present for every role except SUPER_ADMIN, which owns no school. */
  ctx: TenantContext;
};

export type PlatformHandlerArgs<P> = Omit<ApiHandlerArgs<P>, "ctx">;

type RouteOptions = {
  /** Roles allowed to call this endpoint. */
  roles: readonly UserRole[];
};

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function handleError(error: unknown) {
  if (error instanceof ValidationError) {
    return apiError("VALIDATION", error.message, { fieldErrors: error.fieldErrors });
  }
  if (error instanceof AppError) {
    const code = error.code as ApiErrorCode;
    return apiError(code in STATUS_BY_CODE ? code : "INTERNAL", error.message);
  }
  if (error instanceof z.ZodError) {
    return apiError("VALIDATION", "Please correct the highlighted fields.", {
      fieldErrors: fieldErrorsOf(error),
    });
  }

  console.error("[api] unhandled", error);
  return apiError("INTERNAL", "Something went wrong. Please try again.");
}

/**
 * A school-scoped endpoint. The handler receives a `TenantContext` built from
 * the session — never from anything in the URL or body.
 */
export function apiRoute<P = Record<string, never>>(
  options: RouteOptions,
  handler: (args: ApiHandlerArgs<P>) => Promise<NextResponse>,
) {
  return platformRoute<P>(options, async ({ request, params, actor }) => {
    if (!actor.user.schoolId) {
      // SUPER_ADMIN has no school; the platform endpoints are its own tree.
      throw new ForbiddenError("This endpoint belongs to a school. Use /api/v1/platform instead.");
    }

    return handler({
      request,
      params,
      actor,
      ctx: {
        user: actor.user,
        schoolId: actor.user.schoolId,
        schoolSlug: actor.user.schoolSlug ?? "",
        schoolName: actor.user.schoolName ?? "",
        db: forSchool(actor.user.schoolId),
      },
    });
  });
}

/** An endpoint with no tenant: platform governance, or the caller's own account. */
export function platformRoute<P = Record<string, never>>(
  options: RouteOptions,
  handler: (args: PlatformHandlerArgs<P>) => Promise<NextResponse>,
) {
  return async (request: NextRequest, context?: { params?: Promise<P> }) => {
    try {
      const actor = await authenticate(request);

      if (!actor) {
        // Slow down credential stuffing against the API surface too.
        const limited = rateLimit(
          `api-auth:${clientIp(request)}`,
          LOGIN_RATE_LIMIT.limit * 3,
          LOGIN_RATE_LIMIT.windowMs,
        );
        if (!limited.allowed) {
          return apiError("RATE_LIMITED", "Too many failed attempts. Please try again later.");
        }
        throw new UnauthenticatedError("Provide a valid API token or session.");
      }

      if (!options.roles.includes(actor.user.role)) {
        throw new ForbiddenError("Your role cannot use this endpoint.");
      }

      if (UNSAFE_METHODS.has(request.method)) {
        if (actor.scope === "READ") {
          throw new ForbiddenError("This token is read-only.");
        }
        if (actor.via === "session" && !sameOrigin(request)) {
          throw new ForbiddenError("Cross-site requests are not accepted.");
        }
      }

      return await handler({ request, params: ((await context?.params) ?? {}) as P, actor });
    } catch (error) {
      return handleError(error);
    }
  };
}

/** Public endpoints: no authentication, and no tenant context to leak. */
export function publicRoute<P = Record<string, never>>(
  handler: (args: { request: NextRequest; params: P }) => Promise<NextResponse>,
) {
  return async (request: NextRequest, context?: { params?: Promise<P> }) => {
    try {
      return await handler({ request, params: ((await context?.params) ?? {}) as P });
    } catch (error) {
      return handleError(error);
    }
  };
}

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_body";
    (fieldErrors[path] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/**
 * Read and validate a JSON body with the same Zod schema the web form uses,
 * so the API and the UI cannot drift into disagreeing about what is valid.
 */
export async function readJson<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
  /**
   * Fields merged over the body before validation — normally ids taken from
   * the path. The path wins, so a body that names a different record cannot
   * redirect the write.
   */
  overrides: Record<string, unknown> = {},
): Promise<z.infer<S>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new AppError("VALIDATION", "Send a JSON body with Content-Type: application/json.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("VALIDATION", "The request body is not valid JSON.");
  }

  const merged =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), ...overrides }
      : { ...overrides };

  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    throw new ValidationError("Please correct the highlighted fields.", fieldErrorsOf(parsed.error));
  }
  return parsed.data;
}

/** Validate query parameters with a schema, the same way. */
export function readQuery<S extends z.ZodType>(request: NextRequest, schema: S): z.infer<S> {
  const raw: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) raw[key] = value;

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Check the query parameters.", fieldErrorsOf(parsed.error));
  }
  return parsed.data;
}
