/**
 * Family enquiries: one parent, one or more children, each with their own
 * class, stream (Nursery–8 none, 9–10 optional, 11–12 required) and fee
 * discussion. The discussion never touches real fees; admitting a child links
 * the family's existing parent; an agreed discount becomes a real concession
 * only on confirmation, on that child's own fee. All of it School Admin only,
 * and none of it visible to another school.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createEnquirySchema, type CreateEnquiryInput } from "@/lib/validation/enquiries";
import { createStudentSchema } from "@/lib/validation/school";
import {
  addEnquiryFollowUp,
  applyDiscussedConcessions,
  childConversionPlan,
  concessionPlan,
  convertEnquiryChild,
  createEnquiry,
  getEnquiry,
  linkExistingParent,
  listEnquiries,
  saveChildFee,
  saveFamilyFee,
  setChildWithdrawn,
  setEnquiryStatus,
  updateEnquiry,
} from "@/server/admissions/enquiries";
import { prisma } from "@/server/db/prisma";

import { adminOf, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
const cls: Record<string, string> = {};
let science: string;
let commerce: string;
let artsB: string;
let parentPhone: string;

type ChildForm = Record<string, string>;

/** The enquiry form as the browser sends it: flat children.N.field keys. */
function form(children: ChildForm[], extra: Record<string, string> = {}): CreateEnquiryInput {
  const raw: Record<string, string> = { parentName: "Rahul Sharma", relationship: "FATHER", phone: "98765 43210", source: "WALK_IN", ...extra };
  children.forEach((child, index) => {
    for (const [key, value] of Object.entries(child)) raw[`children.${index}.${key}`] = value;
  });
  return createEnquirySchema.parse(raw);
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  const schoolId = schoolA.schoolId;
  for (const [name, level] of [["Nursery", -3], ["Class 8", 8], ["Class 9", 9], ["Class 11", 11], ["Class 12", 12]] as const) {
    cls[name] = (await prisma.class.create({ data: { schoolId, name, level } })).id;
  }
  cls["Class 10"] = schoolA.classId;
  science = (await prisma.stream.create({ data: { schoolId, name: "Science" } })).id;
  commerce = (await prisma.stream.create({ data: { schoolId, name: "Commerce" } })).id;
  artsB = (await prisma.stream.create({ data: { schoolId: schoolB.schoolId, name: "Arts" } })).id;
  parentPhone = (await prisma.parent.findUniqueOrThrow({ where: { id: schoolA.parentId } })).phone;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("taking an enquiry", () => {
  it("records one parent with one child, as an enquiry — no student, no fee", async () => {
    const before = { students: await prisma.student.count({ where: { schoolId: schoolA.schoolId } }), charges: await prisma.feeCharge.count({ where: { schoolId: schoolA.schoolId } }) };
    const id = await createEnquiry(adminOf(schoolA), form([{ firstName: "Solo", classId: cls["Class 8"]! }], { parentName: "Single Parent", phone: "90000 11111" }));
    const enquiry = await getEnquiry(adminOf(schoolA), id);
    expect(enquiry).toMatchObject({ status: "NEW", source: "WALK_IN", feeStatus: "NOT_STARTED" });
    expect(enquiry.enquiryNumber).toMatch(/^ENQ-\d{4}-\d{5}$/);
    expect(enquiry.children).toHaveLength(1);
    expect(await prisma.student.count({ where: { schoolId: schoolA.schoolId } })).toBe(before.students);
    expect(await prisma.feeCharge.count({ where: { schoolId: schoolA.schoolId } })).toBe(before.charges);
  });

  it("records the worked example: three children, each with their own class, stream and fee — ₹1,40,000 − ₹14,500 = ₹1,25,500", async () => {
    const id = await createEnquiry(
      adminOf(schoolA),
      form([
        { firstName: "Aarav", lastName: "Sharma", classId: cls["Class 8"]!, feeOriginal: "40000", discountKind: "FIXED", discountValue: "5000", discountReason: "Sibling admission" },
        { firstName: "Anaya", lastName: "Sharma", classId: cls["Class 10"]!, feeOriginal: "45,000", discountKind: "PERCENT", discountValue: "10" },
        { firstName: "Riya", lastName: "Sharma", classId: cls["Class 12"]!, streamId: commerce, feeOriginal: "55000", discountKind: "FIXED", discountValue: "5000" },
      ]),
    );
    const enquiry = await getEnquiry(adminOf(schoolA), id);
    expect(enquiry.children.map((child) => [child.firstName, child.streamRule, child.stream?.name ?? null, child.finalMinor])).toEqual([
      ["Aarav", "NONE", null, 3_500_000],
      ["Anaya", "OPTIONAL", null, 4_050_000],
      ["Riya", "REQUIRED", "Commerce", 5_000_000],
    ]);
    expect(enquiry.totals).toMatchObject({ discussedChildren: 3, originalMinor: 14_000_000, totalDiscountMinor: 1_450_000, finalMinor: 12_550_000 });
    expect(enquiry.feeStatus).toBe("DISCUSSING");
    // One revision per discussed child, so the original figures are kept.
    expect(enquiry.feeRevisions).toHaveLength(3);
    // Still three separate children: no money anywhere.
    expect(await prisma.feeConcession.count({ where: { schoolId: schoolA.schoolId } })).toBe(0);
  });
});

describe("streams follow the class — on the server", () => {
  it("requires a stream for Class 11 and 12", async () => {
    for (const name of ["Class 11", "Class 12"]) {
      await expect(createEnquiry(adminOf(schoolA), form([{ firstName: "NoStream", classId: cls[name]! }]))).rejects.toMatchObject({
        fieldErrors: { "children.0.streamId": [expect.stringMatching(/Choose a stream/)] },
      });
    }
    expect(await createEnquiry(adminOf(schoolA), form([{ firstName: "Sci", classId: cls["Class 11"]!, streamId: science }], { phone: "90000 22222" }))).toBeTruthy();
  });

  it("accepts Class 9 and 10 with or without a stream", async () => {
    const id = await createEnquiry(
      adminOf(schoolA),
      form([{ firstName: "Nine", classId: cls["Class 9"]! }, { firstName: "Ten", classId: cls["Class 10"]!, streamId: science }], { phone: "90000 33333" }),
    );
    expect((await getEnquiry(adminOf(schoolA), id)).children.map((child) => child.stream?.name ?? null)).toEqual([null, "Science"]);
  });

  it("refuses a stream for Nursery–8, and another school's stream anywhere", async () => {
    await expect(createEnquiry(adminOf(schoolA), form([{ firstName: "Tiny", classId: cls.Nursery!, streamId: science }]))).rejects.toMatchObject({
      fieldErrors: { "children.0.streamId": [expect.stringMatching(/has no stream/)] },
    });
    await expect(createEnquiry(adminOf(schoolA), form([{ firstName: "X", classId: cls["Class 11"]!, streamId: artsB }]))).rejects.toBeInstanceOf(ValidationError);
    await expect(createEnquiry(adminOf(schoolA), form([{ firstName: "X", classId: schoolB.classId }]))).rejects.toMatchObject({
      fieldErrors: { "children.0.classId": [expect.any(String)] },
    });
  });
});

describe("editing, searching and following up", () => {
  it("adds and removes children, and finds the family by any child's name", async () => {
    const id = await createEnquiry(adminOf(schoolA), form([{ firstName: "Kabir", lastName: "Mehta", classId: cls["Class 8"]! }], { parentName: "Neha Mehta", phone: "90000 44444" }));
    const [first] = (await getEnquiry(adminOf(schoolA), id)).children;
    const base = { enquiryId: id, source: "PHONE" as const, parentName: "Neha Mehta", relationship: "MOTHER" as const, phone: "90000 44444", alternatePhone: null, email: null, addressLine: null, city: "Pune", state: null, postalCode: null, notes: null };
    const child = (fields: Partial<CreateEnquiryInput["children"][number]>) => ({ id: null, firstName: "", lastName: null, dateOfBirth: null, gender: null, classId: cls["Class 8"]!, streamId: null, previousSchool: null, notes: null, feeOriginal: null, discountKind: "NONE" as const, discountValue: null, discountReason: null, ...fields });

    await updateEnquiry(adminOf(schoolA), { ...base, children: [child({ id: first!.id, firstName: "Kabir", lastName: "Mehta" }), child({ firstName: "Zoya", lastName: "Mehta", classId: cls["Class 12"]!, streamId: science })] });
    let enquiry = await getEnquiry(adminOf(schoolA), id);
    expect(enquiry.children.map((row) => row.firstName)).toEqual(["Kabir", "Zoya"]);
    expect(enquiry).toMatchObject({ source: "PHONE", city: "Pune" });

    // The family shows up whichever child is searched for.
    const found = await listEnquiries(adminOf(schoolA), { q: "Zoya Mehta" });
    expect(found.map((row) => row.id)).toContain(id);
    expect(found.find((row) => row.id === id)!.matchedChildren.map((row) => row.firstName)).toEqual(["Zoya"]);
    expect((await listEnquiries(adminOf(schoolA), { classId: cls["Class 12"], streamId: science })).some((row) => row.id === id)).toBe(true);

    // Remove Kabir again: the stream rule still applies to Zoya.
    await expect(updateEnquiry(adminOf(schoolA), { ...base, children: [child({ id: enquiry.children[1]!.id, firstName: "Zoya", classId: cls["Class 12"]! })] })).rejects.toBeInstanceOf(ValidationError);
    await updateEnquiry(adminOf(schoolA), { ...base, children: [child({ id: enquiry.children[1]!.id, firstName: "Zoya", classId: cls["Class 12"]!, streamId: science })] });
    enquiry = await getEnquiry(adminOf(schoolA), id);
    expect(enquiry.children.map((row) => row.firstName)).toEqual(["Zoya"]);
  });

  it("moves through New → Contacted → Follow up, closes only with a reason, and reopens", async () => {
    const id = await createEnquiry(adminOf(schoolA), form([{ firstName: "Ira", classId: cls["Class 8"]! }], { phone: "90000 55555" }));
    await addEnquiryFollowUp(adminOf(schoolA), { enquiryId: id, note: "Called", nextAction: null, nextFollowUpOn: null, assignedToId: null });
    expect((await getEnquiry(adminOf(schoolA), id)).status).toBe("CONTACTED");
    const next = new Date(Date.now() + 3 * 86_400_000);
    const date = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate()));
    await addEnquiryFollowUp(adminOf(schoolA), { enquiryId: id, note: "Will visit", nextAction: "Visit with documents", nextFollowUpOn: date, assignedToId: schoolA.adminUserId });
    const enquiry = await getEnquiry(adminOf(schoolA), id);
    expect(enquiry).toMatchObject({ status: "FOLLOW_UP", nextAction: "Visit with documents", assignedToId: schoolA.adminUserId });
    expect(enquiry.lastContactedAt).not.toBeNull();
    expect(enquiry.followUps).toHaveLength(2);

    await expect(setEnquiryStatus(adminOf(schoolA), { enquiryId: id, status: "CLOSED", reason: null })).rejects.toBeInstanceOf(ValidationError);
    await setEnquiryStatus(adminOf(schoolA), { enquiryId: id, status: "CLOSED", reason: "Chose another school" });
    expect((await getEnquiry(adminOf(schoolA), id)).status).toBe("CLOSED");
    await setEnquiryStatus(adminOf(schoolA), { enquiryId: id, status: "FOLLOW_UP", reason: null });
    expect((await getEnquiry(adminOf(schoolA), id)).closedAt).toBeNull();
  });
});

describe("fee discussion", () => {
  it("keeps every change, refuses a discount above the fee, and adds a family discount", async () => {
    const id = await createEnquiry(adminOf(schoolA), form([{ firstName: "Dev", classId: cls["Class 8"]! }, { firstName: "Diya", classId: cls["Class 9"]! }], { phone: "90000 66666" }));
    const [dev, diya] = (await getEnquiry(adminOf(schoolA), id)).children;

    await expect(saveChildFee(adminOf(schoolA), { childId: dev!.id, feeOriginal: 4_000_000, discountKind: "FIXED", discountValue: 40_001, discountReason: null, feeNotes: null })).rejects.toMatchObject({
      fieldErrors: { discountValue: [expect.stringMatching(/cannot be more than/)] },
    });
    await expect(saveChildFee(adminOf(schoolA), { childId: dev!.id, feeOriginal: 4_000_000, discountKind: "PERCENT", discountValue: 101, discountReason: null, feeNotes: null })).rejects.toBeInstanceOf(ValidationError);

    await saveChildFee(adminOf(schoolA), { childId: dev!.id, feeOriginal: 4_000_000, discountKind: "NONE", discountValue: null, discountReason: null, feeNotes: null });
    await saveChildFee(adminOf(schoolA), { childId: dev!.id, feeOriginal: 4_000_000, discountKind: "FIXED", discountValue: 5_000, discountReason: "Local fee discussion", feeNotes: "After meeting the principal" });
    await saveChildFee(adminOf(schoolA), { childId: diya!.id, feeOriginal: 4_500_000, discountKind: "PERCENT", discountValue: 10, discountReason: "Sibling admission", feeNotes: null });

    await expect(saveFamilyFee(adminOf(schoolA), { enquiryId: id, familyDiscountKind: "FIXED", familyDiscountValue: 100_000, familyDiscountReason: null, discussionNotes: null, feeStatus: "DISCUSSING" })).rejects.toBeInstanceOf(ValidationError);
    await saveFamilyFee(adminOf(schoolA), { enquiryId: id, familyDiscountKind: "FIXED", familyDiscountValue: 2_500, familyDiscountReason: "Sibling admission", discussionNotes: "Two children; sibling discount agreed.", feeStatus: "AGREED" });

    const enquiry = await getEnquiry(adminOf(schoolA), id);
    expect(enquiry.children.map((child) => [child.discountMinor, child.finalMinor])).toEqual([
      [500_000, 3_500_000],
      [450_000, 4_050_000],
    ]);
    expect(enquiry.totals).toMatchObject({ originalMinor: 8_500_000, childDiscountMinor: 950_000, familyDiscountMinor: 250_000, totalDiscountMinor: 1_200_000, finalMinor: 7_300_000 });
    expect(enquiry).toMatchObject({ feeStatus: "AGREED", discussionNotes: "Two children; sibling discount agreed.", feeAgreedById: schoolA.adminUserId });
    // Dev's first figure (no discount) is still in the history.
    const devHistory = enquiry.feeRevisions.filter((revision) => revision.childId === dev!.id);
    expect(devHistory.map((revision) => revision.discountMinor).sort()).toEqual([0, 500_000]);
    expect(enquiry.feeRevisions.some((revision) => revision.childId === null && revision.discountMinor === 250_000)).toBe(true);

    // Changing a figure after agreement sends it back to discussing.
    await saveChildFee(adminOf(schoolA), { childId: diya!.id, feeOriginal: 4_500_000, discountKind: "PERCENT", discountValue: 12, discountReason: "Sibling admission", feeNotes: null });
    expect((await getEnquiry(adminOf(schoolA), id)).feeStatus).toBe("DISCUSSING");
  });
});

describe("existing parent and admission", () => {
  it("finds the parent already at the school, links them, and admits each child under that one parent", async () => {
    const parentsBefore = await prisma.parent.count({ where: { schoolId: schoolA.schoolId } });
    const id = await createEnquiry(
      adminOf(schoolA),
      form(
        [
          { firstName: "Meher", lastName: "Kapoor", classId: cls["Class 10"]!, feeOriginal: "40000", discountKind: "FIXED", discountValue: "4000", discountReason: "Sibling admission" },
          { firstName: "Vir", lastName: "Kapoor", classId: cls["Class 10"]!, feeOriginal: "40000" },
          { firstName: "Tara", lastName: "Kapoor", classId: cls["Class 8"]! },
        ],
        // The fixture's parent, typed differently.
        { parentName: "Some Parent", phone: "0" + parentPhone.replace(/\D/g, "").slice(-10) },
      ),
    );
    const enquiry = await getEnquiry(adminOf(schoolA), id);
    const [meher, vir, tara] = enquiry.children;

    // Before linking, conversion already offers the parent matched by mobile.
    const plan = await childConversionPlan(adminOf(schoolA), id, meher!.id);
    expect(plan.linkParent).toMatchObject({ id: schoolA.parentId, matchedBy: "mobile" });
    await linkExistingParent(adminOf(schoolA), { enquiryId: id, parentId: schoolA.parentId, confirmNameOnly: false });
    expect((await childConversionPlan(adminOf(schoolA), id, meher!.id)).linkParent).toMatchObject({ id: schoolA.parentId, matchedBy: "linked" });

    const admit = (firstName: string) =>
      createStudentSchema.parse({ firstName, lastName: "Kapoor", sectionId: schoolA.sectionId, guardianMode: "existing", existingParentId: schoolA.parentId, relationship: "FATHER" });
    const first = await convertEnquiryChild(adminOf(schoolA), { enquiryId: id, childId: meher!.id, student: admit("Meher"), admissionType: "NEW", confirmNotDuplicate: false });
    const second = await convertEnquiryChild(adminOf(schoolA), { enquiryId: id, childId: vir!.id, student: admit("Vir"), admissionType: "NEW", confirmNotDuplicate: false });
    await expect(convertEnquiryChild(adminOf(schoolA), { enquiryId: id, childId: vir!.id, student: admit("Vir"), admissionType: "NEW", confirmNotDuplicate: false })).rejects.toBeInstanceOf(ConflictError);

    // One parent, both children under them; no new parent row.
    expect(await prisma.parent.count({ where: { schoolId: schoolA.schoolId } })).toBe(parentsBefore);
    expect(await prisma.parentStudent.count({ where: { parentId: schoolA.parentId, studentId: { in: [first.studentId, second.studentId] } } })).toBe(2);

    // Still open while Tara is undecided; converted once she is not coming.
    expect((await getEnquiry(adminOf(schoolA), id)).status).not.toBe("CONVERTED");
    await setChildWithdrawn(adminOf(schoolA), tara!.id, true);
    expect((await getEnquiry(adminOf(schoolA), id)).status).toBe("CONVERTED");

    // Admitting created no fee and no concession.
    expect(await prisma.feeCharge.count({ where: { studentId: { in: [first.studentId, second.studentId] } } })).toBe(0);
    expect(await prisma.feeConcession.count({ where: { schoolId: schoolA.schoolId } })).toBe(0);

    // The agreed discount becomes real only after fees exist, and only on confirmation.
    const head = await prisma.feeHead.create({ data: { schoolId: schoolA.schoolId, name: "Tuition (enquiry test)" } });
    const due = new Date(Date.UTC(2027, 0, 1));
    const meherCharge = await prisma.feeCharge.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, studentId: first.studentId, feeHeadId: head.id, amountMinor: 4_000_000, dueOn: due } });
    const virCharge = await prisma.feeCharge.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, studentId: second.studentId, feeHeadId: head.id, amountMinor: 4_000_000, dueOn: due } });

    const concessions = await concessionPlan(adminOf(schoolA), id);
    const meherRow = concessions.rows.find((row) => row.childId === meher!.id)!;
    expect(meherRow).toMatchObject({ agreedDiscountMinor: 400_000, suggestedChargeId: meherCharge.id });

    await expect(applyDiscussedConcessions(adminOf(schoolA), { enquiryId: id, confirm: false, items: [{ childId: meher!.id, chargeId: meherCharge.id, amountMinor: 400_000 }] })).rejects.toBeInstanceOf(ValidationError);
    // Meher's discount cannot be put on Vir's fee.
    await expect(applyDiscussedConcessions(adminOf(schoolA), { enquiryId: id, confirm: true, items: [{ childId: meher!.id, chargeId: virCharge.id, amountMinor: 400_000 }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(applyDiscussedConcessions(teacherOf(schoolA), { enquiryId: id, confirm: true, items: [{ childId: meher!.id, chargeId: meherCharge.id, amountMinor: 400_000 }] })).rejects.toBeInstanceOf(ForbiddenError);
    // The Principal oversees admissions but never changes fee records.
    await expect(applyDiscussedConcessions({ ...adminOf(schoolA), user: { ...adminOf(schoolA).user, role: "PRINCIPAL" } }, { enquiryId: id, confirm: true, items: [{ childId: meher!.id, chargeId: meherCharge.id, amountMinor: 400_000 }] })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.feeConcession.count({ where: { schoolId: schoolA.schoolId } })).toBe(0);

    await applyDiscussedConcessions(adminOf(schoolA), { enquiryId: id, confirm: true, items: [{ childId: meher!.id, chargeId: meherCharge.id, amountMinor: 400_000 }] });
    const concession = await prisma.feeConcession.findFirstOrThrow({ where: { feeChargeId: meherCharge.id } });
    expect(concession).toMatchObject({ kind: "FIXED", discountMinor: 400_000, originalMinor: 4_000_000, approvedById: schoolA.adminUserId });
    expect(concession.reason).toMatch(/Agreed at enquiry ENQ-/);
    // The charge itself is untouched; Vir's account has nothing.
    expect((await prisma.feeCharge.findUniqueOrThrow({ where: { id: meherCharge.id } })).amountMinor).toBe(4_000_000);
    expect(await prisma.feeConcession.count({ where: { feeChargeId: virCharge.id } })).toBe(0);
    // Not twice; and the discussion is now fixed for Meher.
    await expect(applyDiscussedConcessions(adminOf(schoolA), { enquiryId: id, confirm: true, items: [{ childId: meher!.id, chargeId: meherCharge.id, amountMinor: 400_000 }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveChildFee(adminOf(schoolA), { childId: meher!.id, feeOriginal: 4_000_000, discountKind: "NONE", discountValue: null, discountReason: null, feeNotes: null })).rejects.toBeInstanceOf(ConflictError);
  });

  it("links a parent who matches only by name only on confirmation, and never another school's parent", async () => {
    const fixtureParent = await prisma.parent.findUniqueOrThrow({ where: { id: schoolA.parentId } });
    const id = await createEnquiry(adminOf(schoolA), form([{ firstName: "Namesake", classId: cls["Class 8"]! }], { parentName: `${fixtureParent.firstName} ${fixtureParent.lastName}`, phone: "91234 00000" }));
    await expect(linkExistingParent(adminOf(schoolA), { enquiryId: id, parentId: schoolA.parentId, confirmNameOnly: false })).rejects.toMatchObject({
      fieldErrors: { confirmNameOnly: [expect.any(String)] },
    });
    await linkExistingParent(adminOf(schoolA), { enquiryId: id, parentId: schoolA.parentId, confirmNameOnly: true });
    expect((await getEnquiry(adminOf(schoolA), id)).existingParentId).toBe(schoolA.parentId);
    await expect(linkExistingParent(adminOf(schoolA), { enquiryId: id, parentId: schoolB.parentId, confirmNameOnly: true })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("only this school's admins", () => {
  it("keeps School B and teachers out of School A's enquiries, parents and fee discussions", async () => {
    const id = await createEnquiry(adminOf(schoolA), form([{ firstName: "Private", classId: cls["Class 8"]!, feeOriginal: "30000" }], { phone: "90000 77777" }));
    const [child] = (await getEnquiry(adminOf(schoolA), id)).children;

    await expect(getEnquiry(adminOf(schoolB), id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listEnquiries(adminOf(schoolB), { view: "all" })).some((row) => row.id === id)).toBe(false);
    expect((await listEnquiries(adminOf(schoolB), { q: "Private" })).length).toBe(0);
    await expect(saveChildFee(adminOf(schoolB), { childId: child!.id, feeOriginal: 100, discountKind: "NONE", discountValue: null, discountReason: null, feeNotes: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveFamilyFee(adminOf(schoolB), { enquiryId: id, familyDiscountKind: "NONE", familyDiscountValue: null, familyDiscountReason: null, discussionNotes: null, feeStatus: "DISCUSSING" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(linkExistingParent(adminOf(schoolB), { enquiryId: id, parentId: schoolB.parentId, confirmNameOnly: true })).rejects.toBeInstanceOf(NotFoundError);
    await expect(childConversionPlan(adminOf(schoolB), id, child!.id)).rejects.toBeInstanceOf(NotFoundError);

    await expect(createEnquiry(teacherOf(schoolA), form([{ firstName: "T", classId: cls["Class 8"]! }]))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getEnquiry(teacherOf(schoolA), id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveChildFee(teacherOf(schoolA), { childId: child!.id, feeOriginal: 100, discountKind: "NONE", discountValue: null, discountReason: null, feeNotes: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setEnquiryStatus(teacherOf(schoolA), { enquiryId: id, status: "CLOSED", reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
