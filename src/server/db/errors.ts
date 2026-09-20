/**
 * Recognise Prisma's unique-constraint violation (P2002) without importing the
 * runtime error classes, which differ between the Node and edge builds.
 *
 * Callers turn it into a `ConflictError` with a message that names the field
 * in the user's terms, rather than leaking the constraint name.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Foreign-key violation (P2003): a referenced row is missing or in use. */
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2003"
  );
}
