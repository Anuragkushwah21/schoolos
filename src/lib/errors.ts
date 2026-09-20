/**
 * Application error types.
 *
 * Everything thrown deliberately by the server layer is an `AppError`. The
 * boundary that renders errors shows `AppError.message` (written to be safe
 * for end users) and replaces anything else with a generic message, so that
 * database errors, SQL fragments, and stack traces never reach a browser.
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

/** The caller is not signed in at all. */
export class UnauthenticatedError extends AppError {
  constructor(message = "You need to sign in to continue.") {
    super("UNAUTHENTICATED", message);
    this.name = "UnauthenticatedError";
  }
}

/**
 * The caller is signed in but may not do this.
 *
 * Note the deliberately vague default message: a cross-tenant access attempt
 * must not reveal whether the target resource exists.
 */
export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource.") {
    super("FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.") {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    message = "Please correct the highlighted fields.",
    fieldErrors: Record<string, string[]> = {},
  ) {
    super("VALIDATION", message);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export class ConflictError extends AppError {
  constructor(message = "That record already exists.") {
    super("CONFLICT", message);
    this.name = "ConflictError";
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many attempts. Please try again later.") {
    super("RATE_LIMITED", message);
    this.name = "RateLimitedError";
  }
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * Convert any thrown value into a message that is safe to show a user.
 * Unknown errors are logged server-side and flattened to a generic string.
 */
export function toSafeMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }

  console.error("[unhandled]", error);
  return GENERIC_MESSAGE;
}
