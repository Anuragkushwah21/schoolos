import "server-only";

import { CURRENT_STUDENT } from "@/lib/validation/lifecycle";

import { today } from "@/lib/dates";

import type { Prisma } from "@/generated/prisma/client";
import type { Gender, ParentRelationship, StudentStatus } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { CreateStudentInput, UpdateStudentInput } from "@/lib/validation/school";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import type { TenantContext } from "@/server/auth/current-user";
import { requireCurrentSession } from "@/server/academics/structure";
import { isUniqueViolation } from "@/server/db/errors";
import type { TenantDb } from "@/server/tenancy/scope";
import { assertWithinPlanLimit } from "@/server/platform/limits";
import type { Credentials } from "@/server/platform/schools";
import { createPortalUser } from "@/server/people/accounts";
import { changeStudentStatus } from "@/server/people/lifecycle";

/**
 * Students and their guardians, as managed by the School Admin.
 *
 * A student is a person; where they sit this year is an enrollment. Creating a
 * student therefore writes both, and moving them writes only the enrollment.
 */

export const STUDENT_PAGE_SIZE = 25;

type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export async function listStudents(
  ctx: TenantContext,
  filters: {
    q?: string;
    sectionId?: string;
    classId?: string;
    /** CURRENT = active or on leave — the default list; a single status or none (all) otherwise. */
    status?: StudentStatus | "CURRENT";
    gender?: Gender;
    page?: number;
  },
) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const session = await ctx.db.academicSession.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });

  const page = Math.max(1, filters.page ?? 1);
  const enrollmentFilter: Prisma.StudentEnrollmentWhereInput | undefined =
    filters.sectionId || filters.classId
      ? {
          academicSessionId: session?.id ?? "__none__",
          ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
          ...(filters.classId ? { classId: filters.classId } : {}),
        }
      : undefined;

  const where: Prisma.StudentWhereInput = {
    ...(filters.status === "CURRENT" ? { status: { in: [...CURRENT_STUDENT] } } : filters.status ? { status: filters.status } : {}),
    ...(filters.gender ? { gender: filters.gender } : {}),
    ...(enrollmentFilter ? { enrollments: { some: enrollmentFilter } } : {}),
    ...(filters.q
      ? {
          OR: [
            { firstName: { contains: filters.q, mode: "insensitive" } },
            { lastName: { contains: filters.q, mode: "insensitive" } },
            { admissionNumber: { contains: filters.q, mode: "insensitive" } },
            // The parent is often what the office has been given — a mobile
            // number from a caller, or a father's name — so the same box finds
            // the child through them.
            {
              parents: {
                some: {
                  parent: {
                    OR: [
                      { firstName: { contains: filters.q, mode: "insensitive" } },
                      { lastName: { contains: filters.q, mode: "insensitive" } },
                      { phone: { contains: filters.q } },
                      { email: { contains: filters.q, mode: "insensitive" } },
                    ],
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    ctx.db.student.findMany({
      where,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      skip: (page - 1) * STUDENT_PAGE_SIZE,
      take: STUDENT_PAGE_SIZE,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNumber: true,
        gender: true,
        status: true,
        userId: true,
        enrollments: {
          where: { academicSessionId: session?.id ?? "__none__" },
          select: {
            rollNumber: true,
            section: {
              select: { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
            },
          },
        },
        parents: {
          // Primary first, but all of them: the dialog shows the whole family
          // and the cell needs the count.
          orderBy: { isPrimary: "desc" },
          select: {
            relationship: true,
            isPrimary: true,
            parent: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
                user: { select: { id: true, isActive: true } },
                children: {
                  orderBy: { isPrimary: "desc" },
                  select: {
                    relationship: true,
                    isPrimary: true,
                    student: {
                      select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        admissionNumber: true,
                        status: true,
                        enrollments: {
                          where: { academicSession: { isCurrent: true } },
                          select: {
                            rollNumber: true,
                            section: {
                              select: {
                                name: true,
                                class: { select: { name: true } },
                                stream: { select: { name: true } },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    ctx.db.student.count({ where }),
  ]);

  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / STUDENT_PAGE_SIZE)) };
}

export async function getStudentProfile(ctx: TenantContext, studentId: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const student = await ctx.db.student.findFirst({
    where: { id: studentId },
    include: {
      user: { select: { id: true, email: true, isActive: true, lastLoginAt: true } },
      enrollments: {
        orderBy: { academicSession: { startDate: "desc" } },
        select: {
          id: true,
          rollNumber: true,
          status: true,
          enrolledOn: true,
          academicSession: { select: { id: true, name: true, isCurrent: true } },
          section: {
            select: { id: true, name: true, class: { select: { name: true } }, stream: { select: { name: true } } },
          },
        },
      },
      parents: {
        orderBy: { isPrimary: "desc" },
        select: {
          id: true,
          relationship: true,
          isPrimary: true,
          parent: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
              occupation: true,
              addressLine: true,
              user: { select: { id: true, email: true, isActive: true, lastLoginAt: true } },
            },
          },
        },
      },
    },
  });
  if (!student) throw new NotFoundError();

  const current = student.enrollments.find((e) => e.academicSession.isCurrent);
  const attendance = current
    ? await ctx.db.studentAttendance.groupBy({
        by: ["status"],
        where: { studentId: student.id, academicSessionId: current.academicSession.id },
        _count: { _all: true },
      })
    : [];

  return { student, attendance };
}

/** The next free "ADM0001"-style number, used when the admin leaves it blank. */
async function nextAdmissionNumber(db: TenantDb | TenantTx): Promise<string> {
  const rows = await db.student.findMany({
    where: { admissionNumber: { startsWith: "ADM" } },
    select: { admissionNumber: true },
  });
  const highest = rows.reduce((max, row) => {
    const n = Number.parseInt(row.admissionNumber.slice(3), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `ADM${String(highest + 1).padStart(4, "0")}`;
}

/** Resolve a section to the class and stream an enrollment must also carry. */
async function sectionPlacement(db: TenantDb | TenantTx, sectionId: string, academicSessionId: string) {
  const section = await db.section.findFirst({
    where: { id: sectionId, academicSessionId },
    select: { id: true, classId: true, streamId: true, capacity: true, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
  });
  if (!section) throw new NotFoundError("That section is not part of this academic session.");
  return section;
}

async function createGuardian(
  tx: TenantTx,
  schoolId: string,
  input: { firstName: string; lastName: string; phone: string; email: string | null; occupation?: string | null },
) {
  return tx.parent.create({
    data: {
      schoolId,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      email: input.email,
      occupation: input.occupation ?? null,
    },
    select: { id: true },
  });
}

export async function createStudent(ctx: TenantContext, input: CreateStudentInput): Promise<string> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertWithinPlanLimit(ctx, "students");
  const session = await requireCurrentSession(ctx);

  try {
    const studentId = await ctx.db.$transaction(async (tx) => {
      const section = await sectionPlacement(tx, input.sectionId, session.id);
      if (section.capacity !== null && section._count.enrollments >= section.capacity) {
        throw new ConflictError(`That section is full (capacity ${section.capacity}).`);
      }

      const student = await tx.student.create({
        data: {
          schoolId: ctx.schoolId,
          admissionNumber: input.admissionNumber ?? (await nextAdmissionNumber(tx)),
          firstName: input.firstName,
          lastName: input.lastName,
          gender: input.gender,
          dateOfBirth: input.dateOfBirth,
          admissionDate: input.admissionDate,
          bloodGroup: input.bloodGroup,
          addressLine: input.addressLine,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          emergencyContactName: input.emergencyContactName,
          emergencyContactPhone: input.emergencyContactPhone,
        },
        select: { id: true },
      });

      await tx.studentEnrollment.create({
        data: {
          schoolId: ctx.schoolId,
          studentId: student.id,
          academicSessionId: session.id,
          sectionId: section.id,
          classId: section.classId,
          streamId: section.streamId,
          rollNumber: input.rollNumber,
        },
      });

      let parentId: string | null = null;
      if (input.guardianMode === "existing" && input.existingParentId) {
        const parent = await tx.parent.findFirst({ where: { id: input.existingParentId }, select: { id: true } });
        if (!parent) throw new NotFoundError("That guardian was not found.");
        parentId = parent.id;
      } else if (input.guardianMode === "new") {
        parentId = (
          await createGuardian(tx, ctx.schoolId, {
            firstName: input.parentFirstName!,
            lastName: input.parentLastName!,
            phone: input.parentPhone!,
            email: input.parentEmail,
          })
        ).id;
      }

      if (parentId) {
        await tx.parentStudent.create({
          data: {
            schoolId: ctx.schoolId,
            parentId,
            studentId: student.id,
            relationship: (input.relationship ?? "GUARDIAN") as ParentRelationship,
            isPrimary: true,
          },
        });
      }

      return student.id;
    });

    await recordAudit({
      action: "STUDENT_CREATED",
      entityType: "Student",
      entityId: studentId,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Student ${input.firstName} ${input.lastName} admitted.`,
    });

    return studentId;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("That admission number or roll number is already in use.");
    }
    throw error;
  }
}

export async function updateStudent(ctx: TenantContext, input: UpdateStudentInput): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { studentId, status, ...data } = input;

  const existing = await ctx.db.student.findFirst({
    where: { id: studentId },
    select: { id: true, status: true, userId: true },
  });
  if (!existing) throw new NotFoundError();

  try {
    await ctx.db.student.updateMany({ where: { id: studentId }, data });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("That admission number is already in use.");
    throw error;
  }

  // A status sent with the details (older forms, the API) is recorded like
  // any other change: dated today, with its effect on the login and history.
  if (status && status !== existing.status) {
    await changeStudentStatus(ctx, studentId, status, { effectiveDate: today(), reason: "Changed on the student's details", remarks: null, confirmReturn: true });
  }

  await recordAudit({
    action: "STUDENT_UPDATED",
    entityType: "Student",
    entityId: studentId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Student ${data.firstName} ${data.lastName} updated.`,
  });
}

/**
 * Place a student in a section for a session. Within the same session this
 * moves them; for a new session it is promotion — a new row, leaving last
 * year's placement and attendance untouched.
 */
export async function enrollStudent(
  ctx: TenantContext,
  input: { studentId: string; academicSessionId: string; sectionId: string; rollNumber: string | null },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const student = await ctx.db.student.findFirst({
    where: { id: input.studentId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!student) throw new NotFoundError();

  const section = await sectionPlacement(ctx.db, input.sectionId, input.academicSessionId);

  try {
    await ctx.db.studentEnrollment.upsert({
      where: {
        schoolId_studentId_academicSessionId: {
          schoolId: ctx.schoolId,
          studentId: student.id,
          academicSessionId: input.academicSessionId,
        },
      },
      create: {
        schoolId: ctx.schoolId,
        studentId: student.id,
        academicSessionId: input.academicSessionId,
        sectionId: section.id,
        classId: section.classId,
        streamId: section.streamId,
        rollNumber: input.rollNumber,
      },
      update: {
        sectionId: section.id,
        classId: section.classId,
        streamId: section.streamId,
        rollNumber: input.rollNumber,
        status: "ACTIVE",
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("That roll number is already taken in the section.");
    throw error;
  }

  await recordAudit({
    action: "STUDENT_ENROLLED",
    entityType: "Student",
    entityId: student.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${student.firstName} ${student.lastName} placed in a section.`,
  });
}

/**
 * What stands between a student and being erased.
 *
 * The same split as a teacher's. History cannot be undone, so a child who has
 * any is kept and marked Transferred or Graduated instead. A placement and a
 * parent link are not history: they exist only because the student row does,
 * and a child admitted by mistake has both within a second of being added.
 */
async function studentDeletionBlockers(ctx: TenantContext, studentId: string) {
  const [attendance, remarks, results, application] = await Promise.all([
    ctx.db.studentAttendance.count({ where: { studentId } }),
    ctx.db.studentRemark.count({ where: { studentId } }),
    ctx.db.assessmentResult.count({ where: { studentId } }),
    ctx.db.admissionApplication.count({ where: { createdStudentId: studentId } }),
  ]);

  const history: string[] = [];
  if (attendance) history.push(`${attendance} attendance ${attendance === 1 ? "record" : "records"}`);
  if (remarks) history.push(`${remarks} ${remarks === 1 ? "remark" : "remarks"}`);
  if (results) history.push(`${results} assessment ${results === 1 ? "result" : "results"}`);
  if (application) history.push("an admission application on file");

  return history;
}

/**
 * Erase a student, their placements, their parent links and their login.
 *
 * For a child admitted by mistake — a duplicate row, a typed-in test record.
 * Anyone who has been in a register is kept: `status` is how a child who has
 * left is recorded, and it keeps their year intact.
 *
 * The parent row itself survives. A guardian is a person in their own right and
 * usually has siblings still enrolled; only the link to this child goes.
 */
export async function deleteStudent(ctx: TenantContext, studentId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const student = await ctx.db.student.findFirst({
    where: { id: studentId },
    select: { id: true, userId: true, firstName: true, lastName: true, admissionNumber: true },
  });
  if (!student) throw new NotFoundError();

  const history = await studentDeletionBlockers(ctx, student.id);
  if (history.length) {
    throw new ConflictError(
      `${student.firstName} ${student.lastName} has ${history.join(", ")}, which cannot be undone. Set their status to Transferred or Graduated instead — that keeps the record and closes their sign-in.`,
    );
  }

  await ctx.db.$transaction(async (tx) => {
    await tx.parentStudent.deleteMany({ where: { studentId: student.id } });
    await tx.studentEnrollment.deleteMany({ where: { studentId: student.id } });
    await tx.student.deleteMany({ where: { id: student.id } });
    // Sessions and tokens cascade from the user, so this also signs them out.
    if (student.userId) await tx.user.deleteMany({ where: { id: student.userId } });
  });

  await recordAudit({
    action: "STUDENT_DELETED",
    entityType: "Student",
    entityId: student.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Student ${student.firstName} ${student.lastName} (${student.admissionNumber}) deleted.`,
  });
}

// -----------------------------------------------------------------------------
// Guardians
// -----------------------------------------------------------------------------

export async function searchParents(ctx: TenantContext, q?: string) {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  return ctx.db.parent.findMany({
    where: q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
          ],
        }
      : {},
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 200,
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
}

export async function linkGuardian(
  ctx: TenantContext,
  input: {
    studentId: string;
    guardianMode: "existing" | "new";
    existingParentId: string | null;
    parentFirstName: string | null;
    parentLastName: string | null;
    parentPhone: string | null;
    parentEmail: string | null;
    occupation: string | null;
    relationship: ParentRelationship;
    isPrimary: boolean;
  },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  await ctx.db.$transaction(async (tx) => {
    const student = await tx.student.findFirst({ where: { id: input.studentId }, select: { id: true } });
    if (!student) throw new NotFoundError();

    let parentId: string;
    if (input.guardianMode === "existing") {
      const parent = await tx.parent.findFirst({ where: { id: input.existingParentId ?? "" }, select: { id: true } });
      if (!parent) throw new NotFoundError("That guardian was not found.");
      parentId = parent.id;
    } else {
      parentId = (
        await createGuardian(tx, ctx.schoolId, {
          firstName: input.parentFirstName!,
          lastName: input.parentLastName!,
          phone: input.parentPhone!,
          email: input.parentEmail,
          occupation: input.occupation,
        })
      ).id;
    }

    const hasPrimary = await tx.parentStudent.count({ where: { studentId: student.id, isPrimary: true } });
    const isPrimary = input.isPrimary || hasPrimary === 0;

    // At most one primary guardian per child.
    if (isPrimary) {
      await tx.parentStudent.updateMany({ where: { studentId: student.id }, data: { isPrimary: false } });
    }

    try {
      await tx.parentStudent.create({
        data: {
          schoolId: ctx.schoolId,
          parentId,
          studentId: student.id,
          relationship: input.relationship,
          isPrimary,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError("That guardian is already linked to this student.");
      throw error;
    }
  });

  await recordAudit({
    action: "PARENT_LINKED",
    entityType: "Student",
    entityId: input.studentId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: "Parent linked to student.",
  });
}

export async function unlinkGuardian(ctx: TenantContext, linkId: string): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { count } = await ctx.db.parentStudent.deleteMany({ where: { id: linkId } });
  if (!count) throw new NotFoundError();
}

export async function updateParent(
  ctx: TenantContext,
  input: {
    parentId: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    occupation: string | null;
    addressLine: string | null;
  },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { parentId, ...data } = input;
  const { count } = await ctx.db.parent.updateMany({ where: { id: parentId }, data });
  if (!count) throw new NotFoundError();
}

// -----------------------------------------------------------------------------
// Portal access
// -----------------------------------------------------------------------------

export async function grantStudentPortal(
  ctx: TenantContext,
  studentId: string,
  email: string,
): Promise<Credentials> {
  const student = await ctx.db.student.findFirst({
    where: { id: studentId },
    select: { id: true, firstName: true, lastName: true, userId: true, status: true },
  });
  if (!student) throw new NotFoundError();
  if (student.userId) throw new ConflictError("This student already has a login. Reset its password instead.");
  if (student.status !== "ACTIVE") throw new ConflictError("Only active students can be given a login.");

  const { userId, credentials } = await createPortalUser(ctx, {
    email,
    role: "STUDENT",
    firstName: student.firstName,
    lastName: student.lastName,
  });
  await ctx.db.student.updateMany({ where: { id: student.id }, data: { userId } });

  await recordAudit({
    action: "PORTAL_ACCESS_GRANTED",
    entityType: "Student",
    entityId: student.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Student login ${email} issued.`,
  });

  return { ...credentials, label: `Sign-in for ${student.firstName}` };
}

export async function grantParentPortal(
  ctx: TenantContext,
  parentId: string,
  email: string,
): Promise<Credentials> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const parent = await ctx.db.parent.findFirst({
    where: { id: parentId },
    select: { id: true, firstName: true, lastName: true, phone: true, userId: true },
  });
  if (!parent) throw new NotFoundError();
  if (parent.userId) throw new ConflictError("This parent already has a login. Reset its password instead.");

  const { userId, credentials } = await createPortalUser(ctx, {
    email,
    role: "PARENT",
    firstName: parent.firstName,
    lastName: parent.lastName,
    phone: parent.phone,
  });
  await ctx.db.parent.updateMany({ where: { id: parent.id }, data: { userId, email } });

  await recordAudit({
    action: "PORTAL_ACCESS_GRANTED",
    entityType: "Parent",
    entityId: parent.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Parent login ${email} issued.`,
  });

  return { ...credentials, label: `Sign-in for ${parent.firstName} ${parent.lastName}` };
}
