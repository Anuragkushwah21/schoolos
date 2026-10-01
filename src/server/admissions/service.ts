import "server-only";
import { today } from "@/lib/dates";
import { admissionYear, allocateAdmissionNumber, ensureAdmissionCounter } from "@/server/people/admission-number";

import type { AdmissionStatus } from "@/generated/prisma/enums";
import { AppError, ConflictError, NotFoundError, RateLimitedError } from "@/lib/errors";
import type { AdmissionApplicationInput } from "@/lib/validation/website";
import { recordAudit } from "@/server/audit/log";
import { claimSeats } from "@/server/academics/streams";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { PUBLIC_FORM_RATE_LIMIT, rateLimit } from "@/server/auth/rate-limit";
import { isUniqueViolation } from "@/server/db/errors";
import { prisma } from "@/server/db/prisma";
import { assertWithinPlanLimit } from "@/server/platform/limits";

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

export async function submitApplication(
  slug: string,
  input: AdmissionApplicationInput,
  meta: { ipAddress: string | null },
): Promise<{ applicationNumber: string }> {
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
  if (input.website) return { applicationNumber: "APP-RECEIVED" };

  const [session, klass, stream] = await Promise.all([
    prisma.academicSession.findFirst({ where: { schoolId: school.id, isCurrent: true }, select: { id: true, name: true } }),
    prisma.class.findFirst({ where: { id: input.requestedClassId, schoolId: school.id, isActive: true }, select: { id: true, name: true } }),
    input.requestedStreamId
      ? prisma.stream.findFirst({ where: { id: input.requestedStreamId, schoolId: school.id, isActive: true }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  if (!session) throw new AppError("CONFLICT", "This school is not accepting applications right now.");
  // A class or stream id from another school fails here, not at the database.
  if (!klass || (input.requestedStreamId && !stream)) {
    throw new AppError("VALIDATION", "Choose a class from the list.");
  }

  const prefix = `APP-${session.name.slice(0, 4)}-`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const count = await prisma.admissionApplication.count({
      where: { schoolId: school.id, applicationNumber: { startsWith: prefix } },
    });
    const applicationNumber = `${prefix}${String(count + 1 + attempt).padStart(4, "0")}`;

    try {
      const application = await prisma.admissionApplication.create({
        data: {
          schoolId: school.id,
          academicSessionId: session.id,
          applicationNumber,
          studentFirstName: input.studentFirstName,
          studentLastName: input.studentLastName,
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          previousSchool: input.previousSchool,
          parentName: input.parentName,
          parentRelationship: input.parentRelationship,
          parentPhone: input.parentPhone,
          parentEmail: input.parentEmail,
          addressLine: input.addressLine,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          requestedClassId: klass.id,
          requestedStreamId: stream?.id ?? null,
          notes: input.notes,
        },
        select: { id: true },
      });

      await recordAudit({
        action: "ADMISSION_SUBMITTED",
        entityType: "AdmissionApplication",
        entityId: application.id,
        schoolId: school.id,
        summary: `Application ${applicationNumber} received for ${klass.name}.`,
        ipAddress: meta.ipAddress,
      });

      return { applicationNumber };
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

export async function listApplications(ctx: TenantContext, status?: AdmissionStatus) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.admissionApplication.findMany({
    where: status ? { status } : {},
    orderBy: { submittedAt: "desc" },
    take: 200,
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      studentFirstName: true,
      studentLastName: true,
      parentName: true,
      parentPhone: true,
      submittedAt: true,
      requestedClass: { select: { name: true } },
      academicSession: { select: { name: true } },
    },
  });
}

export async function getApplication(ctx: TenantContext, applicationId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const application = await ctx.db.admissionApplication.findFirst({
    where: { id: applicationId },
    include: {
      requestedClass: { select: { id: true, name: true } },
      requestedStream: { select: { name: true } },
      academicSession: { select: { id: true, name: true } },
      reviewedBy: { select: { firstName: true, lastName: true } },
      createdStudent: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!application) throw new NotFoundError();
  return application;
}

const OPEN: AdmissionStatus[] = ["SUBMITTED", "UNDER_REVIEW", "WAITLISTED"];

export async function setApplicationStatus(
  ctx: TenantContext,
  input: { applicationId: string; status: "UNDER_REVIEW" | "WAITLISTED" | "REJECTED"; reviewNotes: string | null },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

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
    summary: `Application marked ${input.status.toLowerCase().replace("_", " ")}.`,
  });
}

/**
 * Accept an application: create the student, their guardian (reusing an
 * existing guardian with the same phone, so siblings share one record) and the
 * enrollment, and mark the application ACCEPTED — all or nothing.
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
  },
): Promise<{ studentId: string }> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertWithinPlanLimit(ctx, "students");

  let result: { studentId: string; name: string; applicationNumber: string };
  try {
    if (!input.admissionNumber) await ensureAdmissionCounter(ctx.schoolId, admissionYear(today()));
    result = await ctx.db.$transaction(async (tx) => {
      const application = await tx.admissionApplication.findFirst({
        where: { id: input.applicationId, status: { in: OPEN } },
      });
      if (!application) throw new ConflictError("This application has already been decided.");

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

      const existingParent = await tx.parent.findFirst({
        where: { phone: application.parentPhone },
        select: { id: true },
      });
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
          status: "ACCEPTED",
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
