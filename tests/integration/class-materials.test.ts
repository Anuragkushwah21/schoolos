/**
 * A completed class with notes, homework and study material — and who may
 * write it and who may read it.
 *
 * The teacher writes up their own period; a colleague in the same school cannot
 * touch it. The student in that section reads the notes, the homework and the
 * material, opens the video and the link, and views or downloads the PDF; a
 * student in another school gets "not found" for every one of those ids.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { dayOfWeek, today } from "@/lib/dates";
import { lessonMaterialSchema } from "@/lib/validation/classwork";
import { createApiToken } from "@/server/auth/api-token";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { getMyActivity, recordActivity } from "@/server/classwork/activities";
import {
  addLessonMaterial,
  deleteLessonMaterial,
  readMaterialFile,
} from "@/server/classwork/lessons";
import { MAX_DOCUMENT_BYTES } from "@/server/storage/files";
import { getMyLesson, getMyMaterials } from "@/server/student/me";
import { GET as getMaterialFileRoute } from "@/app/api/v1/lesson-materials/[materialId]/file/route";

import { apiRequest } from "../helpers/api";
import { adminOf, contextFor, teacherOf } from "../helpers/context";
import {
  type SeededSchool,
  createIsolationFixture,
  destroyIsolationFixture,
} from "../helpers/isolation-fixture";

let schoolA: SeededSchool;
let schoolB: SeededSchool;
let lessonId: string;
let slotId: string;
let colleagueCtx: ReturnType<typeof teacherOf>;

const studentOf = (school: SeededSchool) => contextFor(school, school.studentUserId, "STUDENT");

const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n");
const pdf = (name = "Quadratic Equations Notes.pdf", bytes: Buffer = PDF_BYTES) =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

const material = (overrides: Partial<Parameters<typeof addLessonMaterial>[1]>) => ({
  classSessionId: lessonId,
  kind: "NOTES" as const,
  title: "Material",
  url: null,
  body: null,
  description: null,
  file: null,
  ...overrides,
});

beforeAll(async () => {
  ({ schoolA, schoolB } = await createIsolationFixture());

  const slot = await prisma.timetableSlot.create({
    data: {
      schoolId: schoolA.schoolId,
      academicSessionId: schoolA.academicSessionId,
      sectionId: schoolA.sectionId,
      subjectId: schoolA.subjectId,
      teacherId: schoolA.teacherId,
      dayOfWeek: dayOfWeek(today()),
      startMinute: 540,
      endMinute: 585,
    },
  });
  slotId = slot.id;

  const user = await prisma.user.create({
    data: {
      email: "colleague@iso-test-a.test",
      passwordHash: "not-a-real-hash",
      role: "TEACHER",
      firstName: "Other",
      lastName: "Teacher",
      schoolId: schoolA.schoolId,
    },
  });
  await prisma.teacher.create({
    data: { schoolId: schoolA.schoolId, userId: user.id, employeeId: "EMP-C", firstName: "Other", lastName: "Teacher" },
  });
  colleagueCtx = contextFor(schoolA, user.id, "TEACHER");
}, 60_000);

afterAll(async () => {
  await destroyIsolationFixture();
  await prisma.$disconnect();
});

describe("completing a class", () => {
  it("records notes, important points, preparation and homework together", async () => {
    const { id } = await recordActivity(teacherOf(schoolA), {
      timetableSlotId: slotId,
      date: today(),
      status: "COMPLETED",
      topic: "Quadratic equations",
      notes: "Solved by factorisation and by formula.",
      importantPoints: "Learn the quadratic formula.",
      preparation: "Read chapter 5.",
      homeworkTitle: "Exercise 4.2",
      homeworkDescription: "Questions 1-8",
      homeworkDueOn: new Date(today().getTime() + 2 * 86_400_000),
    });
    lessonId = id;

    const activity = await getMyActivity(teacherOf(schoolA), id);
    expect(activity).toMatchObject({ topic: "Quadratic equations", preparation: "Read chapter 5." });
    expect(activity.homework).toHaveLength(1);
    expect(activity.homework[0]!.title).toBe("Exercise 4.2");
  });

  it("edits the same homework when the class is saved again, rather than setting it twice", async () => {
    await recordActivity(teacherOf(schoolA), {
      timetableSlotId: slotId,
      date: today(),
      status: "COMPLETED",
      topic: "Quadratic equations",
      notes: "Solved by factorisation and by formula.",
      importantPoints: null,
      homeworkTitle: "Exercise 4.3",
      homeworkDueOn: today(),
    });
    const rows = await prisma.homework.findMany({ where: { classSessionId: lessonId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Exercise 4.3");
  });

  it("refuses homework on a class that did not happen", async () => {
    await expect(
      recordActivity(teacherOf(schoolA), {
        timetableSlotId: slotId,
        date: today(),
        status: "CANCELLED",
        topic: null,
        notes: null,
        importantPoints: null,
        homeworkTitle: "Anything",
        homeworkDueOn: today(),
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("attaching study material", () => {
  it("accepts a PDF, a video link and an external resource on one class", async () => {
    const ctx = teacherOf(schoolA);
    await addLessonMaterial(ctx, material({ kind: "DOCUMENT", title: "Notes PDF", file: pdf() }));
    await addLessonMaterial(ctx, material({ kind: "DOCUMENT", title: "Important Questions", file: pdf("Important Questions.pdf") }));
    await addLessonMaterial(
      ctx,
      material({ kind: "VIDEO", title: "Explanation video", url: "https://www.youtube.com/watch?v=abc123" }),
    );
    await addLessonMaterial(
      ctx,
      material({
        kind: "LINK",
        title: "NCERT Practice Questions",
        url: "https://example.com/ncert",
        description: "Try questions 1-10",
      }),
    );

    const activity = await getMyActivity(ctx, lessonId);
    expect(activity.materials.map((row) => row.kind)).toEqual(["DOCUMENT", "DOCUMENT", "VIDEO", "LINK"]);
    const [notes] = activity.materials;
    expect(notes).toMatchObject({ fileName: "Quadratic Equations Notes.pdf", url: null });
    expect(notes!.fileSize).toBe(PDF_BYTES.length);
  });

  it("refuses a renamed executable, a non-PDF and an oversized file", async () => {
    const ctx = teacherOf(schoolA);
    const exe = Buffer.from("MZ\x90\x00this is not a pdf");
    await expect(
      addLessonMaterial(ctx, material({ kind: "DOCUMENT", title: "x", file: pdf("setup.pdf", exe) })),
    ).rejects.toThrow(/not a valid PDF/);
    await expect(
      addLessonMaterial(ctx, material({ kind: "DOCUMENT", title: "x", file: pdf("run.exe") })),
    ).rejects.toThrow(/Only PDF/);
    const huge = Buffer.concat([PDF_BYTES, Buffer.alloc(MAX_DOCUMENT_BYTES)]);
    await expect(
      addLessonMaterial(ctx, material({ kind: "DOCUMENT", title: "x", file: pdf("big.pdf", huge) })),
    ).rejects.toThrow(/too large/);
  });

  it("refuses a video without an address, and malformed addresses at the form", async () => {
    await expect(
      addLessonMaterial(teacherOf(schoolA), material({ kind: "VIDEO", title: "No link" })),
    ).rejects.toBeInstanceOf(AppError);

    for (const url of ["not a url", "http://insecure.example.com", "https://"]) {
      const parsed = lessonMaterialSchema.safeParse({ classSessionId: "x", kind: "VIDEO", title: "t", url });
      expect(parsed.success).toBe(false);
    }
    expect(
      lessonMaterialSchema.safeParse({ classSessionId: "x", kind: "VIDEO", title: "t", url: "https://youtu.be/abc" })
        .success,
    ).toBe(true);
  });

  it("does not let another teacher add to or remove from this class", async () => {
    await expect(
      addLessonMaterial(colleagueCtx, material({ kind: "LINK", title: "x", url: "https://example.com" })),
    ).rejects.toBeInstanceOf(NotFoundError);

    const [first] = (await getMyActivity(teacherOf(schoolA), lessonId)).materials;
    await expect(deleteLessonMaterial(colleagueCtx, first!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      recordActivity(colleagueCtx, {
        timetableSlotId: slotId,
        date: today(),
        status: "COMPLETED",
        topic: "Hijacked",
        notes: null,
        importantPoints: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("what the student sees", () => {
  it("shows notes, homework and every material on the completed class", async () => {
    const { lesson, homework } = await getMyLesson(studentOf(schoolA), lessonId);
    expect(lesson).toMatchObject({
      subject: expect.any(String),
      topic: "Quadratic equations",
      notes: "Solved by factorisation and by formula.",
      taught: true,
    });
    expect(homework.map((row) => row.title)).toContain("Exercise 4.3");

    const video = lesson.materials.find((row) => row.kind === "VIDEO")!;
    expect(video.url).toBe("https://www.youtube.com/watch?v=abc123");
    const link = lesson.materials.find((row) => row.kind === "LINK")!;
    expect(link).toMatchObject({ url: "https://example.com/ncert", description: "Try questions 1-10" });
    // The storage key never reaches a student read.
    expect(Object.keys(lesson.materials[0]!)).not.toContain("storageKey");

    const { materials } = await getMyMaterials(studentOf(schoolA));
    expect(materials).toHaveLength(4);
  });

  it("serves the student the PDF from their own class", async () => {
    const document = (await getMyLesson(studentOf(schoolA), lessonId)).lesson.materials[0]!;
    const file = await readMaterialFile(studentOf(schoolA), document.id);
    expect(file.mimeType).toBe("application/pdf");
    expect(file.bytes.equals(PDF_BYTES)).toBe(true);
  });

  it("answers another school's student with not found for the class and its file", async () => {
    const document = (await getMyLesson(studentOf(schoolA), lessonId)).lesson.materials[0]!;
    await expect(getMyLesson(studentOf(schoolB), lessonId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readMaterialFile(studentOf(schoolB), document.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getMyMaterials(studentOf(schoolB))).materials).toEqual([]);
  });

  it("does not serve lesson files to parents", async () => {
    const document = (await getMyLesson(studentOf(schoolA), lessonId)).lesson.materials[0]!;
    await expect(
      readMaterialFile(contextFor(schoolA, schoolA.parentUserId, "PARENT"), document.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the download route", () => {
  async function tokenFor(school: SeededSchool) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: school.adminUserId } });
    const actor: SessionUser = {
      id: user.id,
      email: user.email,
      role: "SCHOOL_ADMIN",
      firstName: user.firstName,
      lastName: user.lastName,
      schoolId: school.schoolId,
      schoolSlug: "fixture",
      schoolName: "Fixture",
      schoolStatus: "ACTIVE",
    };
    return (await createApiToken(actor, { name: "materials", scope: "READ", expiresAt: null })).token;
  }

  it("streams the PDF inline or as a download to its own school, and 404s for another", async () => {
    const document = (await getMyActivity(teacherOf(schoolA), lessonId)).materials[0]!;
    const url = `/api/v1/lesson-materials/${document.id}/file`;
    const params = { params: Promise.resolve({ materialId: document.id }) };

    const own = await getMaterialFileRoute(apiRequest(url, { token: await tokenFor(schoolA) }), params);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("application/pdf");
    expect(own.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(Buffer.from(await own.arrayBuffer()).equals(PDF_BYTES)).toBe(true);

    const download = await getMaterialFileRoute(
      apiRequest(`${url}?download=1`, { token: await tokenFor(schoolA) }),
      params,
    );
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);

    const foreign = await getMaterialFileRoute(apiRequest(url, { token: await tokenFor(schoolB) }), params);
    expect(foreign.status).toBe(404);

    const anonymous = await getMaterialFileRoute(apiRequest(url), params);
    expect(anonymous.status).toBe(401);
  });

  it("removes the stored file with the material", async () => {
    const ctx = teacherOf(schoolA);
    const document = (await getMyActivity(ctx, lessonId)).materials[1]!;
    await deleteLessonMaterial(ctx, document.id);
    await expect(readMaterialFile(adminOf(schoolA), document.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
