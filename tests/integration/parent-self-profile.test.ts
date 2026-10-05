/**
 * A parent corrects their own details under My account: their name, numbers,
 * occupation and address — only their own record, found by their sign-in.
 * A mobile another parent at the school uses is refused (families are linked
 * by it); the office sees the change; nobody else can use this to edit a parent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { parentSelfProfileSchema } from "@/lib/validation/school";
import { prisma } from "@/server/db/prisma";
import { getMyParentProfile, updateMyParentProfile } from "@/server/parent/self-profile";
import { updateParent } from "@/server/people/students";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;

const parentOf = (school: SeededSchool) => contextFor(school, school.parentUserId, "PARENT");
const details = (overrides: Record<string, string> = {}) =>
  parentSelfProfileSchema.parse({
    firstName: "Sunita",
    lastName: "Rao",
    phone: "98111 22334",
    alternatePhone: "98111 99887",
    occupation: "Doctor",
    addressLine: "12 Lake View Road",
    city: "Indore",
    state: "Madhya Pradesh",
    postalCode: "452001",
    ...overrides,
  });

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("a parent's own details", () => {
  it("saves every personal field, keeps the login's name and mobile in step, and tells the office", async () => {
    const before = await getMyParentProfile(parentOf(schoolA));
    const otherParent = await prisma.parent.findUniqueOrThrow({ where: { id: schoolB.parentId } });

    const { changed } = await updateMyParentProfile(parentOf(schoolA), details());
    expect(changed).toEqual(expect.arrayContaining(["first name", "mobile", "alternate number", "occupation", "address", "city", "state", "PIN code"]));

    const after = await getMyParentProfile(parentOf(schoolA));
    expect(after).toMatchObject({ firstName: "Sunita", lastName: "Rao", phone: "+91 9811122334", alternatePhone: "+91 9811199887", occupation: "Doctor", city: "Indore", postalCode: "452001" });
    expect(after.selfUpdatedAt).not.toBeNull();
    expect(after.completeness).toBeGreaterThan(before.completeness);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: schoolA.parentUserId } })).toMatchObject({ firstName: "Sunita", lastName: "Rao", phone: "+91 9811122334" });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, action: "PARENT_SELF_UPDATED" } });
    expect(audit).toMatchObject({ entityId: schoolA.parentId, actorId: schoolA.parentUserId });
    // Another school's parent is untouched.
    expect(await prisma.parent.findUniqueOrThrow({ where: { id: schoolB.parentId } })).toMatchObject({ firstName: otherParent.firstName, phone: otherParent.phone });

    // Saving the same again changes nothing.
    expect((await updateMyParentProfile(parentOf(schoolA), details())).changed).toEqual([]);
  });

  it("refuses a mobile another parent at this school uses, but not one used at another school", async () => {
    const schoolId = schoolA.schoolId;
    await prisma.parent.create({ data: { schoolId, firstName: "Other", lastName: "Family", phone: "+91 97000 55555" } });
    await expect(updateMyParentProfile(parentOf(schoolA), details({ phone: "9700055555" }))).rejects.toMatchObject({
      fieldErrors: { phone: [expect.stringMatching(/Another parent at this school/)] },
    });
    const schoolBPhone = (await prisma.parent.findUniqueOrThrow({ where: { id: schoolB.parentId } })).phone;
    await updateMyParentProfile(parentOf(schoolA), details({ phone: schoolBPhone }));
    // Saved in the standard form, whatever spelling school B's record has.
    expect((await getMyParentProfile(parentOf(schoolA))).phone).toBe(normalizePhone(schoolBPhone));
  });

  it("checks the form: PIN code, and an alternate number different from the mobile", () => {
    expect(parentSelfProfileSchema.safeParse({ ...details(), postalCode: "4520" }).success).toBe(false);
    expect(parentSelfProfileSchema.safeParse({ ...details(), alternatePhone: "+91 98111 22334" }).success).toBe(false);
    expect(parentSelfProfileSchema.safeParse({ ...details(), firstName: "" }).success).toBe(false);
    expect(parentSelfProfileSchema.safeParse({ ...details(), alternatePhone: "", postalCode: "" }).success).toBe(true);
  });

  it("is for parents only, and not for an archived record", async () => {
    await expect(updateMyParentProfile(teacherOf(schoolA), details())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateMyParentProfile(adminOf(schoolA), details())).rejects.toBeInstanceOf(ForbiddenError);
    await prisma.parent.update({ where: { id: schoolA.parentId }, data: { archivedAt: new Date() } });
    await expect(updateMyParentProfile(parentOf(schoolA), details({ city: "Bhopal" }))).rejects.toBeInstanceOf(ConflictError);
    await prisma.parent.update({ where: { id: schoolA.parentId }, data: { archivedAt: null } });
  });

  it("is not wiped when the office saves the record from a form or API without the new fields", async () => {
    const current = await prisma.parent.findUniqueOrThrow({ where: { id: schoolA.parentId }, include: { user: true } });
    // A parent who signs in keeps their sign-in email on the record.
    await updateParent(adminOf(schoolA), { parentId: current.id, firstName: current.firstName, lastName: current.lastName, phone: current.phone, email: current.user!.email, occupation: "Surgeon", addressLine: current.addressLine });
    expect(await prisma.parent.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({ occupation: "Surgeon", alternatePhone: "+91 9811199887", city: "Indore", postalCode: "452001" });
  });
});
