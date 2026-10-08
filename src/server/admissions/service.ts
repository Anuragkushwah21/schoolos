import "server-only";
import { today } from "@/lib/dates";
import { admissionYear, allocateAdmissionNumber, ensureAdmissionCounter } from "@/server/people/admission-number";

import type { AdmissionSource, AdmissionStatus, AdmissionType } from "@/generated/prisma/enums";
import { AppError, ConflictError, ForbiddenError, NotFoundError, RateLimitedError } from "@/lib/errors";
import type { AdmissionApplicationInput } from "@/lib/validation/website";
import { recordAudit } from "@/server/audit/log";
import { claimSeats } from "@/server/academics/streams";
import type { TenantContext } from "@/server/auth/current-user";
import { assertAdminOrStaffPermission } from "@/server/auth/staff-access";
import { PUBLIC_FORM_RATE_LIMIT, rateLimit } from "@/server/auth/rate-limit";
import { isUniqueViolation } from "@/server/db/errors";
import { prisma } from "@/server/db/prisma";
import { assertWithinPlanLimit } from "@/server/platform/limits";
import { randomUUID } from "node:crypto";

import { formatDate } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { streamProblem } from "@/lib/stream-rules";
import type { PublicApplicationInput } from "@/lib/validation/enquiries";
import { publicPortal, readCustomAnswers } from "@/server/admissions/portal";
import { ValidationError } from "@/lib/errors";
import type { CreateStudentInput } from "@/lib/validation/school";
import { type AdmissionResult, createStudent, phoneKey } from "@/server/people/students";
import { duplicateStudentError, findPossibleDuplicates } from "@/server/people/duplicates";
import { assertCan } from "@/server/auth/permissions";
import { isSchoolLeader } from "@/lib/permissions";

/**
 * Admissions: public applications and the School Admin's review of them.
 *
 * An application is inert contact data. Nothing is created in the school's
 * records until an administrator accepts it, at which point the student,
 * guardian and enrollment are written in one transaction.
 */

// -----------------------------------------------------------------------------
// Public submission
// -----------------------------------------------------------------------------

/** One child, as the public API has always accepted it. */
export async function submitApplication(
  slug: string,
  input: AdmissionApplicationInput,
  meta: { ipAddress: string | null },
): Promise<{ applicationNumber: string }> {
  const { website, studentFirstName, studentLastName, dateOfBirth, gender, previousSchool, requestedClassId, requestedStreamId, ...parent } = input;
  const result = await submitApplications(
    slug,
    { ...parent, website, children: [{ firstName: studentFirstName, lastName: studentLastName, dateOfBirth, gender, previousSchool, classId: requestedClassId, streamId: requestedStreamId }] },
    meta,
  );
  return { applicationNumber: result.applicationNumbers[0]! };
}

/**
 * A parent applies for one or more children at once. Each child becomes their
 * own application — own APP number, status and conversion — tied to their
 * brothers and sisters by a shared family key. Checked here, not just in the
 * browser: the portal must be open, each class on offer, and each stream
 * follow the class rule (Nursery–8 none, 9–10 optional, 11–12 required).
 */
export async function submitApplications(
  slug: string,
  input: PublicApplicationInput,
  meta: { ipAddress: string | null },
  rawAnswers: Record<string, string | undefined> = {},
): Promise<{ applicationNumbers: string[] }> {
  const limited = rateLimit(
    `admission:${meta.ipAddress ?? "unknown"}`,
    PUBLIC_FORM_RATE_LIMIT.limit,
    PUBLIC_FORM_RATE_LIMIT.windowMs,
  );
  if (!limited.allowed) {
    throw new RateLimitedError("Too many applications from this connection. Please try again later.");
  }

  const school = await prisma.school.findFirst({
    where: { slug, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!school) throw new NotFoundError();

  // Honeypot: look successful, store nothing.
  if (input.website) return { applicationNumbers: ["APP-RECEIVED"] };

  const portal = await publicPortal(school.id);
  const session = portal.session;
  if (!session) throw new AppError("CONFLICT", "This school is not accepting applications right now.");
  if (portal.window.state === "UNPUBLISHED") throw new AppError("CONFLICT", "This school is not taking online applications at the moment. Please contact the school office.");
  if (portal.window.state === "NOT_YET") throw new AppError("CONFLICT", `Applications open on ${formatDate(portal.window.opensOn)}.`);
  if (portal.window.state === "CLOSED") throw new AppError("CONFLICT", `Applications closed on ${formatDate(portal.window.closesOn)}.`);

  // A class or stream id from another school (or not on offer) fails here, not at the database.
  const errors: Record<string, string[]> = {};
  input.children.forEach((child, index) => {
    const klass = portal.classes.find((row) => row.id === child.classId);
    if (!klass) {
      errors[`children.${index}.classId`] = ["Choose a class from the list"];
      return;
    }
    if (child.streamId && !portal.streams.some((row) => row.id === child.streamId)) {
      errors[`children.${index}.streamId`] = ["Choose a stream from the list"];
      return;
    }
    const problem = streamProblem(klass.level, child.streamId, klass.name);
    if (problem) errors[`children.${index}.streamId`] = [problem];
  });
  const custom = readCustomAnswers(portal.customFields, rawAnswers);
  Object.assign(errors, custom.errors);
  if (Object.keys(errors).length) throw new ValidationError("Please correct the highlighted fields.", errors);

  const prefix = `APP-${session.name.slice(0, 4)}-`;
  const familyKey = input.children.length > 1 ? randomUUID() : null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const count = await tx.admissionApplication.count({ where: { schoolId: school.id, applicationNumber: { startsWith: prefix } } });
        const rows: Array<{ id: string; applicationNumber: string; className: string }> = [];
        for (const [index, child] of input.children.entries()) {
          const applicationNumber = `${prefix}${String(count + 1 + index + attempt).padStart(5, "0")}`;
          const row = await tx.admissionApplication.create({
            data: {
              schoolId: school.id,
              academicSessionId: session.id,
              applicationNumber,
              familyKey,
              customAnswers: custom.answers.length ? custom.answers : undefined,
              studentFirstName: child.firstName,
              studentLastName: child.lastName,
              dateOfBirth: child.dateOfBirth,
              gender: child.gender,
              previousSchool: child.previousSchool,
              parentName: input.parentName,
              parentRelationship: input.parentRelationship,
              parentPhone: input.parentPhone,
              parentEmail: input.parentEmail,
              addressLine: input.addressLine,
              city: input.city,
              state: input.state,
              postalCode: input.postalCode,
              requestedClassId: child.classId,
              requestedStreamId: child.streamId,
              notes: input.notes,
            },
            select: { id: true },
          });
          rows.push({ id: row.id, applicationNumber, className: portal.classes.find((klass) => klass.id === child.classId)!.name });
        }
        return rows;
      });

      for (const row of created) {
        await recordAudit({
          action: "ADMISSION_SUBMITTED",
          entityType: "AdmissionApplication",
          entityId: row.id,
          schoolId: school.id,
          summary: `Application ${row.applicationNumber} received for ${row.className}${created.length > 1 ? ` (one of ${created.length} children)` : ""}.`,
          ipAddress: meta.ipAddress,
        });
      }
      return { applicationNumbers: created.map((row) => row.applicationNumber) };
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }

  throw new Error("Could not allocate an application number.");
}

// -----------------------------------------------------------------------------
// Review
// -----------------------------------------------------------------------------

export type ApplicationFilters = {
  status?: AdmissionStatus;
  archived?: boolean;
  q?: string;
  source?: AdmissionSource;
  /** "online": sent through the public form; "office": entered by the office before enquiries existed; "drive": entered by teachers in an admission drive. */
  origin?: "online" | "office" | "drive";
};

/**
 * Online applications at each step, for the pipeline strip — current ones
 * only — and how many older office-entered applications there are.
 */
export async function applicationCounts(ctx: TenantContext) {
  await assertAdminOrStaffPermission(ctx, "admissions.view");
  const [byStatus, office] = await Promise.all([
    ctx.db.admissionApplication.groupBy({ by: ["status"], where: { source: "WEBSITE", archivedAt: null }, _count: true }),
    ctx.db.admissionApplication.count({ where: { source: { in: ["WALK_IN", "PHONE", "ADMIN"] }, archivedAt: null } }),
  ]);
  const count = (status: AdmissionStatus) => byStatus.find((row) => row.status === status)?._count ?? 0;
  const statuses = ["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "APPROVED", "CONVERTED", "REJECTED"] as const;
  const counts = Object.fromEntries(statuses.map((status) => [status, count(status)])) as Record<(typeof statuses)[number], number>;
  return { counts, open: counts.SUBMITTED + counts.UNDER_REVIEW + counts.SHORTLISTED + counts.APPROVED, office };
}

/** Enquiries and applications. Archived ones are hidden unless asked for. */
export async function listApplications(ctx: TenantContext, filters: ApplicationFilters | AdmissionStatus = {}) {
  await assertAdminOrStaffPermission(ctx, "admissions.view");
  const f: ApplicationFilters = typeof filters === "string" ? { status: filters } : filters;
  const q = f.q?.trim();
  const rows = await ctx.db.admissionApplication.findMany({
    where: {
      ...(f.status ? { status: f.status } : {}),
      ...(f.source ? { source: f.source } : {}),
      ...(f.origin === "online"
        ? { source: "WEBSITE" as const }
        : f.origin === "office"
          ? { source: { in: ["WALK_IN" as const, "PHONE" as const, "ADMIN" as const] } }
          : f.origin === "drive"
            ? { source: "DRIVE" as const }
            : {}),
      archivedAt: f.archived ? { not: null } : null,
      ...(q
        ? {
            OR: [
              { studentFirstName: { contains: q, mode: "insensitive" } },
              { studentLastName: { contains: q, mode: "insensitive" } },
              { parentName: { contains: q, mode: "insensitive" } },
              { parentPhone: { contains: q } },
              { applicationNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { submittedAt: "desc" },
    take: 200,
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      source: true,
      studentFirstName: true,
      studentLastName: true,
      parentName: true,
      parentPhone: true,
      parentEmail: true,
      submittedAt: true,
      archivedAt: true,
      createdStudentId: true,
      familyKey: true,
      requestedClass: { select: { name: true } },
      requestedStream: { select: { name: true } },
      academicSession: { select: { name: true } },
      followUps: { orderBy: { createdAt: "desc" }, take: 1, select: { nextFollowUpOn: true, createdAt: true } },
    },
  });
  // Brothers and sisters sent in the same form.
  const keys = [...new Set(rows.flatMap((row) => (row.familyKey ? [row.familyKey] : [])))];
  const families = keys.length
    ? await ctx.db.admissionApplication.groupBy({ by: ["familyKey"], where: { familyKey: { in: keys } }, _count: { _all: true } })
    : [];
  return rows.map(({ followUps, ...row }) => ({
    ...row,
    siblings: row.familyKey ? (families.find((family) => family.familyKey === row.familyKey)?._count._all ?? 1) : 1,
    nextFollowUpOn: followUps[0]?.nextFollowUpOn ?? null,
    lastFollowUpAt: followUps[0]?.createdAt ?? null,
  }));
}

export async function getApplication(ctx: TenantContext, applicationId: string) {
  await assertAdminOrStaffPermission(ctx, "admissions.view");
  const application = await ctx.db.admissionApplication.findFirst({
    where: { id: applicationId },
    include: {
      requestedClass: { select: { id: true, name: true } },
      requestedStream: { select: { name: true } },
      academicSession: { select: { id: true, name: true } },
      reviewedBy: { select: { firstName: true, lastName: true } },
      createdStudent: { select: { id: true, firstName: true, lastName: true } },
      followUps: { orderBy: { createdAt: "desc" }, select: { id: true, note: true, nextFollowUpOn: true, createdAt: true, author: { select: { firstName: true, lastName: true } } } },
      drive: { select: { id: true, name: true } },
      assignment: { select: { id: true, sectionId: true, class: { select: { name: true } }, section: { select: { name: true } }, teacher: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!application) throw new NotFoundError();
  const siblings = application.familyKey
    ? await ctx.db.admissionApplication.findMany({
        where: { familyKey: application.familyKey, id: { not: application.id } },
        orderBy: { applicationNumber: "asc" },
        select: { id: true, applicationNumber: true, studentFirstName: true, studentLastName: true, status: true, requestedClass: { select: { name: true } } },
      })
    : [];
  return { ...application, siblings };
}

/** Still being decided. CONVERTED and REJECTED are final. */
const OPEN: AdmissionStatus[] = ["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "APPROVED"];

/**
 * Move an application along: under review, shortlisted, approved — or
 * rejected. Only an approved application can become a student.
 */
export async function setApplicationStatus(
  ctx: TenantContext,
  input: { applicationId: string; status: "UNDER_REVIEW" | "SHORTLISTED" | "APPROVED" | "REJECTED"; reviewNotes: string | null },
): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "admissions.manage");
  // A teacher's admission-drive application is decided by the School Admin only (see drives.ts).
  if (!isSchoolLeader(ctx.user.role) && (await ctx.db.admissionApplication.count({ where: { id: input.applicationId, driveId: { not: null } } }))) {
    throw new ForbiddenError("Applications from an admission drive are decided by the School Admin.");
  }

  const { count } = await ctx.db.admissionApplication.updateMany({
    where: { id: input.applicationId, status: { in: OPEN } },
    data: {
      status: input.status,
      reviewNotes: input.reviewNotes,
      reviewedAt: new Date(),
      reviewedById: ctx.user.id,
    },
  });
  if (!count) throw new ConflictError("This application has already been decided.");

  await recordAudit({
    action: input.status === "REJECTED" ? "ADMISSION_REJECTED" : "ADMISSION_STATUS_CHANGED",
    entityType: "AdmissionApplication",
    entityId: input.applicationId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Application marked ${input.status.toLowerCase().replace("_", " ")}${input.reviewNotes ? `: ${input.reviewNotes}` : ""}.`,
  });
}

/**
 * Accept an application: create the student, their guardian (reusing an
 * existing guardian with the same phone, so siblings share one record) and the
 * enrollment, and mark the application CONVERTED — all or nothing. Only an
 * approved application can be admitted.
 */
export async function acceptApplication(
  ctx: TenantContext,
  input: {
    applicationId: string;
    sectionId: string;
    /** Where the section shares seats among streams; defaults to the stream applied for. */
    streamId?: string | null;
    rollNumber: string | null;
    admissionNumber: string | null;
    reviewNotes: string | null;
    confirmDuplicate?: boolean;
  },
): Promise<{ studentId: string }> {
  assertCan(ctx, "students", "EDIT");
  await assertWithinPlanLimit(ctx, "students");

  // The same child already at the school? Refused until the caller confirms.
  if (!input.confirmDuplicate) {
    const applied = await ctx.db.admissionApplication.findFirst({
      where: { id: input.applicationId },
      select: { studentFirstName: true, studentLastName: true, dateOfBirth: true, parentPhone: true },
    });
    if (applied) {
      const matches = await findPossibleDuplicates(ctx, { firstName: applied.studentFirstName, lastName: applied.studentLastName, dateOfBirth: applied.dateOfBirth, parentPhones: [applied.parentPhone] });
      if (matches.length) throw duplicateStudentError(matches);
    }
  }

  let result: { studentId: string; name: string; applicationNumber: string };
  try {
    if (!input.admissionNumber) await ensureAdmissionCounter(ctx.schoolId, admissionYear(today()));
    result = await ctx.db.$transaction(async (tx) => {
      const application = await tx.admissionApplication.findFirst({
        where: { id: input.applicationId, status: { in: OPEN } },
      });
      if (!application) throw new ConflictError("This application has already been decided.");
      if (application.status !== "APPROVED") throw new ConflictError("Approve the application before admitting the child.");

      const section = await tx.section.findFirst({
        where: { id: input.sectionId, academicSessionId: application.academicSessionId },
        select: { id: true, classId: true },
      });
      if (!section) throw new NotFoundError("Choose a section in the application's academic session.");
      // Seats under lock: the section's, and the stream's share where it has shares.
      const streamId = await claimSeats(tx, section.id, input.streamId || application.requestedStreamId);

      // The school's sequence, allocated in this transaction (see admission-number.ts).
      const admissionNumber = input.admissionNumber ?? (await allocateAdmissionNumber(tx, admissionYear(today())));

      const student = await tx.student.create({
        data: {
          schoolId: ctx.schoolId,
          admissionNumber,
          firstName: application.studentFirstName,
          lastName: application.studentLastName,
          dateOfBirth: application.dateOfBirth,
          gender: application.gender,
          admissionDate: new Date(),
          addressLine: application.addressLine,
          city: application.city,
          state: application.state,
          postalCode: application.postalCode,
          emergencyContactName: application.parentName,
          emergencyContactPhone: application.parentPhone,
        },
        select: { id: true },
      });

      await tx.studentEnrollment.create({
        data: {
          schoolId: ctx.schoolId,
          studentId: student.id,
          academicSessionId: application.academicSessionId,
          sectionId: section.id,
          classId: section.classId,
          streamId,
          rollNumber: input.rollNumber,
        },
      });

      // The family may already be here under the same mobile (however it was
      // typed) or email: link that parent instead of creating a second one.
      const email = application.parentEmail?.toLowerCase() ?? null;
      const existingParent =
        (await tx.parent.findMany({ where: { archivedAt: null }, select: { id: true, phone: true, email: true } })).find(
          (row) => phoneKey(row.phone) === phoneKey(application.parentPhone) || (email !== null && row.email?.toLowerCase() === email),
        ) ?? null;
      const [firstName, ...rest] = application.parentName.trim().split(/\s+/);
      const parentId =
        existingParent?.id ??
        (
          await tx.parent.create({
            data: {
              schoolId: ctx.schoolId,
              firstName: firstName || application.parentName,
              lastName: rest.join(" ") || application.studentLastName,
              phone: application.parentPhone,
              email: application.parentEmail,
              addressLine: application.addressLine,
            },
            select: { id: true },
          })
        ).id;

      await tx.parentStudent.create({
        data: {
          schoolId: ctx.schoolId,
          parentId,
          studentId: student.id,
          relationship: application.parentRelationship,
          isPrimary: true,
        },
      });

      await tx.admissionApplication.updateMany({
        where: { id: application.id },
        data: {
          status: "CONVERTED",
          createdStudentId: student.id,
          reviewedAt: new Date(),
          reviewedById: ctx.user.id,
          reviewNotes: input.reviewNotes,
        },
      });

      return {
        studentId: student.id,
        name: `${application.studentFirstName} ${application.studentLastName}`,
        applicationNumber: application.applicationNumber,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("That admission number or roll number is already in use.");
    throw error;
  }

  await recordAudit({
    action: "ADMISSION_ACCEPTED",
    entityType: "AdmissionApplication",
    entityId: input.applicationId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Application ${result.applicationNumber} accepted; ${result.name} admitted.`,
  });

  return { studentId: result.studentId };
}

// -----------------------------------------------------------------------------
// Notes and calls on an application, archive
// -----------------------------------------------------------------------------

/** A follow-up: what happened, and optionally when to follow up next. */
export async function addFollowUp(ctx: TenantContext, input: { applicationId: string; note: string; nextFollowUpOn: Date | null }): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "admissions.manage");
  const application = await ctx.db.admissionApplication.findFirst({ where: { id: input.applicationId }, select: { id: true, status: true, applicationNumber: true } });
  if (!application) throw new NotFoundError();
  if (input.nextFollowUpOn && input.nextFollowUpOn < today()) throw new AppError("VALIDATION", "The next follow-up must be today or later.");
  await ctx.db.$transaction(async (tx) => {
    await tx.admissionFollowUp.create({ data: { schoolId: ctx.schoolId, applicationId: application.id, note: input.note, nextFollowUpOn: input.nextFollowUpOn, authorId: ctx.user.id } });
    // A brand-new enquiry that has been followed up is being looked at.
    if (application.status === "SUBMITTED") await tx.admissionApplication.updateMany({ where: { id: application.id, status: "SUBMITTED" }, data: { status: "UNDER_REVIEW", reviewedAt: new Date(), reviewedById: ctx.user.id } });
  });
  await recordAudit({ action: "ADMISSION_FOLLOW_UP", entityType: "AdmissionApplication", entityId: application.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Follow-up on ${application.applicationNumber}.` });
}

/**
 * Archive (or restore) an application. Nothing is deleted: the history and
 * the audit trail stay, and an archived application is simply off the list.
 */
export async function setApplicationArchived(ctx: TenantContext, applicationId: string, archived: boolean): Promise<void> {
  assertCan(ctx, "students", "EDIT");
  const application = await ctx.db.admissionApplication.findFirst({ where: { id: applicationId }, select: { id: true, applicationNumber: true, status: true } });
  if (!application) throw new NotFoundError();
  if (archived && OPEN.includes(application.status)) {
    // An open application is decided first, so nobody is left waiting for an answer.
    throw new ConflictError("Reject or convert this application before archiving it.");
  }
  await ctx.db.admissionApplication.updateMany({ where: { id: application.id }, data: archived ? { archivedAt: new Date(), archivedById: ctx.user.id } : { archivedAt: null, archivedById: null } });
  await recordAudit({ action: archived ? "ADMISSION_ARCHIVED" : "ADMISSION_RESTORED", entityType: "AdmissionApplication", entityId: application.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Application ${application.applicationNumber} ${archived ? "archived" : "restored"}.` });
}

// -----------------------------------------------------------------------------
// Convert to student
// -----------------------------------------------------------------------------

/**
 * Everything the "Convert to student" form needs: the enquiry's details as a
 * prefill, the parents already at the school who match its phone or email
 * (so the family is linked, not duplicated), and students who look like the
 * same child.
 */
export async function conversionPlan(ctx: TenantContext, applicationId: string) {
  assertCan(ctx, "students", "VIEW");
  const application = await getApplication(ctx, applicationId);
  const phone = phoneKey(application.parentPhone);
  const email = application.parentEmail?.toLowerCase() ?? null;
  const [parents, lookalikes] = await Promise.all([
    ctx.db.parent.findMany({ where: { archivedAt: null }, select: { id: true, firstName: true, lastName: true, phone: true, email: true } }),
    ctx.db.student.findMany({
      where: {
        firstName: { equals: application.studentFirstName, mode: "insensitive" },
        lastName: { equals: application.studentLastName, mode: "insensitive" },
      },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true, dateOfBirth: true, status: true },
    }),
  ]);
  const matchingParents = parents
    .filter((row) => phoneKey(row.phone) === phone || (email && row.email?.toLowerCase() === email))
    .map((row) => ({ id: row.id, name: fullName(row), phone: row.phone, matchedBy: phoneKey(row.phone) === phone ? "mobile" : "email" }));
  // Same name, different contact: offered, never preselected — the office must check.
  const parentName = application.parentName.trim().toLowerCase().replace(/\s+/g, " ");
  const nameOnlyParents = parents
    .filter((row) => !matchingParents.some((match) => match.id === row.id) && fullName(row).toLowerCase().replace(/\s+/g, " ") === parentName)
    .map((row) => ({ id: row.id, name: fullName(row), phone: row.phone }));
  const sameChild = lookalikes.filter((row) => !application.dateOfBirth || !row.dateOfBirth || row.dateOfBirth.getTime() === application.dateOfBirth.getTime());
  const [first, ...rest] = application.parentName.trim().split(/\s+/);
  return {
    application,
    open: application.status === "APPROVED" && !application.createdStudentId,
    matchingParents,
    nameOnlyParents,
    possibleDuplicates: sameChild.map((row) => ({ id: row.id, name: fullName(row), admissionNumber: row.admissionNumber, status: row.status })),
    prefill: {
      firstName: application.studentFirstName,
      lastName: application.studentLastName,
      gender: application.gender,
      dateOfBirth: application.dateOfBirth,
      addressLine: application.addressLine,
      city: application.city,
      state: application.state,
      postalCode: application.postalCode,
      parentFirstName: first ?? application.parentName,
      parentLastName: rest.join(" ") || application.studentLastName,
      parentPhone: application.parentPhone,
      parentEmail: application.parentEmail,
      relationship: application.parentRelationship,
      requestedClassId: application.requestedClassId,
      requestedStreamId: application.requestedStreamId,
    },
  };
}

/**
 * Turn an enquiry into a student, through the same admission as "Add student"
 * (seats, admission number, parent dedupe, logins). Before that: the enquiry
 * must still be open, and a student who looks like the same child is refused
 * unless the office confirms it is someone else. After: the enquiry is marked
 * admitted and linked to the new student; its history stays.
 */
export async function convertApplication(
  ctx: TenantContext,
  applicationId: string,
  input: CreateStudentInput,
  extra: { admissionType: AdmissionType; confirmNotDuplicate: boolean },
): Promise<AdmissionResult> {
  assertCan(ctx, "students", "EDIT");
  const plan = await conversionPlan(ctx, applicationId);
  if (!plan.open) throw new ConflictError(plan.application.status === "CONVERTED" || plan.application.status === "REJECTED" ? "This application has already been converted or rejected." : "Approve the application before converting it.");
  // Claim the application first — approved and not yet converted becomes
  // CONVERTED — so two clicks cannot admit the same child twice. If the
  // admission then fails, it goes back to approved.
  const previous = plan.application.status;
  const { count } = await ctx.db.admissionApplication.updateMany({
    where: { id: applicationId, status: "APPROVED", createdStudentId: null },
    data: { status: "CONVERTED" },
  });
  if (!count) throw new ConflictError("This application is being converted, or was converted a moment ago.");
  let result: AdmissionResult;
  try {
    // The possible-duplicate check (and its "Add anyway") is createStudent's.
    result = await createStudent(ctx, { ...input, confirmDuplicate: input.confirmDuplicate || extra.confirmNotDuplicate });
  } catch (error) {
    await ctx.db.admissionApplication.updateMany({ where: { id: applicationId, createdStudentId: null }, data: { status: previous } });
    throw error;
  }
  await ctx.db.$transaction([
    ctx.db.student.updateMany({ where: { id: result.studentId }, data: { admissionType: extra.admissionType } }),
    ctx.db.admissionApplication.updateMany({
      where: { id: applicationId },
      data: { createdStudentId: result.studentId, reviewedAt: new Date(), reviewedById: ctx.user.id },
    }),
    ctx.db.admissionFollowUp.create({ data: { schoolId: ctx.schoolId, applicationId, note: `Converted to student ${result.admissionNumber}.`, authorId: ctx.user.id } }),
  ]);
  await recordAudit({
    action: "ADMISSION_CONVERTED",
    entityType: "AdmissionApplication",
    entityId: applicationId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Application ${plan.application.applicationNumber} converted to student ${result.admissionNumber}.`,
  });
  return result;
}
