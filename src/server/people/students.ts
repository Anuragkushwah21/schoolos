import "server-only";

import { CURRENT_STUDENT } from "@/lib/validation/lifecycle";

import { today } from "@/lib/dates";

import type { Prisma } from "@/generated/prisma/client";
import type { Gender, ParentRelationship, StudentStatus } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { CreateStudentInput, UpdateStudentInput } from "@/lib/validation/school";
import { recordAudit } from "@/server/audit/log";
import { assertRole } from "@/server/auth/assert";
import { type LoginInvite, provisionAccount, sendActivation, unusablePasswordHash } from "@/server/auth/account-links";
import { assertLoginEmailFree, type EmailMove, moveLoginEmail } from "@/server/people/accounts";
import { claimSeats } from "@/server/academics/streams";
import { allocateAdmissionNumber, admissionYear, ensureAdmissionCounter, normaliseImportedAdmissionNumber } from "@/server/people/admission-number";
import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/auth/current-user";
import { requireCurrentSession } from "@/server/academics/structure";
import { isUniqueViolation } from "@/server/db/errors";
import type { TenantDb } from "@/server/tenancy/scope";
import { assertWithinPlanLimit } from "@/server/platform/limits";
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
      user: { select: { id: true, email: true, isActive: true, lastLoginAt: true, activatedAt: true } },
      enrollments: {
        orderBy: { academicSession: { startDate: "desc" } },
        select: {
          id: true,
          rollNumber: true,
          status: true,
          enrolledOn: true,
          streamId: true,
          stream: { select: { name: true } },
          academicSession: { select: { id: true, name: true, isCurrent: true } },
          section: {
            select: { id: true, name: true, class: { select: { name: true, level: true } }, stream: { select: { name: true } } },
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
              // getStudentProfile is School Admin only, so the ID proof may be read here.
              idProofType: true,
              idProofNumber: true,
              user: { select: { id: true, email: true, isActive: true, lastLoginAt: true, activatedAt: true } },
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

/** Last ten digits of a phone number — how two ways of writing one number are matched. */
const phoneKey = (phone: string) => phone.replace(/\D/g, "").slice(-10);

export type AdmissionResult = {
  studentId: string;
  admissionNumber: string;
  /** Activation emails sent for logins created with this admission. */
  invites: LoginInvite[];
  /** Plain notes for the office, e.g. why no parent login was made. */
  notes: string[];
};

/**
 * Admit a student: one transaction for the student, their placement, the
 * parent (new or linked) and any logins, then the activation emails.
 *
 *   * Every student has at least one parent or guardian.
 *   * Nursery–Class 5: no student email, mobile or login — refused if sent.
 *   * Class 6–12: student email, mobile and login are optional; a login needs
 *     an email, because activation is by email.
 *   * A parent is provisioned a login when they have an email and none yet;
 *     a parent who already signs in (a sibling's) gets no second email.
 *   * A new parent whose mobile or email matches one already at the school
 *     is refused until the office links them or confirms it is someone else.
 *   * The admission number is allocated in the transaction (see
 *     `admission-number.ts`); a number typed in — for a migration — is kept
 *     if it is free.
 */
export async function createStudent(ctx: TenantContext, input: CreateStudentInput): Promise<AdmissionResult> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  await assertWithinPlanLimit(ctx, "students");
  const session = await requireCurrentSession(ctx);
  const notes: string[] = [];

  const section = await ctx.db.section.findFirst({
    where: { id: input.sectionId, academicSessionId: session.id },
    select: { id: true, class: { select: { level: true, name: true } } },
  });
  if (!section) throw new NotFoundError("That section is not part of this academic session.");
  const senior = section.class.level >= STUDENT_LOGIN_MIN_LEVEL;
  if (!senior && (input.studentEmail || input.studentPhone || input.studentLogin)) {
    throw new ValidationError("Please correct the highlighted fields.", {
      studentEmail: [`Student email, mobile and login are only for Classes 6 to 12. ${section.class.name} is reached through the parent.`],
    });
  }

  // The parent: an existing one of this school, or a new one that is not
  // already here under the same mobile or email.
  let existingParent: { id: string; userId: string | null; email: string | null; firstName: string } | null = null;
  if (input.guardianMode === "existing") {
    existingParent = await ctx.db.parent.findFirst({
      where: { id: input.existingParentId ?? "" },
      select: { id: true, userId: true, email: true, firstName: true },
    });
    if (!existingParent) throw new NotFoundError("That parent was not found at this school.");
  } else if (!input.confirmNewParent) {
    const email = input.parentEmail?.toLowerCase() ?? null;
    // Phones are stored as typed ("97777 00001", "+91-97777-00001"), so they are
    // compared by their digits, not by text. Only this school's parents.
    const candidates = await ctx.db.parent.findMany({ select: { firstName: true, lastName: true, phone: true, email: true } });
    const match = candidates.find((row) => phoneKey(row.phone) === phoneKey(input.parentPhone ?? "") || (email && row.email?.toLowerCase() === email));
    if (match) {
      throw new ValidationError("Please correct the highlighted fields.", {
        parentPhone: [
          `${match.firstName} ${match.lastName} (${match.phone}) is already a parent at this school. Choose "Existing parent" to link them, or tick "This is a different person".`,
        ],
      });
    }
  }

  // Logins: checked before the transaction, so a taken email never undoes the admission.
  const studentEmail = senior ? (input.studentEmail?.toLowerCase() ?? null) : null;
  if (input.studentLogin && studentEmail && (await prisma.user.count({ where: { email: studentEmail } }))) {
    throw new ValidationError("Please correct the highlighted fields.", { studentEmail: [`${studentEmail} already has a SchoolOS login. Use another email.`] });
  }
  const parentEmail = (existingParent ? existingParent.email : input.parentEmail)?.toLowerCase() ?? null;
  let parentLogin = false;
  if (existingParent?.userId) {
    notes.push(`${existingParent.firstName} already has a login and will see this child too.`);
  } else if (!parentEmail) {
    notes.push("No parent login was made because the parent has no email. Add one on the student's page to send an activation link.");
  } else if (await prisma.user.count({ where: { email: parentEmail } })) {
    notes.push(`No parent login was made: ${parentEmail} is already used by another SchoolOS account.`);
  } else {
    parentLogin = true;
  }

  const customNumber = input.admissionNumber ? normaliseImportedAdmissionNumber(input.admissionNumber) : null;
  if (input.admissionNumber && !customNumber) {
    throw new ValidationError("Please correct the highlighted fields.", { admissionNumber: ["Use letters, numbers, - / or _ only (up to 30)."] });
  }
  const year = admissionYear(input.admissionDate);
  if (!customNumber) await ensureAdmissionCounter(ctx.schoolId, year);
  const unusableHash = input.studentLogin || parentLogin ? await unusablePasswordHash() : undefined;

  try {
    const created = await ctx.db.$transaction(async (tx) => {
      const placement = await sectionPlacement(tx, input.sectionId, session.id);
      // The section's seats — and the stream's share, where it has shares — under lock.
      const streamId = await claimSeats(tx, placement.id, input.streamId);
      const admissionNumber = customNumber ?? (await allocateAdmissionNumber(tx, year));

      const student = await tx.student.create({
        data: {
          schoolId: ctx.schoolId,
          admissionNumber,
          firstName: input.firstName,
          lastName: input.lastName,
          gender: input.gender,
          dateOfBirth: input.dateOfBirth,
          admissionDate: input.admissionDate ?? today(),
          bloodGroup: input.bloodGroup,
          addressLine: input.addressLine,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          emergencyContactName: input.emergencyContactName,
          emergencyContactPhone: input.emergencyContactPhone,
          email: studentEmail,
          phone: senior ? input.studentPhone : null,
        },
        select: { id: true },
      });

      await tx.studentEnrollment.create({
        data: {
          schoolId: ctx.schoolId,
          studentId: student.id,
          academicSessionId: session.id,
          sectionId: placement.id,
          classId: placement.classId,
          streamId,
          rollNumber: input.rollNumber,
        },
      });

      const parentId =
        existingParent?.id ??
        (
          await tx.parent.create({
            data: {
              schoolId: ctx.schoolId,
              firstName: input.parentFirstName!,
              lastName: input.parentLastName!,
              phone: input.parentPhone!,
              email: parentEmail,
              addressLine: input.parentAddress,
            },
            select: { id: true },
          })
        ).id;
      await tx.parentStudent.create({
        data: { schoolId: ctx.schoolId, parentId, studentId: student.id, relationship: (input.relationship ?? "GUARDIAN") as ParentRelationship, isPrimary: true },
      });

      // Logins, waiting for activation — in the same transaction as the people they belong to.
      const accounts: Array<{ userId: string; label: string }> = [];
      if (input.studentLogin && studentEmail) {
        const userId = await provisionAccount(tx, { schoolId: ctx.schoolId, email: studentEmail, role: "STUDENT", firstName: input.firstName, lastName: input.lastName, phone: input.studentPhone }, unusableHash);
        await tx.student.updateMany({ where: { id: student.id }, data: { userId } });
        accounts.push({ userId, label: `Student login for ${input.firstName}` });
      }
      if (parentLogin && parentEmail) {
        const parent = await tx.parent.findFirstOrThrow({ where: { id: parentId }, select: { firstName: true, lastName: true, phone: true } });
        const userId = await provisionAccount(tx, { schoolId: ctx.schoolId, email: parentEmail, role: "PARENT", firstName: parent.firstName, lastName: parent.lastName, phone: parent.phone }, unusableHash);
        await tx.parent.updateMany({ where: { id: parentId, userId: null }, data: { userId, email: parentEmail } });
        accounts.push({ userId, label: `Parent login for ${parent.firstName} ${parent.lastName}` });
      }
      return { studentId: student.id, admissionNumber, accounts };
    });

    await recordAudit({
      action: "STUDENT_CREATED",
      entityType: "Student",
      entityId: created.studentId,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Student ${input.firstName} ${input.lastName} admitted as ${created.admissionNumber}.`,
    });

    // After the commit: an email that fails never undoes the admission.
    const invites: LoginInvite[] = [];
    for (const account of created.accounts) invites.push({ ...(await sendActivation(account.userId, ctx.user.id)), label: account.label });
    return { studentId: created.studentId, admissionNumber: created.admissionNumber, invites, notes };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("That admission number or roll number is already in use.");
    }
    throw error;
  }
}

export async function updateStudent(ctx: TenantContext, input: UpdateStudentInput): Promise<EmailMove> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const { studentId, status, email, ...fields } = input;

  const existing = await ctx.db.student.findFirst({
    where: { id: studentId },
    select: {
      id: true,
      status: true,
      userId: true,
      enrollments: { where: { academicSession: { isCurrent: true } }, take: 1, select: { section: { select: { class: { select: { level: true, name: true } } } } } },
    },
  });
  if (!existing) throw new NotFoundError();
  // Student email is for Class 6–12 only (their login address, when they have one).
  const level = existing.enrollments[0]?.section.class.level;
  if (email && level !== undefined && level < STUDENT_LOGIN_MIN_LEVEL) {
    throw new ValidationError("Please correct the highlighted fields.", { email: [`${existing.enrollments[0]!.section.class.name} students have no email; they are reached through their parent.`] });
  }
  if (existing.userId && email !== undefined && !email) {
    throw new ValidationError("Please correct the highlighted fields.", { email: ["This student signs in with their email, so it cannot be left empty."] });
  }
  await assertLoginEmailFree(existing.userId, email);
  const data = email === undefined ? fields : { ...fields, email: email ? email.toLowerCase() : null };

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
    summary: `Student ${fields.firstName} ${fields.lastName} updated.`,
  });
  if (existing.userId) await ctx.db.user.updateMany({ where: { id: existing.userId }, data: { firstName: fields.firstName, lastName: fields.lastName } });
  return moveLoginEmail(ctx, existing.userId, email);
}

/**
 * Place a student in a section for a session. Within the same session this
 * moves them; for a new session it is promotion — a new row, leaving last
 * year's placement and attendance untouched.
 */
export async function enrollStudent(
  ctx: TenantContext,
  input: { studentId: string; academicSessionId: string; sectionId: string; streamId?: string | null; rollNumber: string | null },
): Promise<void> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const student = await ctx.db.student.findFirst({
    where: { id: input.studentId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!student) throw new NotFoundError();

  const section = await sectionPlacement(ctx.db, input.sectionId, input.academicSessionId);

  try {
    await ctx.db.$transaction(async (tx) => {
      const current = await tx.studentEnrollment.findFirst({
        where: { studentId: student.id, academicSessionId: input.academicSessionId },
        select: { id: true, sectionId: true, streamId: true, status: true },
      });
      // Staying in the same seat (a roll-number change) takes no new one.
      const sameSeat = current?.status === "ACTIVE" && current.sectionId === section.id && (input.streamId === undefined || input.streamId === current.streamId);
      const streamId = sameSeat ? current!.streamId : await claimSeats(tx, section.id, input.streamId ?? current?.streamId);
      const placement = { sectionId: section.id, classId: section.classId, streamId, rollNumber: input.rollNumber };
      if (current) {
        await tx.studentEnrollment.updateMany({ where: { id: current.id }, data: { ...placement, status: "ACTIVE" } });
      } else {
        await tx.studentEnrollment.create({ data: { schoolId: ctx.schoolId, studentId: student.id, academicSessionId: input.academicSessionId, ...placement } });
      }
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
  const [attendance, remarks, results, application, charges, payments, support, promoted] = await Promise.all([
    ctx.db.studentAttendance.count({ where: { studentId } }),
    ctx.db.studentRemark.count({ where: { studentId } }),
    ctx.db.assessmentResult.count({ where: { studentId } }),
    ctx.db.admissionApplication.count({ where: { createdStudentId: studentId } }),
    ctx.db.feeCharge.count({ where: { studentId } }),
    ctx.db.feePayment.count({ where: { studentId } }),
    ctx.db.studentSupport.count({ where: { studentId } }),
    // More than one year's placement means they have already moved up once.
    ctx.db.studentEnrollment.count({ where: { studentId } }),
  ]);

  const history: string[] = [];
  if (attendance) history.push(`${attendance} attendance ${attendance === 1 ? "record" : "records"}`);
  if (remarks) history.push(`${remarks} ${remarks === 1 ? "remark" : "remarks"}`);
  if (results) history.push(`${results} assessment ${results === 1 ? "result" : "results"}`);
  if (application) history.push("an admission application on file");
  if (charges || payments) history.push("fee records");
  if (support) history.push("student support records");
  if (promoted > 1) history.push("placements in more than one year");

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
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 200,
    select: { id: true, firstName: true, lastName: true, phone: true, email: true },
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
    withIdProof?: boolean;
    idProofType?: string | null;
    idProofNumber?: string | null;
  },
): Promise<EmailMove> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  // ID proof is sensitive: School Admin only, and changed only when its fields were on the form.
  const { parentId, withIdProof, idProofType, idProofNumber, ...rest } = input;
  const data = withIdProof ? { ...rest, idProofType: idProofType ?? null, idProofNumber: idProofNumber ?? null } : rest;
  const existing = await ctx.db.parent.findFirst({ where: { id: parentId }, select: { userId: true } });
  if (!existing) throw new NotFoundError();
  // A parent who signs in keeps record and login in step: a corrected email moves both.
  await assertLoginEmailFree(existing.userId, data.email);
  if (existing.userId && !data.email) {
    throw new ValidationError("Please correct the highlighted fields.", { email: ["This parent signs in with their email, so it cannot be left empty."] });
  }
  await ctx.db.parent.updateMany({ where: { id: parentId }, data });
  if (existing.userId) await ctx.db.user.updateMany({ where: { id: existing.userId }, data: { firstName: data.firstName, lastName: data.lastName, phone: data.phone } });
  return moveLoginEmail(ctx, existing.userId, data.email);
}

// -----------------------------------------------------------------------------
// Portal access
// -----------------------------------------------------------------------------

/** Student logins exist from Class 6 up; Nursery to Class 5 are reached through their parents. */
export const STUDENT_LOGIN_MIN_LEVEL = 6;

export async function grantStudentPortal(
  ctx: TenantContext,
  studentId: string,
  email: string,
): Promise<LoginInvite> {
  assertRole(ctx.user, "SCHOOL_ADMIN");
  const student = await ctx.db.student.findFirst({
    where: { id: studentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      userId: true,
      status: true,
      enrollments: { where: { academicSession: { isCurrent: true } }, take: 1, select: { class: { select: { level: true, name: true } } } },
    },
  });
  if (!student) throw new NotFoundError();
  if (student.userId) throw new ConflictError("This student already has a login. Send a login email instead.");
  if (student.status !== "ACTIVE") throw new ConflictError("Only active students can be given a login.");
  const klass = student.enrollments[0]?.class;
  if (!klass || klass.level < STUDENT_LOGIN_MIN_LEVEL) {
    throw new ConflictError(`Student logins are for Class 6 to 12. ${klass ? klass.name : "This student"} is reached through the parent's login.`);
  }

  const { userId } = await createPortalUser(ctx, {
    email,
    role: "STUDENT",
    firstName: student.firstName,
    lastName: student.lastName,
  });
  await ctx.db.student.updateMany({ where: { id: student.id }, data: { userId, email } });

  await recordAudit({
    action: "PORTAL_ACCESS_GRANTED",
    entityType: "Student",
    entityId: student.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Student login ${email} created; activation email sent.`,
  });

  return { ...(await sendActivation(userId, ctx.user.id)), label: `Login for ${student.firstName}` };
}

export async function grantParentPortal(
  ctx: TenantContext,
  parentId: string,
  email: string,
): Promise<LoginInvite> {
  assertRole(ctx.user, "SCHOOL_ADMIN");

  const parent = await ctx.db.parent.findFirst({
    where: { id: parentId },
    select: { id: true, firstName: true, lastName: true, phone: true, userId: true },
  });
  if (!parent) throw new NotFoundError();
  if (parent.userId) throw new ConflictError("This parent already has a login. Send a login email instead.");

  const { userId } = await createPortalUser(ctx, {
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
    summary: `Parent login ${email} created; activation email sent.`,
  });

  return { ...(await sendActivation(userId, ctx.user.id)), label: `Login for ${parent.firstName} ${parent.lastName}` };
}
