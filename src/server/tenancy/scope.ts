import { prisma } from "@/server/db/prisma";

/**
 * Tenant-scoped database access.
 *
 * `forSchool(schoolId)` returns a Prisma client in which every query against a
 * school-owned model is automatically constrained to that school — reads get
 * `where.schoolId`, writes get `data.schoolId`. Scoping is therefore the
 * default rather than something each call site has to remember.
 *
 * The `schoolId` passed here must come from the authenticated session, never
 * from a URL segment, a request body, or a form field.
 *
 * This is the first of two layers. The second is in the schema: every relation
 * between school-owned tables is a composite foreign key on
 * `(schoolId, parentId)`, so PostgreSQL rejects cross-tenant links even on a
 * path this extension does not cover — notably nested writes, where the
 * required `schoolId` must still be supplied explicitly.
 */

/** Models that carry a `schoolId` and must always be filtered by it. */
const TENANT_MODELS = new Set([
  "AcademicSession",
  "ApiToken",
  "AdmissionApplication",
  "Class",
  "ClassSession",
  "Event",
  "Notice",
  "Parent",
  "ParentStudent",
  "SchoolMedia",
  "SchoolPage",
  "Section",
  "Stream",
  "Student",
  "StudentAttendance",
  "StudentEnrollment",
  "Subject",
  "Subscription",
  "Teacher",
  "TeacherAttendance",
  "TeacherSubjectAssignment",
  "TimetableSlot",
  "User",
]);

/** Operations whose `where` selects the rows to act on. */
const WHERE_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "delete",
]);

/** Operations that write new rows and therefore need `schoolId` in `data`. */
const CREATE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
]);

type AnyArgs = Record<string, unknown>;

/**
 * Scope a query on `School` itself, which is keyed by `id` rather than
 * `schoolId`.
 *
 * If the caller asked for a different school, their predicate is kept so the
 * query matches nothing. Simply overwriting `id` would hand them their own
 * school's row in response to a request for someone else's — silently wrong
 * data rather than an empty result.
 */
function scopeSchoolWhere(where: AnyArgs, schoolId: string): AnyArgs {
  const requestedId = where.id;
  const scoped: AnyArgs = { ...where, id: schoolId };

  if (requestedId !== undefined && requestedId !== schoolId) {
    const existing = Array.isArray(where.AND)
      ? where.AND
      : where.AND
        ? [where.AND]
        : [];
    scoped.AND = [...existing, { id: requestedId }];
  }

  return scoped;
}

/**
 * Constrain a query to the session's school.
 *
 * A caller-supplied `schoolId` can never widen the scope. If it names a
 * different school, it is kept as an additional predicate so the query matches
 * nothing — the caller asked about School B and gets no rows, rather than
 * being handed School A's rows in response. Quietly rewriting the filter would
 * answer a question nobody asked.
 */
function scopeWhere(args: AnyArgs, schoolId: string): AnyArgs {
  const where = (args.where ?? {}) as AnyArgs;
  const requested = where.schoolId;
  const scoped: AnyArgs = { ...where, schoolId };

  if (requested !== undefined && requested !== schoolId) {
    const existing = Array.isArray(where.AND)
      ? where.AND
      : where.AND
        ? [where.AND]
        : [];
    scoped.AND = [...existing, { schoolId: requested }];
  }

  return { ...args, where: scoped };
}

function scopeData(args: AnyArgs, schoolId: string): AnyArgs {
  const data = args.data;

  if (Array.isArray(data)) {
    return {
      ...args,
      data: data.map((row) => ({ ...(row as AnyArgs), schoolId })),
    };
  }

  if (data && typeof data === "object") {
    return { ...args, data: { ...(data as AnyArgs), schoolId } };
  }

  return args;
}

export function forSchool(schoolId: string) {
  if (!schoolId) {
    throw new Error("forSchool() requires a schoolId from the session.");
  }

  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // `School` is the tenant itself: it is keyed by `id`, not `schoolId`.
          if (model === "School") {
            if (WHERE_OPERATIONS.has(operation)) {
              const typed = args as AnyArgs;
              const where = (typed.where ?? {}) as AnyArgs;
              const next: AnyArgs = {
                ...typed,
                where: scopeSchoolWhere(where, schoolId),
              };
              return query(next as typeof args);
            }
            return query(args);
          }

          if (!TENANT_MODELS.has(model)) {
            return query(args);
          }

          if (WHERE_OPERATIONS.has(operation)) {
            return query(scopeWhere(args as AnyArgs, schoolId) as typeof args);
          }

          if (CREATE_OPERATIONS.has(operation)) {
            return query(scopeData(args as AnyArgs, schoolId) as typeof args);
          }

          if (operation === "upsert") {
            const typed = args as AnyArgs;
            const create = (typed.create ?? {}) as AnyArgs;
            const next: AnyArgs = {
              ...scopeWhere(typed, schoolId),
              create: { ...create, schoolId },
            };
            return query(next as typeof args);
          }

          // An operation nobody has scoped yet must fail loudly rather than
          // quietly run across every school on the platform.
          throw new Error(
            `Unscoped tenant operation "${model}.${operation}". ` +
              "Add it to src/server/tenancy/scope.ts before using it.",
          );
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forSchool>;
