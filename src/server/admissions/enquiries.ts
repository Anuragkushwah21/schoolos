import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AdmissionType, DiscountKind, EnquiryStatus } from "@/generated/prisma/enums";
import { addDays, schoolInstant, today } from "@/lib/dates";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { discountMinorFor, discountProblem, familyTotals, shareFamilyDiscount } from "@/lib/fee-discussion";
import { fullName } from "@/lib/format";
import { streamProblem, streamRuleForLevel } from "@/lib/stream-rules";
import type { ChildFeeInput, CreateEnquiryInput, EnquiryChildInput, FamilyFeeInput, UpdateEnquiryInput } from "@/lib/validation/enquiries";
import type { CreateStudentInput } from "@/lib/validation/school";
import type { TenantTx } from "@/server/academics/streams";
import { recordAudit } from "@/server/audit/log";
import type { TenantContext } from "@/server/auth/current-user";
import { assertAdminOrStaffPermission, staffHolds } from "@/server/auth/staff-access";
import { isUniqueViolation } from "@/server/db/errors";
import { type AdmissionResult, createStudent, phoneKey } from "@/server/people/students";
import { assertCan } from "@/server/auth/permissions";
import { isSchoolLeader } from "@/lib/permissions";

/**
 * Family enquiries — a lead, never an admission or a fee.
 *
 * One parent or guardian, one or more children, each child with their own
 * class, stream (Nursery–8 none, 9–10 optional, 11–12 required) and fee
 * discussion. The fee discussion is a negotiation record: nothing here
 * creates or changes a real fee. Only after a child is admitted, and only on
 * the office's explicit confirmation, does an agreed discount become a
 * concession on that child's own fee — through the existing fee system.
 *
 * School Admin only, and everything goes through the tenant-scoped client,
 * so another school's enquiry, class, stream or parent resolves to nothing.
 */

const OPEN: EnquiryStatus[] = ["NEW", "CONTACTED", "FOLLOW_UP"];
const INVALID = "Please correct the highlighted fields.";
const rupees = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const childName = (child: { firstName: string; lastName: string | null }) => [child.firstName, child.lastName].filter(Boolean).join(" ");

/**
 * What the form typed as it is stored: rupees → paise for FIXED, a percentage
 * → basis points for PERCENT (both are × 100).
 */
function storedDiscountValue(kind: DiscountKind, typed: number | null): number {
  if (kind === "NONE" || typed === null) return 0;
  return Math.round(typed * 100);
}

/** A child's fee columns from what was typed, or the problem with them (keyed by field). */
function childFeeColumns(input: { feeOriginal: number | null; discountKind: DiscountKind; discountValue: number | null; discountReason: string | null }) {
  if (input.feeOriginal === null) {
    if (input.discountKind !== "NONE") return { error: { field: "feeOriginal", message: "Enter the discussed fee before a discount" } } as const;
    return { columns: null } as const;
  }
  const value = storedDiscountValue(input.discountKind, input.discountValue);
  const problem = discountProblem(input.feeOriginal, input.discountKind, value);
  if (problem) return { error: { field: "discountValue", message: problem } } as const;
  const discountMinor = discountMinorFor(input.feeOriginal, input.discountKind, value);
  return {
    columns: {
      feeOriginalMinor: input.feeOriginal,
      discountKind: input.discountKind,
      discountValue: value,
      discountMinor,
      finalMinor: input.feeOriginal - discountMinor,
      discountReason: input.discountKind === "NONE" ? null : input.discountReason,
      feeUpdatedAt: new Date(),
    },
  } as const;
}

/**
 * Check every child's class and stream against this school's own classes and
 * streams and the class rule. Errors come back on the child's own fields.
 */
async function resolveChildren(ctx: TenantContext, children: EnquiryChildInput[], prefix = "children") {
  const [classes, streams] = await Promise.all([
    ctx.db.class.findMany({ where: { id: { in: children.map((child) => child.classId) }, isActive: true }, select: { id: true, name: true, level: true } }),
    ctx.db.stream.findMany({ where: { id: { in: children.flatMap((child) => (child.streamId ? [child.streamId] : [])) }, isActive: true }, select: { id: true } }),
  ]);
  const errors: Record<string, string[]> = {};
  const levels = new Map<string, { name: string; level: number }>();
  children.forEach((child, index) => {
    const klass = classes.find((row) => row.id === child.classId);
    if (!klass) {
      errors[`${prefix}.${index}.classId`] = ["Choose a class from the list"];
      return;
    }
    levels.set(child.classId, klass);
    if (child.streamId && !streams.some((row) => row.id === child.streamId)) {
      errors[`${prefix}.${index}.streamId`] = ["Choose a stream from the list"];
      return;
    }
    const problem = streamProblem(klass.level, child.streamId, klass.name);
    if (problem) errors[`${prefix}.${index}.streamId`] = [problem];
  });
  return { errors, levels };
}

async function nextEnquiryNumber(ctx: TenantContext, sessionName: string, attempt: number): Promise<string> {
  const prefix = `ENQ-${sessionName.slice(0, 4)}-`;
  const count = await ctx.db.enquiry.count({ where: { enquiryNumber: { startsWith: prefix } } });
  return `${prefix}${String(count + 1 + attempt).padStart(5, "0")}`;
}

async function requireAssignee(ctx: TenantContext, userId: string | null) {
  if (!userId) return null;
  const user = await ctx.db.user.findFirst({ where: { id: userId, role: "SCHOOL_ADMIN", isActive: true }, select: { id: true } });
  if (!user) throw new ValidationError(INVALID, { assignedToId: ["Choose someone from the school office"] });
  return user.id;
}

/** An enquiry as taken by someone who may not discuss fees: every fee figure left blank. */
function withoutFees(input: CreateEnquiryInput): CreateEnquiryInput {
  return {
    ...input,
    children: input.children.map((child) => ({ ...child, feeOriginal: null, discountKind: "NONE", discountValue: null, discountReason: null })),
    familyDiscountKind: "NONE",
    familyDiscountValue: null,
    familyDiscountReason: null,
  };
}

/** The family discount, worked out again from the children's current figures. */
async function refreshFamilyDiscount(tx: TenantTx, enquiryId: string) {
  const enquiry = await tx.enquiry.findFirst({
    where: { id: enquiryId },
    select: { familyDiscountKind: true, familyDiscountValue: true, children: { select: { status: true, feeOriginalMinor: true, discountMinor: true, finalMinor: true } } },
  });
  if (!enquiry) return;
  const totals = familyTotals(enquiry.children, { kind: enquiry.familyDiscountKind, value: enquiry.familyDiscountValue });
  await tx.enquiry.updateMany({ where: { id: enquiryId }, data: { familyDiscountMinor: totals.familyDiscountMinor } });
}

/** CONVERTED once no child is still open and at least one was admitted. */
async function refreshEnquiryStatus(tx: TenantTx, enquiryId: string) {
  const children = await tx.enquiryChild.findMany({ where: { enquiryId }, select: { status: true } });
  if (children.some((child) => child.status === "ADMITTED") && !children.some((child) => child.status === "OPEN")) {
    await tx.enquiry.updateMany({ where: { id: enquiryId, status: { in: OPEN } }, data: { status: "CONVERTED" } });
  }
}

// -----------------------------------------------------------------------------
// Create and edit
// -----------------------------------------------------------------------------

export async function createEnquiry(ctx: TenantContext, asked: CreateEnquiryInput): Promise<string> {
  await assertAdminOrStaffPermission(ctx, "enquiries.manage");
  // The fee discussion needs its own permission; without it a new enquiry is
  // taken with no fee figures, whatever the form sent.
  const input = isSchoolLeader(ctx.user.role) || (await staffHolds(ctx, "enquiries.fees")) ? asked : withoutFees(asked);
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
  if (!session) throw new AppError("CONFLICT", "Set up the current academic session first.");

  const { errors } = await resolveChildren(ctx, input.children);
  const fees = input.children.map((child, index) => {
    const result = childFeeColumns(child);
    if ("error" in result && result.error) errors[`children.${index}.${result.error.field}`] = [result.error.message];
    return "columns" in result ? result.columns : null;
  });
  const familyValue = storedDiscountValue(input.familyDiscountKind, input.familyDiscountValue);
  const subtotal = fees.reduce((sum, fee) => sum + (fee?.finalMinor ?? 0), 0);
  if (input.familyDiscountKind !== "NONE") {
    const problem = subtotal ? discountProblem(subtotal, input.familyDiscountKind, familyValue) : "Enter the children's discussed fees before a family discount";
    if (problem) errors.familyDiscountValue = [problem];
  }
  if (input.nextFollowUpOn && input.nextFollowUpOn < today()) errors.nextFollowUpOn = ["The next follow-up must be today or later"];
  if (Object.keys(errors).length) throw new ValidationError(INVALID, errors);
  const assignedToId = await requireAssignee(ctx, input.assignedToId);

  const totals = familyTotals(
    fees.map((fee) => ({ feeOriginalMinor: fee?.feeOriginalMinor ?? null, discountMinor: fee?.discountMinor ?? 0, finalMinor: fee?.finalMinor ?? null })),
    { kind: input.familyDiscountKind, value: familyValue },
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const enquiryNumber = await nextEnquiryNumber(ctx, session.name, attempt);
    try {
      const enquiryId = await ctx.db.$transaction(async (tx) => {
        const enquiry = await tx.enquiry.create({
          data: {
            schoolId: ctx.schoolId,
            academicSessionId: session.id,
            enquiryNumber,
            source: input.source,
            status: input.nextFollowUpOn ? "FOLLOW_UP" : "NEW",
            parentName: input.parentName,
            relationship: input.relationship,
            phone: input.phone,
            alternatePhone: input.alternatePhone,
            email: input.email,
            addressLine: input.addressLine,
            city: input.city,
            state: input.state,
            postalCode: input.postalCode,
            notes: input.notes,
            nextFollowUpOn: input.nextFollowUpOn,
            nextAction: input.nextAction,
            assignedToId,
            feeStatus: fees.some(Boolean) ? "DISCUSSING" : "NOT_STARTED",
            familyDiscountKind: totals.discussedChildren ? input.familyDiscountKind : "NONE",
            familyDiscountValue: totals.discussedChildren ? familyValue : 0,
            familyDiscountMinor: totals.familyDiscountMinor,
            familyDiscountReason: input.familyDiscountKind === "NONE" ? null : input.familyDiscountReason,
            discussionNotes: input.discussionNotes,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
          select: { id: true },
        });
        for (const [index, child] of input.children.entries()) {
          const fee = fees[index];
          const row = await tx.enquiryChild.create({
            data: {
              schoolId: ctx.schoolId,
              enquiryId: enquiry.id,
              position: index,
              firstName: child.firstName,
              lastName: child.lastName,
              dateOfBirth: child.dateOfBirth,
              gender: child.gender,
              classId: child.classId,
              streamId: child.streamId,
              previousSchool: child.previousSchool,
              notes: child.notes,
              ...(fee ?? {}),
              createdById: ctx.user.id,
              updatedById: ctx.user.id,
            },
            select: { id: true },
          });
          if (fee) {
            await tx.enquiryFeeRevision.create({
              data: { schoolId: ctx.schoolId, enquiryId: enquiry.id, childId: row.id, childName: childName(child), originalMinor: fee.feeOriginalMinor, discountKind: fee.discountKind, discountValue: fee.discountValue, discountMinor: fee.discountMinor, finalMinor: fee.finalMinor, reason: fee.discountReason, changedById: ctx.user.id },
            });
          }
        }
        if (totals.familyDiscountMinor) {
          await tx.enquiryFeeRevision.create({
            data: { schoolId: ctx.schoolId, enquiryId: enquiry.id, originalMinor: totals.subtotalMinor, discountKind: input.familyDiscountKind, discountValue: familyValue, discountMinor: totals.familyDiscountMinor, finalMinor: totals.finalMinor, reason: input.familyDiscountReason, notes: input.discussionNotes, changedById: ctx.user.id },
          });
        }
        return enquiry.id;
      });
      await recordAudit({
        action: "ENQUIRY_CREATED",
        entityType: "Enquiry",
        entityId: enquiryId,
        schoolId: ctx.schoolId,
        actorId: ctx.user.id,
        summary: `Enquiry ${enquiryNumber} from ${input.parentName}: ${input.children.length} ${input.children.length === 1 ? "child" : "children"}.`,
      });
      return enquiryId;
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  throw new Error("Could not allocate an enquiry number.");
}

/**
 * Correct the family's details and children while the enquiry is open. A
 * child already admitted stays exactly as they were; a child left out of the
 * form is removed (only if not admitted). Fees are changed on their own, with
 * history — not here.
 */
export async function updateEnquiry(ctx: TenantContext, input: UpdateEnquiryInput): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "enquiries.manage");
  const enquiry = await ctx.db.enquiry.findFirst({
    where: { id: input.enquiryId },
    select: { id: true, status: true, enquiryNumber: true, children: { select: { id: true, status: true, firstName: true, lastName: true } } },
  });
  if (!enquiry) throw new NotFoundError();
  if (!OPEN.includes(enquiry.status)) throw new ConflictError("Only an open enquiry can be edited. Converted and closed ones are kept as they were.");

  const editable = input.children.map((child, index) => ({ child, index })).filter(({ child }) => {
    const existing = child.id ? enquiry.children.find((row) => row.id === child.id) : null;
    return !existing || existing.status !== "ADMITTED";
  });
  for (const { child, index } of editable) {
    if (child.id && !enquiry.children.some((row) => row.id === child.id)) throw new ValidationError(INVALID, { [`children.${index}.firstName`]: ["This child is not part of this enquiry"] });
  }
  const { errors } = await resolveChildren(ctx, editable.map(({ child }) => child));
  // Errors come back by position in `editable`; map them to the form's own index.
  const mapped: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(errors)) {
    const [, position, field] = key.split(".");
    mapped[`children.${editable[Number(position)]!.index}.${field}`] = messages;
  }
  if (Object.keys(mapped).length) throw new ValidationError(INVALID, mapped);

  const keptIds = new Set(input.children.flatMap((child) => (child.id ? [child.id] : [])));
  const removed = enquiry.children.filter((row) => !keptIds.has(row.id) && row.status !== "ADMITTED");

  await ctx.db.$transaction(async (tx) => {
    await tx.enquiry.updateMany({
      where: { id: enquiry.id },
      data: {
        source: input.source,
        parentName: input.parentName,
        relationship: input.relationship,
        phone: input.phone,
        alternatePhone: input.alternatePhone,
        email: input.email,
        addressLine: input.addressLine,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        notes: input.notes,
        updatedById: ctx.user.id,
      },
    });
    if (removed.length) await tx.enquiryChild.deleteMany({ where: { id: { in: removed.map((row) => row.id) }, enquiryId: enquiry.id, status: { not: "ADMITTED" } } });
    for (const [index, child] of input.children.entries()) {
      const details = {
        position: index,
        firstName: child.firstName,
        lastName: child.lastName,
        dateOfBirth: child.dateOfBirth,
        gender: child.gender,
        classId: child.classId,
        streamId: child.streamId,
        previousSchool: child.previousSchool,
        notes: child.notes,
        updatedById: ctx.user.id,
      };
      if (child.id) {
        await tx.enquiryChild.updateMany({ where: { id: child.id, enquiryId: enquiry.id, status: { not: "ADMITTED" } }, data: details });
      } else {
        await tx.enquiryChild.create({ data: { schoolId: ctx.schoolId, enquiryId: enquiry.id, ...details, createdById: ctx.user.id } });
      }
    }
    await refreshFamilyDiscount(tx, enquiry.id);
  });

  await recordAudit({
    action: "ENQUIRY_UPDATED",
    entityType: "Enquiry",
    entityId: enquiry.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Enquiry ${enquiry.enquiryNumber} details updated${removed.length ? `; removed ${removed.map(childName).join(", ")}` : ""}.`,
  });
}

/** A child no longer coming (or coming after all). Admitted children cannot be changed here. */
export async function setChildWithdrawn(ctx: TenantContext, childId: string, withdrawn: boolean): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "enquiries.manage");
  const child = await ctx.db.enquiryChild.findFirst({ where: { id: childId }, select: { id: true, status: true, enquiryId: true, firstName: true, lastName: true, enquiry: { select: { status: true, enquiryNumber: true } } } });
  if (!child) throw new NotFoundError();
  if (child.status === "ADMITTED") throw new ConflictError("This child is already admitted.");
  if (!OPEN.includes(child.enquiry.status) && child.enquiry.status !== "CONVERTED") throw new ConflictError("This enquiry is closed. Reopen it first.");
  await ctx.db.$transaction(async (tx) => {
    await tx.enquiryChild.updateMany({ where: { id: child.id, status: { not: "ADMITTED" } }, data: { status: withdrawn ? "WITHDRAWN" : "OPEN", updatedById: ctx.user.id } });
    // A child coming after all reopens a converted enquiry.
    if (!withdrawn) await tx.enquiry.updateMany({ where: { id: child.enquiryId, status: "CONVERTED" }, data: { status: "FOLLOW_UP" } });
    await refreshFamilyDiscount(tx, child.enquiryId);
    await refreshEnquiryStatus(tx, child.enquiryId);
  });
  await recordAudit({ action: "ENQUIRY_UPDATED", entityType: "Enquiry", entityId: child.enquiryId, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `${childName(child)} ${withdrawn ? "marked not proceeding" : "back in"} on enquiry ${child.enquiry.enquiryNumber}.` });
}

// -----------------------------------------------------------------------------
// Fee discussion
// -----------------------------------------------------------------------------

/** One child's discussed fee and discount. Every change is kept as a revision. */
export async function saveChildFee(ctx: TenantContext, input: ChildFeeInput): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "enquiries.fees");
  const child = await ctx.db.enquiryChild.findFirst({
    where: { id: input.childId },
    select: { id: true, enquiryId: true, firstName: true, lastName: true, status: true, concessionAppliedAt: true, enquiry: { select: { status: true, enquiryNumber: true } } },
  });
  if (!child) throw new NotFoundError();
  if (child.enquiry.status === "CLOSED") throw new ConflictError("This enquiry is closed. Reopen it to change the fee discussion.");
  if (child.status === "WITHDRAWN") throw new ConflictError("This child is marked not proceeding.");
  if (child.concessionAppliedAt) throw new ConflictError("This child's agreed discount is already on their real fees. Change it on the student's fee account instead.");
  const result = childFeeColumns(input);
  if ("error" in result && result.error) throw new ValidationError(INVALID, { [result.error.field]: [result.error.message] });
  const fee = result.columns!;

  await ctx.db.$transaction(async (tx) => {
    await tx.enquiryChild.updateMany({ where: { id: child.id }, data: { ...fee, feeNotes: input.feeNotes, updatedById: ctx.user.id } });
    await tx.enquiryFeeRevision.create({
      data: { schoolId: ctx.schoolId, enquiryId: child.enquiryId, childId: child.id, childName: childName(child), originalMinor: fee.feeOriginalMinor, discountKind: fee.discountKind, discountValue: fee.discountValue, discountMinor: fee.discountMinor, finalMinor: fee.finalMinor, reason: fee.discountReason, notes: input.feeNotes, changedById: ctx.user.id },
    });
    // A changed figure has to be agreed again.
    await tx.enquiry.updateMany({ where: { id: child.enquiryId }, data: { feeStatus: "DISCUSSING", feeAgreedAt: null, feeAgreedById: null, updatedById: ctx.user.id } });
    await refreshFamilyDiscount(tx, child.enquiryId);
  });
  await recordAudit({
    action: "ENQUIRY_FEE_DISCUSSED",
    entityType: "Enquiry",
    entityId: child.enquiryId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Fee discussed for ${childName(child)} (${child.enquiry.enquiryNumber}): ${rupees(fee.feeOriginalMinor)} − ${rupees(fee.discountMinor)} = ${rupees(fee.finalMinor)}${fee.discountReason ? ` (${fee.discountReason})` : ""}.`,
  });
}

/** The family / sibling discount, the internal discussion notes, and whether the figures are agreed. */
export async function saveFamilyFee(ctx: TenantContext, input: FamilyFeeInput): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "enquiries.fees");
  const enquiry = await ctx.db.enquiry.findFirst({
    where: { id: input.enquiryId },
    select: { id: true, status: true, enquiryNumber: true, feeStatus: true, children: { select: { status: true, feeOriginalMinor: true, discountMinor: true, finalMinor: true } } },
  });
  if (!enquiry) throw new NotFoundError();
  if (enquiry.status === "CLOSED") throw new ConflictError("This enquiry is closed. Reopen it to change the fee discussion.");
  const value = storedDiscountValue(input.familyDiscountKind, input.familyDiscountValue);
  const before = familyTotals(enquiry.children, { kind: "NONE", value: 0 });
  if (input.familyDiscountKind !== "NONE") {
    const problem = before.subtotalMinor ? discountProblem(before.subtotalMinor, input.familyDiscountKind, value) : "Enter the children's discussed fees before a family discount";
    if (problem) throw new ValidationError(INVALID, { familyDiscountValue: [problem] });
  }
  if (input.feeStatus === "AGREED" && !before.discussedChildren) throw new ValidationError(INVALID, { feeStatus: ["Discuss at least one child's fee before marking it agreed"] });
  const totals = familyTotals(enquiry.children, { kind: input.familyDiscountKind, value });

  await ctx.db.$transaction(async (tx) => {
    await tx.enquiry.updateMany({
      where: { id: enquiry.id },
      data: {
        familyDiscountKind: input.familyDiscountKind,
        familyDiscountValue: value,
        familyDiscountMinor: totals.familyDiscountMinor,
        familyDiscountReason: input.familyDiscountKind === "NONE" ? null : input.familyDiscountReason,
        discussionNotes: input.discussionNotes,
        feeStatus: input.feeStatus,
        ...(input.feeStatus === "AGREED" ? (enquiry.feeStatus === "AGREED" ? {} : { feeAgreedAt: new Date(), feeAgreedById: ctx.user.id }) : { feeAgreedAt: null, feeAgreedById: null }),
        updatedById: ctx.user.id,
      },
    });
    await tx.enquiryFeeRevision.create({
      data: { schoolId: ctx.schoolId, enquiryId: enquiry.id, originalMinor: totals.subtotalMinor, discountKind: input.familyDiscountKind, discountValue: value, discountMinor: totals.familyDiscountMinor, finalMinor: totals.finalMinor, reason: input.familyDiscountReason, notes: input.discussionNotes, changedById: ctx.user.id },
    });
  });
  await recordAudit({
    action: "ENQUIRY_FEE_DISCUSSED",
    entityType: "Enquiry",
    entityId: enquiry.id,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `Family discussion on ${enquiry.enquiryNumber}: family discount ${rupees(totals.familyDiscountMinor)}, final ${rupees(totals.finalMinor)} (${input.feeStatus.toLowerCase().replace("_", " ")}).`,
  });
}

// -----------------------------------------------------------------------------
// Follow-up, status, existing parent
// -----------------------------------------------------------------------------

export async function addEnquiryFollowUp(
  ctx: TenantContext,
  input: { enquiryId: string; note: string; nextAction: string | null; nextFollowUpOn: Date | null; assignedToId: string | null },
): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "enquiries.manage");
  const enquiry = await ctx.db.enquiry.findFirst({ where: { id: input.enquiryId }, select: { id: true, status: true, enquiryNumber: true } });
  if (!enquiry) throw new NotFoundError();
  if (input.nextFollowUpOn && input.nextFollowUpOn < today()) throw new ValidationError(INVALID, { nextFollowUpOn: ["The next follow-up must be today or later"] });
  const assignedToId = await requireAssignee(ctx, input.assignedToId);
  await ctx.db.$transaction(async (tx) => {
    await tx.enquiryFollowUp.create({ data: { schoolId: ctx.schoolId, enquiryId: enquiry.id, note: input.note, nextAction: input.nextAction, nextFollowUpOn: input.nextFollowUpOn, authorId: ctx.user.id } });
    await tx.enquiry.updateMany({
      where: { id: enquiry.id },
      data: {
        lastContactedAt: new Date(),
        nextFollowUpOn: input.nextFollowUpOn,
        nextAction: input.nextAction,
        ...(assignedToId ? { assignedToId } : {}),
        // An open enquiry moves on by itself: contacted, or waiting on a follow-up.
        ...(OPEN.includes(enquiry.status) ? { status: input.nextFollowUpOn ? "FOLLOW_UP" : "CONTACTED" } : {}),
        updatedById: ctx.user.id,
      },
    });
  });
  await recordAudit({ action: "ENQUIRY_FOLLOW_UP", entityType: "Enquiry", entityId: enquiry.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Follow-up on ${enquiry.enquiryNumber}.` });
}

/** Move an enquiry by hand: contacted, follow-up, closed — or reopen it. CONVERTED is only ever set by admitting a child. */
export async function setEnquiryStatus(ctx: TenantContext, input: { enquiryId: string; status: "NEW" | "CONTACTED" | "FOLLOW_UP" | "CLOSED"; reason: string | null }): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "enquiries.manage");
  const enquiry = await ctx.db.enquiry.findFirst({ where: { id: input.enquiryId }, select: { id: true, status: true, enquiryNumber: true } });
  if (!enquiry) throw new NotFoundError();
  if (enquiry.status === "CONVERTED") throw new ConflictError("A converted enquiry is kept as it is.");
  if (input.status === "CLOSED" && !input.reason) throw new ValidationError(INVALID, { reason: ["Say why the enquiry is being closed"] });
  await ctx.db.enquiry.updateMany({
    where: { id: enquiry.id, status: { not: "CONVERTED" } },
    data: { status: input.status, ...(input.status === "CLOSED" ? { closedAt: new Date(), closeReason: input.reason } : { closedAt: null, closeReason: null }), updatedById: ctx.user.id },
  });
  await recordAudit({ action: "ENQUIRY_STATUS_CHANGED", entityType: "Enquiry", entityId: enquiry.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Enquiry ${enquiry.enquiryNumber} marked ${input.status.toLowerCase().replace("_", " ")}${input.reason ? `: ${input.reason}` : ""}.` });
}

type ParentLike = { id: string; firstName: string; lastName: string; phone: string; email: string | null };

/**
 * Parents already at this school who could be this family: by mobile or
 * email (safe to link), or by name only (link only on confirmation).
 */
export async function parentMatches(ctx: TenantContext, contact: { phone: string; email: string | null; parentName: string }) {
  await assertAdminOrStaffPermission(ctx, "enquiries.view");
  const parents = await ctx.db.parent.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      children: { select: { student: { select: { firstName: true, lastName: true, status: true, enrollments: { orderBy: { createdAt: "desc" }, take: 1, select: { class: { select: { name: true } }, stream: { select: { name: true } } } } } } } },
    },
  });
  const phone = phoneKey(contact.phone);
  const email = contact.email?.toLowerCase() ?? null;
  const name = contact.parentName.trim().toLowerCase().replace(/\s+/g, " ");
  const view = (row: (typeof parents)[number], matchedBy: "mobile" | "email" | "name") => ({
    id: row.id,
    name: fullName(row),
    phone: row.phone,
    email: row.email,
    matchedBy,
    children: row.children.map(({ student }) => ({
      name: fullName(student),
      status: student.status,
      className: student.enrollments[0]?.class.name ?? null,
      streamName: student.enrollments[0]?.stream?.name ?? null,
    })),
  });
  const byContact = parents
    .filter((row) => (phone.length >= 6 && phoneKey(row.phone) === phone) || (email !== null && row.email?.toLowerCase() === email))
    .map((row) => view(row, phoneKey(row.phone) === phone ? "mobile" : "email"));
  const byName = parents
    .filter((row) => !byContact.some((match) => match.id === row.id) && fullName(row).toLowerCase().replace(/\s+/g, " ") === name)
    .map((row) => view(row, "name"));
  return { byContact, byName };
}

function contactMatches(parent: ParentLike, enquiry: { phone: string; email: string | null }) {
  const email = enquiry.email?.toLowerCase() ?? null;
  return phoneKey(parent.phone) === phoneKey(enquiry.phone) || (email !== null && parent.email?.toLowerCase() === email);
}

/** Link the family to a parent already at this school — never another school's, never by name alone without confirmation. */
export async function linkExistingParent(ctx: TenantContext, input: { enquiryId: string; parentId: string | null; confirmNameOnly: boolean }): Promise<void> {
  await assertAdminOrStaffPermission(ctx, "enquiries.manage");
  const enquiry = await ctx.db.enquiry.findFirst({ where: { id: input.enquiryId }, select: { id: true, enquiryNumber: true, phone: true, email: true } });
  if (!enquiry) throw new NotFoundError();
  let label = "unlinked";
  if (input.parentId) {
    const parent = await ctx.db.parent.findFirst({ where: { id: input.parentId, archivedAt: null }, select: { id: true, firstName: true, lastName: true, phone: true, email: true } });
    if (!parent) throw new NotFoundError("That parent was not found at this school.");
    if (!contactMatches(parent, enquiry) && !input.confirmNameOnly) {
      throw new ValidationError(INVALID, { confirmNameOnly: [`${fullName(parent)} does not share this enquiry's mobile or email. Tick to confirm it is the same person.`] });
    }
    label = `linked to ${fullName(parent)}`;
  }
  await ctx.db.enquiry.updateMany({ where: { id: enquiry.id }, data: { existingParentId: input.parentId, updatedById: ctx.user.id } });
  await recordAudit({ action: "ENQUIRY_PARENT_LINKED", entityType: "Enquiry", entityId: enquiry.id, schoolId: ctx.schoolId, actorId: ctx.user.id, summary: `Enquiry ${enquiry.enquiryNumber} ${label}.` });
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

export type EnquiryFilters = {
  view?: "open" | "converted" | "closed" | "all";
  status?: EnquiryStatus;
  q?: string;
  classId?: string;
  streamId?: string;
  followUp?: "due" | "today" | "week";
  from?: Date | null;
  to?: Date | null;
};

const CHILD_SUMMARY = {
  orderBy: { position: "asc" as const },
  select: {
    id: true,
    firstName: true,
    lastName: true,
    status: true,
    feeOriginalMinor: true,
    discountMinor: true,
    finalMinor: true,
    class: { select: { name: true, level: true } },
    stream: { select: { name: true } },
  },
};

export async function listEnquiries(ctx: TenantContext, filters: EnquiryFilters = {}) {
  await assertAdminOrStaffPermission(ctx, "enquiries.view");
  const q = filters.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const date = today();
  const and: Prisma.EnquiryWhereInput[] = [];
  if (filters.status) and.push({ status: filters.status });
  else if (filters.view === "converted") and.push({ status: "CONVERTED" });
  else if (filters.view === "closed") and.push({ status: "CLOSED" });
  else if (filters.view !== "all") and.push({ status: { in: OPEN } });
  if (q) {
    const words = q.split(/\s+/).filter(Boolean);
    and.push({
      OR: [
        { parentName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { enquiryNumber: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-10) } }, { alternatePhone: { contains: digits.slice(-10) } }] : []),
        // Any child's name finds the family.
        { children: { some: { AND: words.map((word) => ({ OR: [{ firstName: { contains: word, mode: "insensitive" as const } }, { lastName: { contains: word, mode: "insensitive" as const } }] })) } } },
      ],
    });
  }
  if (filters.classId) and.push({ children: { some: { classId: filters.classId } } });
  if (filters.streamId) and.push({ children: { some: { streamId: filters.streamId } } });
  if (filters.followUp === "due") and.push({ nextFollowUpOn: { lte: date }, status: { in: OPEN } });
  if (filters.followUp === "today") and.push({ nextFollowUpOn: date });
  if (filters.followUp === "week") and.push({ nextFollowUpOn: { gte: date, lte: addDays(date, 7) } });
  // Received dates are the school's calendar days, not UTC ones.
  if (filters.from) and.push({ createdAt: { gte: schoolInstant(filters.from, 0) } });
  if (filters.to) and.push({ createdAt: { lt: schoolInstant(addDays(filters.to, 1), 0) } });

  const rows = await ctx.db.enquiry.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      enquiryNumber: true,
      status: true,
      source: true,
      parentName: true,
      phone: true,
      email: true,
      feeStatus: true,
      familyDiscountKind: true,
      familyDiscountValue: true,
      nextFollowUpOn: true,
      nextAction: true,
      createdAt: true,
      children: CHILD_SUMMARY,
    },
  });
  const needle = q?.toLowerCase();
  return rows.map((row) => ({
    ...row,
    totals: familyTotals(row.children, { kind: row.familyDiscountKind, value: row.familyDiscountValue }),
    /** The children the search matched by name — shown under the family. */
    matchedChildren: needle ? row.children.filter((child) => childName(child).toLowerCase().includes(needle) || needle.split(/\s+/).every((word) => childName(child).toLowerCase().includes(word))) : [],
    followUpDue: Boolean(row.nextFollowUpOn && row.nextFollowUpOn <= date && OPEN.includes(row.status)),
  }));
}

export async function getEnquiry(ctx: TenantContext, enquiryId: string) {
  await assertAdminOrStaffPermission(ctx, "enquiries.view");
  const enquiry = await ctx.db.enquiry.findFirst({
    where: { id: enquiryId },
    include: {
      academicSession: { select: { id: true, name: true } },
      existingParent: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      updatedBy: { select: { firstName: true, lastName: true } },
      feeAgreedBy: { select: { firstName: true, lastName: true } },
      children: {
        orderBy: { position: "asc" },
        include: {
          class: { select: { id: true, name: true, level: true } },
          stream: { select: { id: true, name: true } },
          convertedStudent: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
          updatedBy: { select: { firstName: true, lastName: true } },
        },
      },
      followUps: { orderBy: { createdAt: "desc" }, include: { author: { select: { firstName: true, lastName: true } } } },
      feeRevisions: { orderBy: { createdAt: "desc" }, include: { changedBy: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!enquiry) throw new NotFoundError();
  const totals = familyTotals(enquiry.children, { kind: enquiry.familyDiscountKind, value: enquiry.familyDiscountValue });
  return {
    ...enquiry,
    open: OPEN.includes(enquiry.status),
    totals,
    children: enquiry.children.map((child) => ({ ...child, name: childName(child), streamRule: streamRuleForLevel(child.class.level) })),
  };
}

/** Admins of this school, for "assigned to". */
export async function enquiryAssignees(ctx: TenantContext) {
  await assertAdminOrStaffPermission(ctx, "enquiries.view");
  const users = await ctx.db.user.findMany({ where: { role: "SCHOOL_ADMIN", isActive: true }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true } });
  return users.map((user) => ({ value: user.id, label: fullName(user) }));
}

/** For dashboards: open enquiries, and follow-ups due today or overdue. */
export async function enquiryCounts(ctx: TenantContext) {
  await assertAdminOrStaffPermission(ctx, "enquiries.view");
  const [open, due] = await Promise.all([
    ctx.db.enquiry.count({ where: { status: { in: OPEN } } }),
    ctx.db.enquiry.count({ where: { status: { in: OPEN }, nextFollowUpOn: { lte: today() } } }),
  ]);
  return { open, due };
}

// -----------------------------------------------------------------------------
// Admit a child
// -----------------------------------------------------------------------------

/**
 * The admission form for one child of the enquiry, already filled in. The
 * family's linked parent comes first, then parents matching by mobile or
 * email; a name-only match is offered but never preselected.
 */
export async function childConversionPlan(ctx: TenantContext, enquiryId: string, childId: string) {
  const enquiry = await getEnquiry(ctx, enquiryId);
  const child = enquiry.children.find((row) => row.id === childId);
  if (!child) throw new NotFoundError();
  const [matches, lookalikes] = await Promise.all([
    parentMatches(ctx, { phone: enquiry.phone, email: enquiry.email, parentName: enquiry.parentName }),
    ctx.db.student.findMany({
      where: { firstName: { equals: child.firstName, mode: "insensitive" }, ...(child.lastName ? { lastName: { equals: child.lastName, mode: "insensitive" } } : {}) },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true, dateOfBirth: true },
    }),
  ]);
  const linked = enquiry.existingParent ? { id: enquiry.existingParent.id, name: fullName(enquiry.existingParent), phone: enquiry.existingParent.phone, matchedBy: "linked" as const } : null;
  const safe = [...(linked ? [linked] : []), ...matches.byContact.filter((row) => row.id !== linked?.id)];
  const [parentFirst, ...parentRest] = enquiry.parentName.trim().split(/\s+/);
  const lastName = child.lastName ?? (parentRest.length ? parentRest[parentRest.length - 1]! : "");
  return {
    enquiry,
    child,
    open: child.status === "OPEN" && !child.convertedStudentId && enquiry.status !== "CLOSED",
    linkParent: safe[0] ?? null,
    safeParents: safe,
    nameOnlyParents: matches.byName.filter((row) => !safe.some((match) => match.id === row.id)),
    possibleDuplicates: lookalikes
      .filter((row) => !child.dateOfBirth || !row.dateOfBirth || row.dateOfBirth.getTime() === child.dateOfBirth.getTime())
      .map((row) => ({ id: row.id, name: fullName(row), admissionNumber: row.admissionNumber })),
    prefill: {
      firstName: child.firstName,
      lastName,
      gender: child.gender,
      dateOfBirth: child.dateOfBirth,
      addressLine: enquiry.addressLine,
      city: enquiry.city,
      state: enquiry.state,
      postalCode: enquiry.postalCode,
      parentFirstName: parentFirst ?? enquiry.parentName,
      parentLastName: parentRest.join(" ") || lastName,
      parentPhone: enquiry.phone,
      parentEmail: enquiry.email,
      relationship: enquiry.relationship,
      classId: child.classId,
      streamId: child.streamId,
    },
  };
}

/**
 * Admit one child of the enquiry through the same admission as "Add student"
 * (seats, admission number, parent dedupe, logins). The child is claimed
 * first, so two clicks cannot admit them twice; if the admission fails the
 * claim is released. No fee is touched — an agreed discount is applied
 * separately, on confirmation.
 */
export async function convertEnquiryChild(
  ctx: TenantContext,
  input: { enquiryId: string; childId: string; student: CreateStudentInput; admissionType: AdmissionType; confirmNotDuplicate: boolean },
): Promise<AdmissionResult> {
  assertCan(ctx, "students", "EDIT");
  const plan = await childConversionPlan(ctx, input.enquiryId, input.childId);
  if (!plan.open) throw new ConflictError("This child has already been admitted, or the enquiry is closed.");
  const { count } = await ctx.db.enquiryChild.updateMany({
    where: { id: input.childId, enquiryId: input.enquiryId, status: "OPEN", convertedStudentId: null },
    data: { status: "ADMITTED" },
  });
  if (!count) throw new ConflictError("This child is being admitted, or was admitted a moment ago.");
  let result: AdmissionResult;
  try {
    // The possible-duplicate check (and its "Add anyway") is createStudent's.
    result = await createStudent(ctx, { ...input.student, confirmDuplicate: input.student.confirmDuplicate || input.confirmNotDuplicate });
  } catch (error) {
    await ctx.db.enquiryChild.updateMany({ where: { id: input.childId, convertedStudentId: null }, data: { status: "OPEN" } });
    throw error;
  }
  const guardian = await ctx.db.parentStudent.findFirst({ where: { studentId: result.studentId }, orderBy: { isPrimary: "desc" }, select: { parentId: true } });
  await ctx.db.$transaction(async (tx) => {
    await tx.student.updateMany({ where: { id: result.studentId }, data: { admissionType: input.admissionType } });
    await tx.enquiryChild.updateMany({ where: { id: input.childId }, data: { convertedStudentId: result.studentId, convertedAt: new Date(), updatedById: ctx.user.id } });
    // The family's parent is now known: brothers and sisters admitted later join them.
    if (guardian) await tx.enquiry.updateMany({ where: { id: input.enquiryId, existingParentId: null }, data: { existingParentId: guardian.parentId } });
    await tx.enquiryFollowUp.create({ data: { schoolId: ctx.schoolId, enquiryId: input.enquiryId, note: `${plan.child.name} admitted as ${result.admissionNumber}.`, authorId: ctx.user.id } });
    await refreshEnquiryStatus(tx, input.enquiryId);
  });
  await recordAudit({
    action: "ENQUIRY_CHILD_CONVERTED",
    entityType: "Enquiry",
    entityId: input.enquiryId,
    schoolId: ctx.schoolId,
    actorId: ctx.user.id,
    summary: `${plan.child.name} from enquiry ${plan.enquiry.enquiryNumber} admitted as ${result.admissionNumber}.`,
  });
  return result;
}

// -----------------------------------------------------------------------------
// Agreed discount → real concession, on confirmation only
// -----------------------------------------------------------------------------

/**
 * For each admitted child: what was agreed (their own discount plus their
 * share of the family discount) and their actual fees this session, so the
 * office can choose which fee the concession goes on. Reads only.
 */
export async function concessionPlan(ctx: TenantContext, enquiryId: string) {
  const enquiry = await getEnquiry(ctx, enquiryId);
  const discussed = enquiry.children.filter((child) => child.status !== "WITHDRAWN" && child.finalMinor !== null);
  const shares = shareFamilyDiscount(discussed.map((child) => child.finalMinor ?? 0), enquiry.familyDiscountMinor);
  const admitted = enquiry.children.filter((child) => child.status === "ADMITTED" && child.convertedStudentId);
  const session = await ctx.db.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true } });
  const charges = session
    ? await ctx.db.feeCharge.findMany({
        where: { academicSessionId: session.id, studentId: { in: admitted.map((child) => child.convertedStudentId!) }, feeHead: { isSystem: false } },
        orderBy: { amountMinor: "desc" },
        select: { id: true, studentId: true, amountMinor: true, feeHead: { select: { name: true } }, concessions: { where: { revokedAt: null }, select: { id: true, reason: true } } },
      })
    : [];
  const rows = admitted.map((child) => {
    const index = discussed.findIndex((row) => row.id === child.id);
    const familyShareMinor = index >= 0 ? (shares[index] ?? 0) : 0;
    const own = charges.filter((charge) => charge.studentId === child.convertedStudentId);
    const agreedDiscountMinor = child.discountMinor + familyShareMinor;
    return {
      childId: child.id,
      name: child.name,
      className: child.class.name,
      student: child.convertedStudent,
      discussed: child.finalMinor !== null,
      originalMinor: child.feeOriginalMinor ?? 0,
      childDiscountMinor: child.discountMinor,
      familyShareMinor,
      agreedDiscountMinor,
      agreedFinalMinor: (child.feeOriginalMinor ?? 0) - agreedDiscountMinor,
      reason: child.discountReason,
      appliedAt: child.concessionAppliedAt,
      charges: own.map((charge) => ({ id: charge.id, head: charge.feeHead.name, amountMinor: charge.amountMinor, hasConcession: charge.concessions.length > 0 })),
      // The largest fee that can take the whole discount.
      suggestedChargeId: own.find((charge) => charge.amountMinor >= agreedDiscountMinor)?.id ?? own[0]?.id ?? null,
    };
  });
  return { enquiry, rows };
}

/**
 * Turn agreed discounts into real concessions — only when the office has
 * confirmed. Each concession sits on one child's own fee charge (accounts are
 * never merged), keeps the charge's original amount, and replaces any active
 * concession on that charge the way the fee desk does. All or nothing.
 */
export async function applyDiscussedConcessions(
  ctx: TenantContext,
  input: { enquiryId: string; confirm: boolean; items: Array<{ childId: string; chargeId: string; amountMinor: number; formIndex?: number }> },
): Promise<{ applied: number }> {
  assertCan(ctx, "students", "EDIT");
  if (!input.confirm) throw new ValidationError(INVALID, { confirm: ["Tick to confirm before any fee record is changed"] });
  if (!input.items.length) throw new ValidationError(INVALID, { _form: ["Choose at least one child"] });
  const plan = await concessionPlan(ctx, input.enquiryId);
  const errors: Record<string, string[]> = {};
  const work = input.items.map((item, position) => {
    const index = item.formIndex ?? position;
    const row = plan.rows.find((candidate) => candidate.childId === item.childId);
    const charge = row?.charges.find((candidate) => candidate.id === item.chargeId);
    if (!row) errors[`apply.${index}.chargeId`] = ["This child is not admitted from this enquiry"];
    else if (row.appliedAt) errors[`apply.${index}.chargeId`] = [`${row.name}'s discount is already applied`];
    else if (!charge) errors[`apply.${index}.chargeId`] = [`Choose one of ${row.name}'s fees`];
    else if (!(item.amountMinor > 0)) errors[`apply.${index}.amount`] = ["Enter the discount in rupees"];
    else if (item.amountMinor > charge.amountMinor) errors[`apply.${index}.amount`] = [`More than the fee (${rupees(charge.amountMinor)}). Choose a larger fee or a smaller amount.`];
    return { item, row: row!, charge: charge! };
  });
  if (Object.keys(errors).length) throw new ValidationError(INVALID, errors);

  await ctx.db.$transaction(async (tx) => {
    for (const { item, row, charge } of work) {
      // Claim the child first, so a second confirmation applies nothing twice.
      const claimed = await tx.enquiryChild.updateMany({ where: { id: row.childId, concessionAppliedAt: null }, data: { concessionAppliedAt: new Date(), concessionChargeId: charge.id, updatedById: ctx.user.id } });
      if (!claimed.count) throw new ConflictError(`${row.name}'s discount was applied a moment ago.`);
      await tx.feeConcession.updateMany({ where: { feeChargeId: charge.id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: ctx.user.id, revokeReason: "Replaced by the discount agreed at enquiry" } });
      await tx.feeConcession.create({
        data: {
          schoolId: ctx.schoolId,
          feeChargeId: charge.id,
          kind: "FIXED",
          value: item.amountMinor,
          discountMinor: item.amountMinor,
          originalMinor: charge.amountMinor,
          reason: `Agreed at enquiry ${plan.enquiry.enquiryNumber}${row.reason ? `: ${row.reason}` : ""}${row.familyShareMinor ? " (incl. family discount share)" : ""}`.slice(0, 200),
          approvedById: ctx.user.id,
        },
      });
    }
  });
  for (const { item, row, charge } of work) {
    await recordAudit({
      action: "ENQUIRY_CONCESSION_APPLIED",
      entityType: "FeeCharge",
      entityId: charge.id,
      schoolId: ctx.schoolId,
      actorId: ctx.user.id,
      summary: `Discount agreed at enquiry ${plan.enquiry.enquiryNumber} applied to ${row.name}'s ${charge.head}: ${rupees(charge.amountMinor)} − ${rupees(item.amountMinor)} = ${rupees(charge.amountMinor - item.amountMinor)}.`,
    });
  }
  return { applied: work.length };
}
