/**
 * Admission numbers, class-based account rules, parent linking, activation,
 * forgot password and profile photos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createStudentSchema } from "@/lib/validation/school";
import { redeemAccountLink, requestPasswordReset } from "@/server/auth/account-links";
import { authenticate } from "@/server/auth/login";
import { prisma } from "@/server/db/prisma";
import { readPhoto, removePhoto, setPhoto } from "@/server/people/photos";
import { createStudent, deleteStudent } from "@/server/people/students";

import { adminOf, contextFor, teacherOf } from "../helpers/context";
import { type SeededSchool, createIsolationFixture, destroyIsolationFixture } from "../helpers/isolation-fixture";
import { pngFile } from "../helpers/image";
import { activate, sentMail, tokenFrom } from "../helpers/mail";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let juniorSectionId: string;
let seq = 0;
const YEAR = 2026;

function input(school: SeededSchool, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return createStudentSchema.parse({
    firstName: "Kid",
    lastName: `No${seq}`,
    sectionId: school.sectionId,
    admissionDate: `${YEAR}-06-01`,
    guardianMode: "new",
    parentFirstName: "Parent",
    parentLastName: `No${seq}`,
    parentPhone: `+91 98${String(10000000 + seq).slice(-8)}`,
    relationship: "MOTHER",
    ...overrides,
  });
}

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());
  await prisma.admissionCounter.deleteMany({ where: { schoolId: { in: [schoolA.schoolId, schoolB.schoolId] } } });
  const klass = await prisma.class.create({ data: { schoolId: schoolA.schoolId, name: "Class 3", level: 3 } });
  juniorSectionId = (await prisma.section.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, classId: klass.id, name: "A" } })).id;
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("admission numbers", () => {
  it("runs in sequence per school and year, and schools do not share one", async () => {
    const first = await createStudent(adminOf(schoolA), input(schoolA));
    const second = await createStudent(adminOf(schoolA), input(schoolA));
    expect(first.admissionNumber).toBe("ADM-2026-00001");
    expect(second.admissionNumber).toBe("ADM-2026-00002");
    expect((await createStudent(adminOf(schoolB), input(schoolB))).admissionNumber).toBe("ADM-2026-00001");
  });

  it("never gives two concurrent admissions the same number", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => createStudent(adminOf(schoolA), input(schoolA))));
    const numbers = results.map((r) => r.admissionNumber);
    expect(new Set(numbers).size).toBe(8);
    expect(numbers.every((n) => /^ADM-2026-\d{5}$/.test(n))).toBe(true);
  });

  it("never reuses a number, and a failed admission uses none", async () => {
    const gone = await createStudent(adminOf(schoolA), input(schoolA));
    await deleteStudent(adminOf(schoolA), gone.studentId);
    const next = await createStudent(adminOf(schoolA), input(schoolA));
    expect(next.admissionNumber > gone.admissionNumber).toBe(true);

    const before = await prisma.admissionCounter.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, year: YEAR } });
    const full = await prisma.section.create({ data: { schoolId: schoolA.schoolId, academicSessionId: schoolA.academicSessionId, classId: schoolA.classId, name: "FULL", capacity: 0 } });
    await expect(createStudent(adminOf(schoolA), input(schoolA, { sectionId: full.id }))).rejects.toBeInstanceOf(ConflictError);
    expect((await prisma.admissionCounter.findFirstOrThrow({ where: { schoolId: schoolA.schoolId, year: YEAR } })).value).toBe(before.value);
  });

  it("keeps an existing number from an old register, and refuses a duplicate", async () => {
    const kept = await createStudent(adminOf(schoolA), input(schoolA, { admissionNumber: "GV/2019/045" }));
    expect(kept.admissionNumber).toBe("GV/2019/045");
    await expect(createStudent(adminOf(schoolA), input(schoolA, { admissionNumber: "GV/2019/045" }))).rejects.toBeInstanceOf(ConflictError);
    // Another school may have the same old number.
    expect((await createStudent(adminOf(schoolB), input(schoolB, { admissionNumber: "GV/2019/045" }))).admissionNumber).toBe("GV/2019/045");
  });
});

describe("accounts by class", () => {
  it("Nursery–5: no student account or contact; the parent gets an activation email", async () => {
    await expect(
      createStudent(adminOf(schoolA), input(schoolA, { sectionId: juniorSectionId, studentEmail: "kid@iso-test-a.test" })),
    ).rejects.toBeInstanceOf(ValidationError);
    const result = await createStudent(adminOf(schoolA), input(schoolA, { sectionId: juniorSectionId, parentEmail: "junior.parent@iso-test-a.test" }));
    const student = await prisma.student.findUniqueOrThrow({ where: { id: result.studentId } });
    expect(student.userId).toBeNull();
    expect(result.invites).toEqual([expect.objectContaining({ email: "junior.parent@iso-test-a.test", delivered: true })]);
    const parentUser = await prisma.user.findUniqueOrThrow({ where: { email: "junior.parent@iso-test-a.test" } });
    expect(parentUser).toMatchObject({ role: "PARENT", activatedAt: null });
    // Not a password anywhere in the mail.
    expect(sentMail.at(-1)!.text).toContain("/activate?token=");
  });

  it("Class 6–12: login optional, needs an email, activates by email", async () => {
    expect(createStudentSchema.safeParse({ ...input(schoolA), studentLogin: "on" }).success).toBe(false);
    const plain = await createStudent(adminOf(schoolA), input(schoolA, { studentPhone: "+91 99999 11111" }));
    expect((await prisma.student.findUniqueOrThrow({ where: { id: plain.studentId } })).userId).toBeNull();

    const withLogin = await createStudent(adminOf(schoolA), input(schoolA, { studentLogin: "on", studentEmail: "senior@iso-test-a.test" }));
    expect(withLogin.invites.map((i) => i.email)).toContain("senior@iso-test-a.test");
    expect((await authenticate("senior@iso-test-a.test", "anything")).ok).toBe(false);
    const password = await activate("senior@iso-test-a.test");
    expect(await authenticate("senior@iso-test-a.test", password)).toMatchObject({ ok: true });
    // The link works once.
    await expect(redeemAccountLink(tokenFrom("senior@iso-test-a.test", "activate"), "ACTIVATION", "x-password-9", "x-password-9")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("parents", () => {
  it("catches a duplicate by mobile, links an existing parent without a second email, and stays in the school", async () => {
    const first = await createStudent(adminOf(schoolA), input(schoolA, { parentPhone: "+91 97777 00001", parentEmail: "twins@iso-test-a.test" }));
    await expect(createStudent(adminOf(schoolA), input(schoolA, { parentPhone: "97777 00001" }))).rejects.toBeInstanceOf(ValidationError);
    // Confirmed as a different person, it goes through.
    await createStudent(adminOf(schoolA), input(schoolA, { parentPhone: "97777 00001", confirmNewParent: "on" }));

    const parent = await prisma.parentStudent.findFirstOrThrow({ where: { studentId: first.studentId }, select: { parentId: true } });
    const mailsBefore = sentMail.length;
    const sibling = await createStudent(adminOf(schoolA), input(schoolA, { guardianMode: "existing", existingParentId: parent.parentId }));
    expect(sibling.invites).toEqual([]);
    expect(sentMail.length).toBe(mailsBefore);
    expect(await prisma.parentStudent.count({ where: { parentId: parent.parentId } })).toBe(2);

    await expect(createStudent(adminOf(schoolB), input(schoolB, { guardianMode: "existing", existingParentId: parent.parentId }))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("forgot password", () => {
  it("never says whether an email exists, and resets with a one-time, expiring link", async () => {
    const before = sentMail.length;
    await requestPasswordReset("nobody@nowhere.test");
    expect(sentMail.length).toBe(before);

    await requestPasswordReset("senior@iso-test-a.test");
    const token = tokenFrom("senior@iso-test-a.test", "reset-password");
    await redeemAccountLink(token, "PASSWORD_RESET", "New-password-7", "New-password-7");
    expect(await authenticate("senior@iso-test-a.test", "New-password-7")).toMatchObject({ ok: true });
    await expect(redeemAccountLink(token, "PASSWORD_RESET", "Other-pass-8", "Other-pass-8")).rejects.toBeInstanceOf(ValidationError);

    await requestPasswordReset("senior@iso-test-a.test");
    await prisma.accountToken.updateMany({ where: { usedAt: null, revokedAt: null, purpose: "PASSWORD_RESET" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(
      redeemAccountLink(tokenFrom("senior@iso-test-a.test", "reset-password"), "PASSWORD_RESET", "Late-pass-9", "Late-pass-9"),
    ).rejects.toBeInstanceOf(ValidationError);
    // Passwords are stored hashed.
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "senior@iso-test-a.test" } })).passwordHash).not.toContain("New-password-7");
  });
});

describe("profile photos", () => {
  const png = () => pngFile(96, 96);

  it("a student sets their own photo, shown only to those who may see it", async () => {
    const studentId = schoolA.studentIds[0]!;
    const url = await setPhoto(contextFor(schoolA, schoolA.studentUserId, "STUDENT"), { type: "STUDENT", id: studentId }, png());
    const photoId = url.split("/").pop()!.split("?")[0]!;
    expect((await readPhoto(contextFor(schoolA, schoolA.parentUserId, "PARENT"), photoId)).mimeType).toBe("image/png");
    expect((await readPhoto(teacherOf(schoolA), photoId)).bytes.length).toBeGreaterThan(0);
    expect((await readPhoto(adminOf(schoolA), photoId)).bytes.length).toBeGreaterThan(0);
    await expect(readPhoto(adminOf(schoolB), photoId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readPhoto(contextFor(schoolB, schoolB.parentUserId, "PARENT"), photoId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).photoUrl).toBe(url);
  });

  it("refuses non-images, and anyone changing someone else's photo — the School Admin included", async () => {
    const fake = new File([Buffer.from("%PDF-1.4 not an image")], "me.png", { type: "image/png" });
    await expect(setPhoto(teacherOf(schoolA), { type: "TEACHER", id: schoolA.teacherId }, fake)).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(setPhoto(teacherOf(schoolA), { type: "STUDENT", id: schoolA.studentIds[1]! }, png())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setPhoto(adminOf(schoolA), { type: "STUDENT", id: schoolA.studentIds[1]! }, png())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setPhoto(adminOf(schoolA), { type: "TEACHER", id: schoolA.teacherId }, png())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removePhoto(adminOf(schoolA), { type: "STUDENT", id: schoolA.studentIds[0]! })).rejects.toBeInstanceOf(ForbiddenError);
    // A teacher changes their own.
    await setPhoto(teacherOf(schoolA), { type: "TEACHER", id: schoolA.teacherId }, png());
  });
});
